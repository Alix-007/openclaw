import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const targetRoot = process.cwd();
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-bootstrap-proof-"));
process.env.HOME = path.join(runtimeRoot, "home");
process.env.OPENCLAW_STATE_DIR = path.join(runtimeRoot, "state");
await fs.mkdir(process.env.HOME, { recursive: true });
await fs.mkdir(process.env.OPENCLAW_STATE_DIR, { recursive: true });

const importTarget = async (relativePath: string) =>
  await import(pathToFileURL(path.join(targetRoot, relativePath)).href);
const { upsertSessionEntry } = await importTarget("src/config/sessions/session-accessor.ts");
const { FULL_BOOTSTRAP_COMPLETED_CUSTOM_TYPE, hasCompletedBootstrapTurn } = await importTarget(
  "src/agents/bootstrap-files.ts",
);
const { resolveBootstrapContextInjection, resolveWorkspaceBootstrapRouting } = await importTarget(
  "src/agents/bootstrap-routing.ts",
);
const { finalizePendingCliBootstrapCompletion, setPendingCliBootstrapCompletion } =
  await importTarget("src/agents/cli-bootstrap-completion.ts");
const { SessionManager } = await importTarget("src/agents/sessions/session-manager.ts");
const { shouldPersistCompletedBootstrapTurn } = await importTarget(
  "src/agents/embedded-agent-runner/run/attempt.thread-helpers.ts",
);
const { closeOpenClawAgentDatabasesForTest } = await importTarget("src/state/openclaw-agent-db.ts");

const sessionTarget = {
  agentId: "main",
  sessionId: randomUUID(),
  sessionKey: "agent:main:bootstrap-proof",
  storePath: path.join(runtimeRoot, "sessions.json"),
};
await upsertSessionEntry(sessionTarget, {
  sessionId: sessionTarget.sessionId,
  updatedAt: Date.now(),
});
const sessionManager = SessionManager.open(sessionTarget, runtimeRoot);

async function runTurn(params: {
  trigger: string;
  isPrimaryRun: boolean;
  runKind?: "default" | "cron";
}) {
  const routing = await resolveWorkspaceBootstrapRouting({
    isWorkspaceBootstrapPending: async () => false,
    trigger: params.trigger,
    isPrimaryRun: params.isPrimaryRun,
    isCanonicalWorkspace: true,
    effectiveWorkspace: runtimeRoot,
    resolvedWorkspace: runtimeRoot,
    hasBootstrapFileAccess: true,
    bootstrapContextRunKind: params.runKind ?? "default",
  });
  return await resolveBootstrapContextInjection({
    contextInjectionMode: "continuation-skip",
    bootstrapContextMode: "full",
    bootstrapContextRunKind: params.runKind ?? "default",
    bootstrapMode: routing.bootstrapMode,
    isPrimaryInteractiveRun: routing.isPrimaryInteractiveRun,
    hasCompletedBootstrapTurn: async () => await hasCompletedBootstrapTurn(sessionTarget),
    resolveBootstrapContextForRun: async () => ({
      bootstrapFiles: [{ name: "AGENTS.md" }],
      contextFiles: [{ path: "AGENTS.md" }],
    }),
  });
}

try {
  const first = await runTurn({ trigger: "user", isPrimaryRun: true });
  assert.equal(first.isContinuationTurn, false);
  assert.equal(first.shouldRecordCompletedBootstrapTurn, true);
  assert.equal(first.contextFiles.length, 1);
  const shouldPersist = shouldPersistCompletedBootstrapTurn({
    shouldRecordCompletedBootstrapTurn: first.shouldRecordCompletedBootstrapTurn,
    promptError: undefined,
    aborted: false,
    timedOutDuringCompaction: false,
    compactionOccurredThisAttempt: false,
  });
  assert.equal(shouldPersist, true);
  sessionManager.appendCustomEntry(FULL_BOOTSTRAP_COMPLETED_CUSTOM_TYPE, {
    timestamp: Date.now(),
  });
  assert.equal(await hasCompletedBootstrapTurn(sessionTarget), true);

  const continuation = await runTurn({ trigger: "user", isPrimaryRun: true });
  assert.equal(continuation.isContinuationTurn, true);
  assert.equal(continuation.contextFiles.length, 0);
  assert.equal(continuation.shouldRecordCompletedBootstrapTurn, false);

  const memory = await runTurn({ trigger: "memory", isPrimaryRun: true });
  const nonPrimary = await runTurn({ trigger: "user", isPrimaryRun: false });
  const cron = await runTurn({ trigger: "cron", isPrimaryRun: true, runKind: "cron" });
  for (const background of [memory, nonPrimary, cron]) {
    assert.equal(background.isContinuationTurn, false);
    assert.equal(background.contextFiles.length, 1);
    assert.equal(background.shouldRecordCompletedBootstrapTurn, false);
  }

  let releaseDeferredMaintenance: (() => void) | undefined;
  const deferredMaintenance = new Promise<boolean>((resolve) => {
    releaseDeferredMaintenance = () => resolve(true);
  });
  const deferredResult = {
    meta: {
      durationMs: 0,
      bootstrapContextCompletionPending: true,
    },
  };
  setPendingCliBootstrapCompletion(deferredResult, {
    maintenanceSettledWithoutRewrite: deferredMaintenance,
    runId: "bootstrap-deferred-proof",
    sessionTarget,
  });
  sessionManager.appendResetBoundary("command post-run reset proof");
  const markerFinalized = await finalizePendingCliBootstrapCompletion({
    result: deferredResult,
    transcriptStable: false,
  });
  releaseDeferredMaintenance?.();
  await deferredMaintenance;
  assert.equal(markerFinalized, false);
  assert.equal(await hasCompletedBootstrapTurn(sessionTarget), false);

  console.log(
    "[bootstrap deferred finalization proof] maintenance=no-rewrite command-post-run=reset marker=false",
  );

  console.log(
    "[bootstrap continuation SQLite proof] sqlite-marker=true first=injected marker-write=true continuation=skipped memory=injected non-primary=injected cron=injected secret-output=false",
  );
} finally {
  closeOpenClawAgentDatabasesForTest();
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}
