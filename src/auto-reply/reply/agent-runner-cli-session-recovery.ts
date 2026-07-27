import { isClaudeCliProvider } from "../../agents/cli-runner/helpers.js";
import type { RunCliAgentParams } from "../../agents/cli-runner/types.js";
import { clearCliSession, getCliSessionId } from "../../agents/cli-session.js";
import { clearCliSessionInStore } from "../../agents/command/session-store.js";
import { isFailoverError } from "../../agents/failover-error.js";
import type { CliSessionBinding, SessionEntry } from "../../config/sessions.js";
import { formatErrorMessage, readErrorName } from "../../infra/errors.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("auto-reply/cli-session-recovery");

type CliSessionRecoveryParams = {
  provider: string;
  binding?: CliSessionBinding;
  sessionKey?: string;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  getActiveSessionEntry: () => SessionEntry | undefined;
  hasCommittedMedia: () => boolean;
};

type CliSessionRecoveryCallbacks = {
  onErrorBeforeLifecycle?: (error: unknown) => Promise<void>;
  onBeforeFreshCliSessionRetry?: RunCliAgentParams["onBeforeFreshCliSessionRetry"];
};

/**
 * Clears exactly the binding observed by this run, then mirrors the persisted
 * timestamp into still-matching in-memory entries. A newer binding wins the CAS.
 */
async function clearExpectedCliSessionBinding(params: {
  provider: string;
  expectedCliSessionId: string;
  sessionKey?: string;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  activeSessionEntry?: SessionEntry;
}): Promise<boolean> {
  const {
    provider,
    expectedCliSessionId,
    sessionKey,
    sessionStore,
    storePath,
    activeSessionEntry,
  } = params;
  if (!sessionKey || !sessionStore || !storePath) {
    return false;
  }
  const storedEntry = sessionStore[sessionKey];
  if (
    !storedEntry?.sessionId ||
    getCliSessionId(storedEntry, provider) !== expectedCliSessionId ||
    (activeSessionEntry !== undefined &&
      getCliSessionId(activeSessionEntry, provider) !== undefined &&
      getCliSessionId(activeSessionEntry, provider) !== expectedCliSessionId)
  ) {
    return false;
  }

  try {
    const cleared = await clearCliSessionInStore({
      provider,
      sessionKey,
      sessionStore,
      storePath,
      expectedSessionId: storedEntry.sessionId,
      expectedCliSessionId,
    });
    if (!cleared) {
      return false;
    }
    const entries = new Set([storedEntry, activeSessionEntry].filter(Boolean));
    for (const entry of entries) {
      if (getCliSessionId(entry, provider) === expectedCliSessionId) {
        clearCliSession(entry, provider);
        entry.updatedAt = cleared.updatedAt;
      }
    }
    return true;
  } catch (error) {
    log.warn(`failed to clear stale CLI session binding: ${formatErrorMessage(error)}`);
    return false;
  }
}

export function createCliSessionRecoveryCallbacks(
  params: CliSessionRecoveryParams,
): CliSessionRecoveryCallbacks {
  const sessionId = params.binding?.sessionId;
  const { sessionKey, sessionStore, storePath } = params;
  if (!sessionId || !sessionKey || !sessionStore || !storePath) {
    return {};
  }

  const clear = (provider: string, expectedCliSessionId: string) => {
    // Detached media owns this turn; replaying it fresh can duplicate side effects.
    if (params.hasCommittedMedia()) {
      return Promise.resolve(false);
    }
    return clearExpectedCliSessionBinding({
      provider,
      expectedCliSessionId,
      sessionKey,
      sessionStore,
      storePath,
      activeSessionEntry: params.getActiveSessionEntry(),
    });
  };

  const callbacks: CliSessionRecoveryCallbacks = {
    onBeforeFreshCliSessionRetry: ({ provider, sessionId: retrySessionId }) =>
      clear(provider, retrySessionId),
  };
  if (params.binding?.forkNextResume === true) {
    // A fresh retry may clear the exact failed fork binding, but terminal
    // cleanup must leave an armed fork for its owning lifecycle to recover.
    return callbacks;
  }
  callbacks.onErrorBeforeLifecycle = async (error) => {
    if (
      isClaudeCliProvider(params.provider) &&
      (isFailoverError(error) || readErrorName(error) === "AbortError")
    ) {
      await clear(params.provider, sessionId);
    }
  };
  return callbacks;
}
