import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ExpectedBehavior = "head-green" | "parent-red";

type CompletionCall = {
  outcomeStatus?: string;
  source: string;
};

type Scenario = {
  childSessionKey: string;
  expectedSessionKey: string;
  kind: "collision" | "structural-control";
  name: "matrix" | "signal" | "structural-control";
  siblingSessionKey?: string;
};

type ScenarioResult = {
  calls: CompletionCall[];
  expectation: ExpectedBehavior;
  name: Scenario["name"];
  registryRows: number;
  sessionRows: number;
};

const sourceRoot = path.resolve(process.env.OPENCLAW_PROOF_SOURCE_ROOT ?? process.cwd());
const expectation = process.env.OPENCLAW_PROOF_EXPECTATION as ExpectedBehavior | undefined;
if (expectation !== "head-green" && expectation !== "parent-red") {
  throw new Error("OPENCLAW_PROOF_EXPECTATION must be head-green or parent-red");
}

function sourceModule(relativePath: string): string {
  return pathToFileURL(path.join(sourceRoot, relativePath)).href;
}

const sessionAccessor = await import(sourceModule("src/config/sessions/session-accessor.ts"));
const agentDatabase = await import(sourceModule("src/state/openclaw-agent-db.ts"));
const stateDatabase = await import(sourceModule("src/state/openclaw-state-db.ts"));
const registryStore = await import(
  sourceModule("src/agents/subagents/registry/subagent-registry.store.sqlite.ts")
);
const { createSubagentRegistrySweeper } = await import(
  sourceModule("src/agents/subagents/registry/subagent-registry-sweeper.ts")
);

const scenarios: Scenario[] = [
  {
    name: "matrix",
    kind: "collision",
    childSessionKey: "AGENT:MAIN:matrix:GROUP:!room:server",
    expectedSessionKey: "agent:main:matrix:group:!room:server",
    siblingSessionKey: "agent:main:matrix:group:!room:Server",
  },
  {
    name: "signal",
    kind: "collision",
    childSessionKey: "AGENT:MAIN:signal:GROUP:abcdef==",
    expectedSessionKey: "agent:main:signal:group:abcdef==",
    siblingSessionKey: "agent:main:signal:group:Abcdef==",
  },
  {
    name: "structural-control",
    kind: "structural-control",
    childSessionKey: "AGENT:MAIN:telegram:GROUP:ROOM",
    expectedSessionKey: "agent:main:telegram:group:room",
  },
];

function closeDatabases(): void {
  agentDatabase.closeOpenClawAgentDatabasesForTest();
  stateDatabase.closeOpenClawStateDatabaseForTest();
}

function assertScenario(result: ScenarioResult, scenario: Scenario): void {
  const falseCompletion = result.calls.some(
    (call) => call.source === "sweeper-session-completion" && call.outcomeStatus === "ok",
  );
  const lostContext = result.calls.some(
    (call) => call.source === "sweeper-lost-context" && call.outcomeStatus === "error",
  );
  if (scenario.kind === "structural-control") {
    if (!falseCompletion) {
      throw new Error("structural control did not complete with outcome ok");
    }
    return;
  }
  if (expectation === "parent-red" && !falseCompletion) {
    throw new Error(`${scenario.name} did not reproduce the parent false completion`);
  }
  if (expectation === "head-green" && (falseCompletion || !lostContext)) {
    throw new Error(`${scenario.name} did not reject the collision before lost-context cleanup`);
  }
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const stateDir = await mkdtemp(path.join(tmpdir(), "openclaw-session-proof-"));
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  closeDatabases();

  try {
    const now = Date.now();
    const storePath = path.join(stateDir, "agents", "main", "sessions", "sessions.json");
    if (scenario.siblingSessionKey) {
      await sessionAccessor.replaceSessionEntry(
        { storePath, sessionKey: scenario.siblingSessionKey },
        {
          sessionId: `${scenario.name}-sibling-session`,
          status: "done",
          startedAt: now - 5_000,
          endedAt: now - 1_000,
          updatedAt: now - 1_000,
        },
      );
    }
    await sessionAccessor.replaceSessionEntry(
      { storePath, sessionKey: scenario.expectedSessionKey },
      {
        sessionId: `${scenario.name}-expected-session`,
        status: scenario.kind === "structural-control" ? "done" : "running",
        startedAt: now - 5_000,
        ...(scenario.kind === "structural-control" ? { endedAt: now - 1_000 } : {}),
        updatedAt: now - 1_000,
      },
    );

    const runId = `${scenario.name}-run`;
    const persistedRuns = new Map([
      [
        runId,
        {
          runId,
          childSessionKey: scenario.childSessionKey,
          requesterSessionKey: "agent:main:main",
          requesterDisplayKey: "main",
          task: `${scenario.name} reconciliation proof`,
          cleanup: "keep",
          createdAt: now - 65_000,
          execution: { status: "running", startedAt: now - 61_000 },
          completion: { required: false },
          delivery: { status: "not_required" },
          expectsCompletionMessage: false,
        },
      ],
    ]);
    registryStore.saveSubagentRegistryToSqlite(persistedRuns);
    closeDatabases();

    const runs = registryStore.loadSubagentRegistryFromSqlite();
    const sessionRows = sessionAccessor.listSessionEntries({ storePath }).length;
    const registryRows = runs.size;
    if (sessionRows !== (scenario.siblingSessionKey ? 2 : 1) || registryRows !== 1) {
      throw new Error(`${scenario.name} SQLite row counts are not canonical`);
    }

    const calls: CompletionCall[] = [];
    const childRuns = (childSessionKey: string) =>
      [...runs.values()].filter((entry) => entry.childSessionKey === childSessionKey);
    const sweeper = createSubagentRegistrySweeper({
      runs,
      resumedRuns: new Set(),
      persist: () => {},
      clearPendingLifecycleError: () => {},
      clearPendingLifecycleTimeout: () => {},
      sweepPendingLifecycle: () => {},
      completeSubagentRunWithRecovery: async (
        completion: { outcome?: { status?: string } },
        source: string,
      ) => {
        calls.push({ source, outcomeStatus: completion.outcome?.status });
      },
      getGatewayRecoveryRuntime: () => undefined,
      abandonSubagentRestartRecoveryLaunch: () => true,
      clearAcceptedSubagentRestartRecovery: () => true,
      resumeSettledSubagentRestartRecovery: () => true,
      replaceSubagentRunAfterSteer: () => true,
      markSubagentRestartRecoveryLaunchAttempted: (params: {
        idempotencyKey: string;
        lifecycleGeneration?: string;
        sessionMarker: string;
      }) => ({
        sessionId: "proof-session",
        sessionMarker: params.sessionMarker,
        idempotencyKey: params.idempotencyKey,
        lifecycleGeneration: params.lifecycleGeneration,
        phase: "attempted",
      }),
      markSubagentRestartRecoveryLaunchAccepted: (params: {
        idempotencyKey: string;
        sessionMarker: string;
      }) => ({
        sessionId: "proof-session",
        sessionMarker: params.sessionMarker,
        idempotencyKey: params.idempotencyKey,
        phase: "accepted",
      }),
      markSubagentRestartRecoveryLaunchConsumed: (params: {
        idempotencyKey: string;
        sessionMarker: string;
      }) => ({
        sessionId: "proof-session",
        sessionMarker: params.sessionMarker,
        idempotencyKey: params.idempotencyKey,
        phase: "consumed",
      }),
      reserveSubagentRestartRecoveryLaunch: (params: { idempotencyKey: string }) =>
        params.idempotencyKey,
      resetSubagentRestartRecoveryLaunchAttempt: () => true,
      finalizeInterruptedSubagentRun: async () => 0,
      resumeRequesterSettleWake: async () => {},
      startSubagentAnnounceCleanupFlow: () => true,
      completeCleanupBookkeeping: async () => {},
      discardTerminalDelivery: () => {},
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: async () => {},
      callGateway: async () => ({}),
      cleanupCollectorLaunchResources: async () => true,
      runContextEngineSubagentEnded: async () => {},
      notifyContextEngineSubagentEnded: async () => {},
      retireSupersededRun: async () => {},
      getRunsForChildSession: childRuns,
      getRunsForCollectorGroup: () => [],
      warn: (message: string) => {
        throw new Error(message);
      },
    });
    await sweeper.sweepOnce();
    sweeper.reset();

    const result: ScenarioResult = {
      calls,
      expectation,
      name: scenario.name,
      registryRows,
      sessionRows,
    };
    assertScenario(result, scenario);
    return result;
  } finally {
    closeDatabases();
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    await rm(stateDir, { recursive: true, force: true });
  }
}

const results: ScenarioResult[] = [];
for (const scenario of scenarios) {
  results.push(await runScenario(scenario));
}

const artifact = {
  expectation,
  sourceSha: process.env.OPENCLAW_PROOF_SOURCE_SHA,
  sourceBlob: process.env.OPENCLAW_PROOF_SOURCE_BLOB,
  harnessBlob: process.env.OPENCLAW_PROOF_HARNESS_BLOB,
  results,
};
const artifactDir = process.env.OPENCLAW_PROOF_ARTIFACT_DIR;
if (artifactDir) {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, `subagent-session-${expectation}.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
}

console.log(JSON.stringify(artifact));
console.log(
  `[subagent session SQLite proof] expectation=${expectation} matrix=true signal=true structural-control=true`,
);
