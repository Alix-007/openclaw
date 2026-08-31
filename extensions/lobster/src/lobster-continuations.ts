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

export type LobsterContinuationOwner = {
  sessionKey: string;
  sessionId: string;
  openStore: () => PluginStateSyncKeyedStore<unknown>;
};

export type LobsterContinuationClaim = {
  claimKey: string;
  credentialKeys: string[];
};

function credentialKey(kind: "token" | "approval", value: string): string {
  const digest = createHash("sha256").update(kind).update("\0").update(value.trim()).digest("hex");
  return `credential:${digest}`;
}

function credentialKeys(params: Pick<LobsterRunnerParams, "token" | "approvalId">): string[] {
  return [
    ...(params.token?.trim() ? [credentialKey("token", params.token)] : []),
    ...(params.approvalId?.trim() ? [credentialKey("approval", params.approvalId)] : []),
  ];
}

function envelopeCredentialKeys(envelope: Extract<LobsterEnvelope, { ok: true }>): string[] {
  if (envelope.status === "needs_input" && envelope.requiresInput) {
    return [credentialKey("token", envelope.requiresInput.resumeToken)];
  }
  return envelope.status === "needs_approval" && envelope.requiresApproval
    ? credentialKeys({
        token: envelope.requiresApproval.resumeToken,
        approvalId: envelope.requiresApproval.approvalId,
      })
    : [];
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
      if (!store.registerIfAbsent(key, binding)) {
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
  params: Pick<LobsterRunnerParams, "token" | "approvalId">,
): LobsterContinuationClaim {
  if (!owner) {
    throw unavailableError();
  }
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
    !store.registerIfAbsent(binding.claimKey, {
      kind: "claim",
      sessionKey: owner.sessionKey,
      sessionId: owner.sessionId,
    })
  ) {
    throw unavailableError();
  }
  return { claimKey: binding.claimKey, credentialKeys: binding.credentialKeys };
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
