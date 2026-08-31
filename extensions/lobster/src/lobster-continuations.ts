import { createHash, randomUUID } from "node:crypto";
import type { PluginStateSyncKeyedStore } from "openclaw/plugin-sdk/plugin-state-runtime";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import type { LobsterEnvelope, LobsterRunnerParams } from "./lobster-runner.js";

type ContinuationRecord =
  | { kind: "binding"; sessionKey: string; sessionId: string; expiresAt: number }
  | {
      kind: "claim";
      sessionKey: string;
      sessionId: string;
      expiresAt: number;
      claimId: string;
    };
type ClaimRecord = Extract<ContinuationRecord, { kind: "claim" }>;

// Each checkpoint gets one fixed deadline so retries cannot keep abandoned
// continuations alive and permanently exhaust plugin state.
export const LOBSTER_CONTINUATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type LobsterContinuationOwner = {
  sessionKey: string;
  sessionId: string;
  openStore: () => PluginStateSyncKeyedStore<unknown>;
  resolveCurrentSessionId: () => string | undefined;
};

export type LobsterContinuationClaim = {
  credentialKey: string;
  claimId: string;
  expiresAt: number;
};

function credentialKey(value: string): string {
  const digest = createHash("sha256").update("token\0").update(value.trim()).digest("hex");
  return `credential:${digest}`;
}

function paramsCredentialKey(params: Pick<LobsterRunnerParams, "token">): string | undefined {
  return params.token?.trim() ? credentialKey(params.token) : undefined;
}

function envelopeCredentialKey(
  envelope: Extract<LobsterEnvelope, { ok: true }>,
): string | undefined {
  if (envelope.status === "needs_input" && envelope.requiresInput) {
    return credentialKey(envelope.requiresInput.resumeToken);
  }
  return undefined;
}

function readContinuationRecord(value: unknown): ContinuationRecord | undefined {
  if (
    !isRecord(value) ||
    typeof value.sessionKey !== "string" ||
    typeof value.sessionId !== "string" ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= 0
  ) {
    return undefined;
  }
  const expiresAt = value.expiresAt as number;
  if (value.kind === "binding") {
    return {
      kind: "binding",
      sessionKey: value.sessionKey,
      sessionId: value.sessionId,
      expiresAt,
    };
  }
  return value.kind === "claim" && typeof value.claimId === "string"
    ? {
        kind: "claim",
        sessionKey: value.sessionKey,
        sessionId: value.sessionId,
        expiresAt,
        claimId: value.claimId,
      }
    : undefined;
}

function readActiveContinuationRecord(value: unknown): ContinuationRecord | undefined {
  const record = readContinuationRecord(value);
  return record && record.expiresAt > Date.now() ? record : undefined;
}

function isStoredOwnedClaim(
  value: unknown,
  owner: LobsterContinuationOwner,
  claim: LobsterContinuationClaim,
): value is ClaimRecord {
  const binding = readContinuationRecord(value);
  return (
    binding?.kind === "claim" &&
    binding.sessionKey === owner.sessionKey &&
    binding.sessionId === owner.sessionId &&
    binding.claimId === claim.claimId &&
    binding.expiresAt === claim.expiresAt
  );
}

function isActiveOwnedClaim(
  value: unknown,
  owner: LobsterContinuationOwner,
  claim: LobsterContinuationClaim,
): value is ClaimRecord {
  return isStoredOwnedClaim(value, owner, claim) && claim.expiresAt > Date.now();
}

function remainingTtlMs(expiresAt: number): number | undefined {
  const remaining = expiresAt - Date.now();
  return remaining > 0 ? remaining : undefined;
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
  const key = envelopeCredentialKey(envelope);
  if (!key) {
    return;
  }
  if (!owner) {
    throw new Error(
      "Lobster continuation requires a bound OpenClaw session; rerun the workflow from a persistent session",
    );
  }
  assertCurrentSession(owner);
  const expiresAt = Date.now() + LOBSTER_CONTINUATION_TTL_MS;
  const binding: ContinuationRecord = {
    kind: "binding",
    sessionKey: owner.sessionKey,
    sessionId: owner.sessionId,
    expiresAt,
  };
  if (!owner.openStore().registerIfAbsent(key, binding, { ttlMs: LOBSTER_CONTINUATION_TTL_MS })) {
    throw new Error("Lobster runtime returned a duplicate continuation credential");
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
  const key = paramsCredentialKey(params);
  if (!key) {
    throw unavailableError();
  }
  const initial = readActiveContinuationRecord(store.lookup(key));
  const ttlMs = initial ? remainingTtlMs(initial.expiresAt) : undefined;
  if (!initial || ttlMs === undefined) {
    throw unavailableError();
  }
  const claimId = randomUUID();
  let foreignOwner = false;
  const claimed = store.update?.(
    key,
    (current) => {
      const latest = readActiveContinuationRecord(current);
      if (!latest || latest.expiresAt !== initial.expiresAt) {
        return undefined;
      }
      if (latest.sessionKey !== owner.sessionKey || latest.sessionId !== owner.sessionId) {
        foreignOwner = true;
        return undefined;
      }
      return latest.kind === "binding" ? { ...latest, kind: "claim", claimId } : undefined;
    },
    { ttlMs },
  );
  if (!claimed) {
    if (foreignOwner) {
      throw new Error(
        "Lobster continuation belongs to another OpenClaw session; resume it from the session that created it",
      );
    }
    throw unavailableError();
  }
  return { credentialKey: key, claimId, expiresAt: initial.expiresAt };
}

export function assertLobsterContinuationClaimCurrent(
  owner: LobsterContinuationOwner,
  claim: LobsterContinuationClaim,
): void {
  assertCurrentSession(owner);
  if (!isActiveOwnedClaim(owner.openStore().lookup(claim.credentialKey), owner, claim)) {
    throw unavailableError();
  }
}

export function retireLobsterContinuation(
  owner: LobsterContinuationOwner,
  claim: LobsterContinuationClaim,
): void {
  owner
    .openStore()
    .deleteIf?.(claim.credentialKey, (current) => isStoredOwnedClaim(current, owner, claim));
}

export function releaseLobsterContinuation(
  owner: LobsterContinuationOwner,
  claim: LobsterContinuationClaim,
): void {
  const store = owner.openStore();
  const ttlMs = remainingTtlMs(claim.expiresAt);
  if (ttlMs === undefined) {
    retireLobsterContinuation(owner, claim);
    return;
  }
  store.update?.(
    claim.credentialKey,
    (current) =>
      isActiveOwnedClaim(current, owner, claim)
        ? {
            kind: "binding",
            sessionKey: current.sessionKey,
            sessionId: current.sessionId,
            expiresAt: current.expiresAt,
          }
        : undefined,
    { ttlMs },
  );
}
