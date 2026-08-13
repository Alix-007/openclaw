import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const targetRoot = process.cwd();
const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA ?? "";
assert.match(targetSha, /^[0-9a-f]{40}$/u);

const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-bootstrap-proof-"));
process.env.HOME = path.join(runtimeRoot, "home");
process.env.OPENCLAW_STATE_DIR = path.join(runtimeRoot, "state");
await fs.mkdir(process.env.HOME, { recursive: true });
await fs.mkdir(process.env.OPENCLAW_STATE_DIR, { recursive: true });

const importTarget = async (relativePath: string) =>
  await import(pathToFileURL(path.join(targetRoot, relativePath)).href);
const { upsertSessionEntryCore } = await importTarget("src/config/sessions/session-accessor.ts");
const { hasCompletedBootstrapTurn } = await importTarget("src/agents/bootstrap-files.ts");
const { resolveBootstrapContextInjection, resolveWorkspaceBootstrapRouting } = await importTarget(
  "src/agents/bootstrap-routing.ts",
);
const { createTestAdmittedRunContext } = await importTarget(
  "src/agents/admitted-run-context.test-support.ts",
);
const { markPreparedCliBootstrapCompletion } = await importTarget(
  "src/agents/cli-bootstrap-completion-state.ts",
);
const { runPreparedCliAgent } = await importTarget("src/agents/cli-runner.ts");
const { closeOpenClawAgentDatabasesForTest } = await importTarget(
  "src/state/openclaw-agent-db.ts",
);

const cliBackend = {
  command: process.execPath,
  args: ["-e", "process.stdout.write('cli-backed proof reply')"],
  output: "text",
  input: "arg",
  sessionMode: "none",
  serialize: true,
};

function createSessionTarget(label: string) {
  return {
    agentId: "main",
    sessionId: randomUUID(),
    sessionKey: `agent:main:bootstrap-proof-${label}`,
    storePath: path.join(runtimeRoot, "sessions.json"),
  };
}

function buildCliContext(params: {
  runId: string;
  sessionTarget: ReturnType<typeof createSessionTarget>;
}) {
  return {
    params: {
      admittedRunContext: createTestAdmittedRunContext(params.runId),
      sessionId: params.sessionTarget.sessionId,
      sessionKey: params.sessionTarget.sessionKey,
      sessionFile: path.join(runtimeRoot, `${params.runId}.jsonl`),
      sessionTarget: params.sessionTarget,
      storePath: params.sessionTarget.storePath,
      workspaceDir: runtimeRoot,
      agentId: params.sessionTarget.agentId,
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
      pluginId: "proof-cli",
      config: cliBackend,
      bundleMcp: false,
    },
    preparedBackend: { backend: cliBackend, env: {}, cleanup: async () => undefined },
    reusableCliSession: { mode: "none" },
    hadSessionFile: false,
    contextEngineConfig: {},
    modelId: "proof-model",
    normalizedModel: "proof-model",
    systemPrompt: "OpenClaw exact-head CLI bootstrap proof.",
    systemPromptReport: {},
    bootstrapPromptWarningLines: [],
    authEpochVersion: 2,
  };
}

async function resolveTurn(params: {
  sessionTarget: ReturnType<typeof createSessionTarget>;
  trigger: string;
  runKind?: "default" | "cron";
}) {
  const routing = await resolveWorkspaceBootstrapRouting({
    isWorkspaceBootstrapPending: async () => false,
    trigger: params.trigger,
    isPrimaryRun: true,
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
    hasCompletedBootstrapTurn: async () => await hasCompletedBootstrapTurn(params.sessionTarget),
    resolveBootstrapContextForRun: async () => ({
      bootstrapFiles: [{ name: "AGENTS.md" }],
      contextFiles: [{ path: "AGENTS.md" }],
    }),
  });
}

async function runCli(params: {
  runId: string;
  sessionTarget: ReturnType<typeof createSessionTarget>;
  recordCompletion: boolean;
}) {
  const context = buildCliContext(params);
  if (params.recordCompletion) {
    markPreparedCliBootstrapCompletion(context, "runner");
  }
  const result = await runPreparedCliAgent(context);
  assert.equal(result.payloads?.[0]?.text, "cli-backed proof reply");
}

try {
  const eligibleTarget = createSessionTarget("eligible");
  await upsertSessionEntryCore(eligibleTarget, {
    sessionId: eligibleTarget.sessionId,
    updatedAt: Date.now(),
  });
  const first = await resolveTurn({ sessionTarget: eligibleTarget, trigger: "user" });
  assert.equal(first.isContinuationTurn, false);
  assert.equal(first.shouldRecordCompletedBootstrapTurn, true);
  assert.equal(first.contextFiles.length, 1);
  await runCli({ runId: "eligible-first", sessionTarget: eligibleTarget, recordCompletion: true });
  assert.equal(await hasCompletedBootstrapTurn(eligibleTarget), true);

  const second = await resolveTurn({ sessionTarget: eligibleTarget, trigger: "user" });
  assert.equal(second.isContinuationTurn, true);
  assert.equal(second.shouldRecordCompletedBootstrapTurn, false);
  assert.equal(second.contextFiles.length, 0);
  await runCli({ runId: "eligible-second", sessionTarget: eligibleTarget, recordCompletion: false });
  assert.equal(await hasCompletedBootstrapTurn(eligibleTarget), true);

  const ineligibleWithMarker = await resolveTurn({
    sessionTarget: eligibleTarget,
    trigger: "cron",
    runKind: "cron",
  });
  assert.equal(ineligibleWithMarker.isContinuationTurn, false);
  assert.equal(ineligibleWithMarker.shouldRecordCompletedBootstrapTurn, false);
  assert.equal(ineligibleWithMarker.contextFiles.length, 1);
  assert.equal(await hasCompletedBootstrapTurn(eligibleTarget), true);

  const ineligibleTarget = createSessionTarget("ineligible");
  await upsertSessionEntryCore(ineligibleTarget, {
    sessionId: ineligibleTarget.sessionId,
    updatedAt: Date.now(),
  });
  assert.equal(await hasCompletedBootstrapTurn(ineligibleTarget), false);
  const ineligible = await resolveTurn({
    sessionTarget: ineligibleTarget,
    trigger: "cron",
    runKind: "cron",
  });
  assert.equal(ineligible.isContinuationTurn, false);
  assert.equal(ineligible.shouldRecordCompletedBootstrapTurn, false);
  assert.equal(ineligible.contextFiles.length, 1);
  await runCli({
    runId: "ineligible-control",
    sessionTarget: ineligibleTarget,
    recordCompletion: false,
  });
  assert.equal(await hasCompletedBootstrapTurn(ineligibleTarget), false);

  console.log(
    JSON.stringify({
      proof: "bootstrap-cli-sqlite-three-state",
      targetSha,
      node: process.version,
      cliSubprocess: true,
      sqliteMarker: true,
      firstEligible: "injected",
      firstMarkerWrite: true,
      secondEligible: "skipped",
      ineligibleControl: "cron",
      ineligibleMarkerWrite: false,
      ineligibleMarkerConsumed: false,
      secretOutput: false,
    }),
  );
} finally {
  closeOpenClawAgentDatabasesForTest();
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}
