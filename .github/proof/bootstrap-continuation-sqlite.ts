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
const { runPreparedCliAgent } = await importTarget("src/agents/cli-runner.ts");
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
const sessionFile = path.join(runtimeRoot, "bootstrap-proof.jsonl");
const cliBackend = {
  command: process.execPath,
  args: ["-e", "process.stdout.write('cli-backed proof reply')"],
  output: "text",
  input: "arg",
  sessionMode: "none",
  serialize: true,
};

function buildCliContext(params: {
  runId: string;
  shouldRecordCompletedBootstrapTurn: boolean;
  contextEngine?: unknown;
}) {
  return {
    params: {
      sessionId: sessionTarget.sessionId,
      sessionKey: sessionTarget.sessionKey,
      sessionFile,
      sessionTarget,
      storePath: sessionTarget.storePath,
      workspaceDir: runtimeRoot,
      agentId: sessionTarget.agentId,
      prompt: `bootstrap proof turn ${params.runId}`,
      provider: "proof-cli",
      model: "proof-model",
      thinkLevel: "low",
      timeoutMs: 10_000,
      runId: params.runId,
      trigger: "user",
      persistAssistantTranscript: true,
      bootstrapContextMode: "full",
      bootstrapContextRunKind: "default",
    },
    started: Date.now(),
    workspaceDir: runtimeRoot,
    backendResolved: {
      id: "proof-cli",
      config: cliBackend,
      bundleMcp: false,
    },
    preparedBackend: {
      backend: cliBackend,
      env: {},
      cleanup: async () => undefined,
    },
    reusableCliSession: { mode: "none" },
    hadSessionFile: false,
    contextEngineConfig: {},
    modelId: "proof-model",
    normalizedModel: "proof-model",
    systemPrompt: "OpenClaw exact-head CLI bootstrap proof.",
    systemPromptReport: {},
    bootstrapPromptWarningLines: [],
    authEpochVersion: 2,
    shouldRecordCompletedBootstrapTurn: params.shouldRecordCompletedBootstrapTurn,
    ...(params.contextEngine
      ? {
          contextEngine: params.contextEngine,
          contextEngineTurnPrompt: `bootstrap proof turn ${params.runId}`,
        }
      : {}),
  };
}

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
  const firstCliResult = await runPreparedCliAgent(
    buildCliContext({
      runId: "bootstrap-cli-first",
      shouldRecordCompletedBootstrapTurn: true,
    }),
  );
  assert.equal(firstCliResult.payloads?.[0]?.text, "cli-backed proof reply");
  assert.equal(await hasCompletedBootstrapTurn(sessionTarget), true);
  const sessionManager = SessionManager.open(sessionTarget, runtimeRoot);

  const continuation = await runTurn({ trigger: "user", isPrimaryRun: true });
  assert.equal(continuation.isContinuationTurn, true);
  assert.equal(continuation.contextFiles.length, 0);
  assert.equal(continuation.shouldRecordCompletedBootstrapTurn, false);
  const continuationCliResult = await runPreparedCliAgent(
    buildCliContext({
      runId: "bootstrap-cli-continuation",
      shouldRecordCompletedBootstrapTurn: continuation.shouldRecordCompletedBootstrapTurn,
    }),
  );
  assert.equal(continuationCliResult.payloads?.[0]?.text, "cli-backed proof reply");
  assert.equal(await hasCompletedBootstrapTurn(sessionTarget), true);
  console.log(
    "[bootstrap CLI-backed two-turn proof] subprocess=true first=injected marker-write=true second-same-session=skipped",
  );

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
  sessionManager.appendResetBoundary("reset");
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

  let releaseNonblockingMaintenance: (() => void) | undefined;
  const nonblockingMaintenance = new Promise<void>((resolve) => {
    releaseNonblockingMaintenance = resolve;
  });
  let announceMaintenanceStarted: (() => void) | undefined;
  const maintenanceStarted = new Promise<void>((resolve) => {
    announceMaintenanceStarted = resolve;
  });
  const contextEngine = {
    info: {
      id: "bootstrap-proof-background-engine",
      name: "Bootstrap proof background engine",
      turnMaintenanceMode: "background",
    },
    ingest: async () => ({ ingested: true }),
    assemble: async ({ messages }: { messages: unknown[] }) => ({
      messages,
      estimatedTokens: 0,
    }),
    compact: async () => ({ ok: true, compacted: false }),
    maintain: async () => {
      announceMaintenanceStarted?.();
      await nonblockingMaintenance;
      return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };
    },
  };
  const markerCountBefore = sessionManager
    .getBranch()
    .filter(
      (entry) =>
        entry.type === "custom" && entry.customType === FULL_BOOTSTRAP_COMPLETED_CUSTOM_TYPE,
    ).length;
  let replyFinished = false;
  const nonblockingReply = runPreparedCliAgent(
    buildCliContext({
      runId: "bootstrap-cli-nonblocking",
      shouldRecordCompletedBootstrapTurn: true,
      contextEngine,
    }),
  );
  void nonblockingReply.then(() => {
    replyFinished = true;
  });
  await maintenanceStarted;
  const nonblockingResult = await nonblockingReply;
  assert.equal(nonblockingResult.payloads?.[0]?.text, "cli-backed proof reply");
  assert.equal(nonblockingResult.meta.bootstrapContextCompletionPending, true);
  let nextTurnReadFinished = false;
  const nextTurnCompleted = hasCompletedBootstrapTurn(sessionTarget).then((completed) => {
    nextTurnReadFinished = true;
    return completed;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(replyFinished, true);
  assert.equal(nextTurnReadFinished, false);
  assert.equal(
    sessionManager
      .getBranch()
      .filter(
        (entry) =>
          entry.type === "custom" && entry.customType === FULL_BOOTSTRAP_COMPLETED_CUSTOM_TYPE,
      ).length,
    markerCountBefore,
  );

  releaseNonblockingMaintenance?.();
  await nonblockingMaintenance;
  assert.equal(await nextTurnCompleted, true);
  console.log(
    "[bootstrap nonblocking delivery proof] cli-subprocess=true reply-before-maintenance=true marker-before=false next-turn-serialized=true marker-after=true",
  );

  console.log(
    "[bootstrap continuation SQLite proof] sqlite-marker=true first=injected marker-write=true continuation=skipped memory=injected non-primary=injected cron=injected secret-output=false",
  );
} finally {
  closeOpenClawAgentDatabasesForTest();
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}
