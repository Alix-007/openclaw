import { createHash } from "node:crypto";
import type { PluginStateSyncKeyedStore } from "openclaw/plugin-sdk/plugin-state-runtime";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import type { LobsterEnvelope, LobsterRunnerParams } from "./lobster-runner.js";

type Binding = {
  kind: "binding";
  sessionKey: string;
  sessionId: string;
  claimKey: string;
  credentialKeys: string[];
};

// Structured-input replies are short-lived conversation continuations. Expiry
// bounds abandoned bindings so they cannot permanently exhaust plugin state.
export const LOBSTER_CONTINUATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type LobsterContinuationOwner = {
  sessionKey: string;
  sessionId: string;
  openStore: () => PluginStateSyncKeyedStore<unknown>;
  resolveCurrentSessionId: () => string | undefined;
};

export type LobsterContinuationClaim = {
  claimKey: string;
  credentialKeys: string[];
};

function credentialKey(value: string): string {
  const digest = createHash("sha256").update("token\0").update(value.trim()).digest("hex");
  return `credential:${digest}`;
}

function credentialKeys(params: Pick<LobsterRunnerParams, "token">): string[] {
  return params.token?.trim() ? [credentialKey(params.token)] : [];
}

function envelopeCredentialKeys(envelope: Extract<LobsterEnvelope, { ok: true }>): string[] {
  if (envelope.status === "needs_input" && envelope.requiresInput) {
    return [credentialKey(envelope.requiresInput.resumeToken)];
  }
  return [];
}

function readBinding(value: unknown): Binding | undefined {
  const rawKeys = isRecord(value) ? value.credentialKeys : undefined;
  const keys = Array.isArray(rawKeys)
    ? rawKeys.filter((key): key is string => typeof key === "string")
    : [];
  if (
    !isRecord(value) ||
    value.kind !== "binding" ||
    typeof value.sessionKey !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.claimKey !== "string" ||
    !Array.isArray(rawKeys) ||
    keys.length !== rawKeys.length
  ) {
    return undefined;
  }
  return {
    kind: "binding",
    sessionKey: value.sessionKey,
    sessionId: value.sessionId,
    claimKey: value.claimKey,
    credentialKeys: keys,
  };
}

function isOwnedClaim(value: unknown, owner: LobsterContinuationOwner): boolean {
  return (
    isRecord(value) &&
    value.kind === "claim" &&
    value.sessionKey === owner.sessionKey &&
    value.sessionId === owner.sessionId
  );
}

function unavailableError(): Error {
  return new Error(
    "Lobster continuation is unavailable, expired, or already used; rerun the workflow to create a new checkpoint",
  );
}

function assertCurrentSession(owner: LobsterContinuationOwner): void {
  if (owner.resolveCurrentSessionId() !== owner.sessionId) {
    throw new Error(
      "Lobster continuation session is no longer active; rerun the workflow in the current session",
    );
  }
}

export function bindLobsterContinuation(
  owner: LobsterContinuationOwner | undefined,
  envelope: Extract<LobsterEnvelope, { ok: true }>,
): void {
  const keys = envelopeCredentialKeys(envelope);
  if (keys.length === 0) {
    return;
  }
  if (!owner) {
    throw new Error(
      "Lobster continuation requires a bound OpenClaw session; rerun the workflow from a persistent session",
    );
  }
  assertCurrentSession(owner);
  const claimKey = `claim:${keys[0]?.slice("credential:".length)}`;
  const binding: Binding = {
    kind: "binding",
    sessionKey: owner.sessionKey,
    sessionId: owner.sessionId,
    claimKey,
    credentialKeys: keys,
  };
  const store = owner.openStore();
  const registered: string[] = [];
  try {
    for (const key of keys) {
      if (!store.registerIfAbsent(key, binding, { ttlMs: LOBSTER_CONTINUATION_TTL_MS })) {
        throw new Error("Lobster runtime returned a duplicate continuation credential");
      }
      registered.push(key);
    }
  } catch (error) {
    for (const key of registered) {
      store.deleteIf?.(key, (current) => readBinding(current)?.claimKey === claimKey);
    }
    throw error;
  }
}

export function claimLobsterContinuation(
  owner: LobsterContinuationOwner | undefined,
  params: Pick<LobsterRunnerParams, "token">,
): LobsterContinuationClaim {
  if (!owner) {
    throw unavailableError();
  }
  assertCurrentSession(owner);
  const store = owner.openStore();
  let binding: Binding | undefined;
  for (const key of credentialKeys(params)) {
    const current = readBinding(store.lookup(key));
    if (!current) {
      throw unavailableError();
    }
    if (current.sessionKey !== owner.sessionKey || current.sessionId !== owner.sessionId) {
      throw new Error(
        "Lobster continuation belongs to another OpenClaw session; resume it from the session that created it",
      );
    }
    if (binding && binding.claimKey !== current.claimKey) {
      throw unavailableError();
    }
    binding = current;
  }
  if (
    !binding ||
    !store.registerIfAbsent(
      binding.claimKey,
      {
        kind: "claim",
        sessionKey: owner.sessionKey,
        sessionId: owner.sessionId,
      },
      { ttlMs: LOBSTER_CONTINUATION_TTL_MS },
    )
  ) {
    throw unavailableError();
  }
  return { claimKey: binding.claimKey, credentialKeys: binding.credentialKeys };
}

export function assertLobsterContinuationClaimCurrent(
  owner: LobsterContinuationOwner,
  claim: LobsterContinuationClaim,
): void {
  assertCurrentSession(owner);
  if (!isOwnedClaim(owner.openStore().lookup(claim.claimKey), owner)) {
    throw unavailableError();
  }
}

export function retireLobsterContinuation(
  owner: LobsterContinuationOwner,
  claim: LobsterContinuationClaim,
): void {
  const store = owner.openStore();
  for (const key of claim.credentialKeys) {
    store.deleteIf?.(key, (current) => {
      const binding = readBinding(current);
      return (
        binding?.claimKey === claim.claimKey &&
        binding.sessionKey === owner.sessionKey &&
        binding.sessionId === owner.sessionId
      );
    });
  }
  store.deleteIf?.(claim.claimKey, (current) => isOwnedClaim(current, owner));
}

export function releaseLobsterContinuation(
  owner: LobsterContinuationOwner,
  claim: LobsterContinuationClaim,
): void {
  owner.openStore().deleteIf?.(claim.claimKey, (current) => isOwnedClaim(current, owner));
}
