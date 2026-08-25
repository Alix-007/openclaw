import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const outputDir = process.env.PROOF_OUTPUT_DIR;
assert(outputDir, "PROOF_OUTPUT_DIR is required");
const expectedHead = process.env.PROOF_PRODUCT_HEAD;
assert(expectedHead, "PROOF_PRODUCT_HEAD is required");
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  expectedHead,
  "proof checkout must match the declared product head",
);

const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pr129481-proof-"));
const workspaceDir = path.join(proofDir, "workspace");
const stateDir = path.join(proofDir, "state");
const sessionFile = path.join(stateDir, "agents", "main", "sessions", "proof-session.jsonl");
const failingCli = path.join(proofDir, "fail.mjs");
const loggerFile = path.join(proofDir, "openclaw.log");
const configFile = path.join(proofDir, "openclaw.json");
const secret = process.env.PROOF_BEARER_SECRET;
assert(secret, "PROOF_BEARER_SECRET is required");
const sessionKey = process.env.PROOF_SESSION_KEY;
assert(sessionKey, "PROOF_SESSION_KEY is required");
const runId = "proof-pr129481-terminal";
const provider = "fixture-cli";
const model = "fixture-model";

fs.mkdirSync(workspaceDir, { recursive: true });
fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  sessionFile,
  `${JSON.stringify({
    type: "session",
    version: 3,
    id: "proof-session",
    timestamp: new Date(0).toISOString(),
    cwd: workspaceDir,
  })}\n`,
  "utf8",
);
fs.writeFileSync(
  failingCli,
  `process.stderr.write("Authorization: Bearer ${secret}\\n"); process.exitCode = 1;\n`,
  "utf8",
);

const config = {
  logging: {
    level: "warn" as const,
    file: loggerFile,
    consoleLevel: "warn" as const,
    consoleStyle: "compact" as const,
  },
  agents: { defaults: { workspace: workspaceDir } },
};
fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");

process.env.HOME = proofDir;
process.env.OPENCLAW_CONFIG_PATH = configFile;
process.env.OPENCLAW_STATE_DIR = stateDir;
process.env.NODE_ENV = "test";
process.env.NO_COLOR = "1";

const [{ testing: cliBackendsTesting }, { runCliAgent }, admission, diagnostics, logging] =
  await Promise.all([
    import("./src/agents/cli-backends.test-support.ts"),
    import("./src/agents/cli-runner.ts"),
    import("./src/agents/admitted-run-context.ts"),
    import("./src/infra/diagnostic-event-listener-presence.ts"),
    import("./src/logging/logger.ts"),
  ]);

assert.equal(
  diagnostics.hasInternalDiagnosticEventListeners(),
  false,
  "proof must run without diagnostic listeners",
);

cliBackendsTesting.setDepsForTest({
  resolvePluginSetupCliBackend: () => undefined,
  resolvePluginSetupRegistry: () => ({ cliBackends: [] }) as never,
  resolveRuntimeCliBackends: () => [
    {
      id: provider,
      pluginId: "proof-fixture",
      config: {
        command: process.execPath,
        args: [failingCli],
        output: "text",
        input: "arg",
        sessionMode: "none",
        systemPromptWhen: "never",
      },
    },
  ],
});

const preparedAdmission = admission.prepareSystemAgentRunAdmission(
  config,
  runId,
  "main",
  "proof.pr-129481",
);
const admittedRunContext = await preparedAdmission.admit("cli", "proof-real-node-child");
let rejected = false;
try {
  await runCliAgent({
    admittedRunContext,
    sessionId: "proof-session",
    sessionKey,
    sessionFile,
    workspaceDir,
    prompt: "fail now",
    provider,
    model,
    timeoutMs: 5_000,
    runId,
    config,
  });
} catch {
  rejected = true;
} finally {
  preparedAdmission.close();
  cliBackendsTesting.resetDepsForTest();
  await logging.flushLogger();
}

assert.equal(rejected, true, "terminal CLI failure must reject");
assert.equal(
  diagnostics.hasInternalDiagnosticEventListeners(),
  false,
  "proof must leave diagnostic listeners absent",
);

const loggerText = fs.readFileSync(loggerFile, "utf8");
const terminalLines = loggerText
  .split("\n")
  .filter((line) => line.includes("cli terminal failure:"));
assert.equal(terminalLines.length, 1, "real file logger must contain exactly one terminal warning");

const terminalLine = terminalLines[0];
assert(terminalLine.includes(`provider=${provider}`));
assert(terminalLine.includes(`model=${model}`));
assert(terminalLine.includes(`runId=${runId}`));
assert.match(terminalLine, /durationMs=\d+/);
assert(terminalLine.includes("Authorization: Bearer"));
assert(!terminalLine.includes(secret));
assert(!terminalLine.includes(sessionKey));

fs.writeFileSync(path.join(outputDir, "logger-record.jsonl"), `${terminalLine}\n`, "utf8");
fs.writeFileSync(
  path.join(outputDir, "harness-verdict.json"),
  `${JSON.stringify(
    {
      pass: true,
      productHead: expectedHead,
      generatedAt: JSON.parse(terminalLine)._meta.date,
      nodeVersion: process.version,
      productionEntryPoint: "src/agents/cli-runner.ts#runCliAgent",
      realSubprocess: true,
      subprocessExecutable: `Node ${process.version}`,
      subprocessExitCode: 1,
      realLoggerSink: "configured OpenClaw JSONL file transport",
      diagnosticsListeners: false,
      terminalWarningCount: terminalLines.length,
      providerPresent: terminalLine.includes(`provider=${provider}`),
      modelPresent: terminalLine.includes(`model=${model}`),
      durationMsPresent: /durationMs=\d+/.test(terminalLine),
      runIdPresent: terminalLine.includes(`runId=${runId}`),
      bearerLabelPresent: terminalLine.includes("Authorization: Bearer"),
      fullSecretAbsent: !terminalLine.includes(secret),
      sessionKeyAbsent: !terminalLine.includes(sessionKey),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
