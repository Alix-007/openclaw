import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const source = process.cwd();
const output = path.resolve(".proof-output");
const variant = process.env.PROOF_VARIANT ?? "baseline";
assert(["baseline", "patched"].includes(variant));
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "alix-final-tags-"));
const state = path.join(temp, "state");
const workspace = path.join(temp, "workspace");
await fs.mkdir(state);
await fs.mkdir(workspace);
const configPath = path.join(temp, "openclaw.json");
const responsePath = path.join(temp, "response.json");
const requestPath = path.join(temp, "requests.jsonl");
const example = "Example:\n```xml\n<final data-model=\"demo\">payload</final>\n```\nWrite `<final>inline</final>` as XML.";
const input = `<final>Outside answer</final>\n\n${example}`;
const expected = `Outside answer\n\n${example}`;
const oldOutput = 'Outside answer\n\nExample:\n```xml\npayload\n```\nWrite `inline` as XML.';
const { applyMockOpenAiModelConfig } = await import(
  pathToFileURL(path.join(source, "scripts/e2e/lib/fixtures/mock-openai-config.mjs"))
);
const config = {
  env: { shellEnv: { enabled: false } },
  agents: {
    ownership: "explicit",
    defaults: { workspace, skipBootstrap: true, systemAgent: { agentId: "main" } },
    entries: { main: {} },
  },
};
applyMockOpenAiModelConfig(config, { mockPort: 44180 });
await fs.writeFile(configPath, JSON.stringify(config));
await fs.writeFile(responsePath, JSON.stringify({ text: input }));
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: state,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_WORKSPACE_DIR: workspace,
  OPENAI_API_KEY: "sk-secretless-fixture-only",
  MOCK_PORT: "44180",
  MOCK_RESPONSE_CONTROL: responsePath,
  MOCK_REQUEST_LOG: requestPath,
  NO_COLOR: "1",
};
const mockLog = createWriteStream(path.join(output, "mock.log"));
const mock = spawn(process.execPath, ["scripts/e2e/mock-openai-server.mjs"], {
  cwd: source,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
mock.stdout.pipe(mockLog);
mock.stderr.pipe(mockLog);
const mockExit = new Promise((resolve) => mock.once("exit", resolve));
let cleanupDone = false;
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:44180/health", {
        signal: AbortSignal.timeout(1000),
      });
      ready = response.ok;
      await response.body?.cancel();
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, "existing mock provider did not become ready");
  const sessionId = `alix-final-tags-${variant}`;
  const args = [
    "--silent", "openclaw", "agent", "--local", "--agent", "main",
    "--session-id", sessionId, "--channel", "telegram", "--message",
    "Return the fixture response exactly.", "--thinking", "off", "--timeout", "60", "--json",
  ];
  let result;
  try {
    result = await run("pnpm", args, { cwd: source, env, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    await fs.writeFile(path.join(output, "agent.stdout"), error.stdout ?? "");
    await fs.writeFile(path.join(output, "agent.stderr"), error.stderr ?? "");
    throw error;
  }
  await fs.writeFile(path.join(output, "agent.stdout"), result.stdout);
  await fs.writeFile(path.join(output, "agent.stderr"), result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert(!envelope.meta?.error && !envelope.meta?.aborted, "agent did not finish successfully");
  const texts = envelope.payloads.filter((item) => !item.isError && typeof item.text === "string").map((item) => item.text);
  assert.equal(texts.length, 1);
  const actual = texts[0];
  const requests = (await fs.readFile(requestPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert(requests.some((item) => item.path === "/v1/responses"), "real model request missing");
  const receipt = {
    variant, command: ["pnpm", ...args], sourceBase: "336b75a11d13bd173582dc7e3064b412c133bdcd",
    observedAt: new Date().toISOString(), sessionId, input, expected, actual,
    owner: "src/shared/text/final-tags.ts", boundary: "real CLI agent payload JSON; existing loopback mock provider",
    providerRequests: requests.map(({ method, path: requestRoute }) => ({ method, path: requestRoute })),
    control: !actual.includes("<final>Outside answer</final>") && actual.includes("Outside answer"),
    noChannelDelivery: !args.includes("--deliver"),
    limitations: "No live provider or external channel transport; no browser validation.",
  };
  await fs.writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  assert(receipt.control, "outside control changed");
  assert.equal(actual, variant === "baseline" ? oldOutput : expected);
  console.log(JSON.stringify({ variant, status: variant === "baseline" ? "ACCEPTANCE_RED_CONFIRMED" : "ACCEPTANCE_GREEN", sessionId, actual }));
} finally {
  if (mock.exitCode === null) mock.kill("SIGTERM");
  await mockExit;
  mockLog.end();
  // Only disposable state created by this proof is removed; evidence is retained separately.
  await fs.rm(temp, { recursive: true });
  cleanupDone = true;
  await fs.writeFile(path.join(output, "cleanup.json"), JSON.stringify({ cleanupDone, productionTouched: false }));
}
