import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const pluginId = "proof-multi-profile-plugin";
const providerId = "openai";
const readyProfileId = `${providerId}:ready`;
const rejectedProfileId = `${providerId}:rejected`;
const modelId = "proof-model";
const port = 19821;
const baseUrl = `http://127.0.0.1:${port}/`;
const gatewayToken = "proof-only-gateway-token";
const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA;
const artifactDir = path.resolve(".artifacts/control-ui-e2e/pr-122300-real-gateway");

if (!targetSha || !/^[0-9a-f]{40}$/.test(targetSha)) {
  throw new Error("OPENCLAW_PROOF_HEAD_SHA must be an immutable full SHA");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function waitForGateway(gateway) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (gateway.exitCode !== null) {
      throw new Error(`Gateway exited before readiness with ${gateway.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Gateway did not serve the built Control UI within 30 seconds");
}

function parseFrame(payload) {
  try {
    return JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8"));
  } catch {
    return undefined;
  }
}

const responsePayload = (frame) => frame?.payload ?? frame?.result;
const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-pr-122300-proof-"));
const stateDir = path.join(runtimeDir, "state");
const pluginDir = path.join(runtimeDir, "plugin");
const pluginPath = path.join(pluginDir, "index.mjs");
const configPath = path.join(stateDir, "openclaw.json");
const gatewayLogPath = path.join(artifactDir, "gateway.log");
let browser;
let context;
let gateway;
let gatewayStdout = "";
let gatewayStderr = "";

try {
  await mkdir(stateDir, { recursive: true });
  await mkdir(pluginDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, "openclaw.plugin.json"),
    `${JSON.stringify(
      {
        id: pluginId,
        name: "PR 122300 profile-scope proof",
        activation: { onStartup: true },
        enabledByDefault: true,
        providers: [providerId],
        modelCatalog: { discovery: { [providerId]: "runtime" } },
        configSchema: { type: "object", additionalProperties: false, properties: {} },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    pluginPath,
    `export default {
  id: ${JSON.stringify(pluginId)},
  name: "PR 122300 proof provider",
  register(api) {
    api.registerProvider({
      id: ${JSON.stringify(providerId)},
      label: "OpenAI",
      auth: [],
      catalog: {
        order: "profile",
        async run() {
          return {
            provider: {
              baseUrl: "http://127.0.0.1:9",
              api: "openai-responses",
              apiKey: "proof-catalog-key-not-used",
              models: [{
                id: ${JSON.stringify(modelId)},
                name: "Proof Model",
                input: ["text"],
                contextWindow: 8192,
                maxTokens: 1024
              }]
            },
            outcomes: [
              { provider: ${JSON.stringify(providerId)}, profileId: ${JSON.stringify(rejectedProfileId)}, status: "auth-rejected" },
              { provider: ${JSON.stringify(providerId)}, profileId: ${JSON.stringify(readyProfileId)}, status: "ready" }
            ]
          };
        }
      }
    });
  }
};\n`,
    "utf8",
  );
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        agents: { defaults: { model: { primary: `${providerId}/${modelId}` } } },
        auth: { order: { [providerId]: [readyProfileId, rejectedProfileId] } },
        gateway: { mode: "local", auth: { mode: "token" } },
        plugins: {
          enabled: true,
          allow: [pluginId],
          load: { paths: [pluginDir] },
          entries: { [pluginId]: { enabled: true } },
          slots: { memory: "none" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const proofEnv = {
    ...process.env,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    NO_COLOR: "1",
  };
  for (const [profileId, token] of [
    [readyProfileId, "fixture-ready-token"],
    [rejectedProfileId, "fixture-rejected-token"],
  ]) {
    await run(
      process.execPath,
      [
        "openclaw.mjs",
        "models",
        "auth",
        "paste-token",
        "--provider",
        providerId,
        "--profile-id",
        profileId,
      ],
      { env: proofEnv, input: `${token}\n` },
    );
  }

  gateway = spawn(
    process.execPath,
    ["openclaw.mjs", "gateway", "--port", String(port), "--bind", "loopback", "--force"],
    { cwd: process.cwd(), env: proofEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  gateway.stdout.on("data", (chunk) => {
    gatewayStdout += chunk;
  });
  gateway.stderr.on("data", (chunk) => {
    gatewayStderr += chunk;
  });
  await waitForGateway(gateway);

  browser = await chromium.launch();
  context = await browser.newContext({
    colorScheme: "dark",
    locale: "en-US",
    recordVideo: { dir: artifactDir, size: { width: 1440, height: 1000 } },
    serviceWorkers: "block",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const pendingMethods = new Map();
  const gatewayFrames = {};
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = parseFrame(payload);
      if (frame?.id && frame?.method) {
        pendingMethods.set(frame.id, frame.method);
      }
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = parseFrame(payload);
      const method = frame?.id ? pendingMethods.get(frame.id) : undefined;
      if (method === "models.authStatus") {
        gatewayFrames.authStatus = frame;
      }
      if (method === "models.list" && responsePayload(frame)?.providerOutcomes) {
        gatewayFrames.modelsList = frame;
      }
    });
  });

  const response = await page.goto(`${baseUrl}settings/model-providers#token=${gatewayToken}`);
  if (!response?.ok()) {
    throw new Error(`Control UI returned ${response?.status() ?? "no response"}`);
  }
  const card = page.locator(`[data-provider-id="${providerId}"]`);
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    (id) => document.querySelector(`[data-provider-id="${id}"]`)?.textContent?.includes("Ready"),
    providerId,
    { timeout: 30_000 },
  );
  const cardText = (await card.textContent())?.replaceAll(/\s+/g, " ").trim() ?? "";
  if (!cardText.includes("Ready") || cardText.includes("Credentials rejected")) {
    throw new Error(`Unexpected provider card state: ${cardText}`);
  }
  if (!gatewayFrames.modelsList || !gatewayFrames.authStatus) {
    throw new Error("Did not capture real Gateway models.list and models.authStatus frames");
  }

  const modelsList = responsePayload(gatewayFrames.modelsList);
  const authStatus = responsePayload(gatewayFrames.authStatus);
  const outcomes = modelsList.providerOutcomes.filter((item) => item.provider === providerId);
  const profiles =
    authStatus.providers
      .find((item) => item.provider === providerId)
      ?.profiles?.map((item) => item.profileId) ?? [];
  if (
    outcomes.length !== 2 ||
    !outcomes.some((item) => item.profileId === readyProfileId && item.status === "ready") ||
    !outcomes.some(
      (item) => item.profileId === rejectedProfileId && item.status === "auth-rejected",
    ) ||
    !profiles.includes(readyProfileId) ||
    !profiles.includes(rejectedProfileId)
  ) {
    throw new Error(`Missing multi-profile evidence: ${JSON.stringify({ outcomes, profiles })}`);
  }

  await page.screenshot({
    path: path.join(artifactDir, "provider-card-ready.png"),
    fullPage: true,
  });
  await writeFile(
    path.join(artifactDir, "gateway-frames.json"),
    `${JSON.stringify({ authStatus: gatewayFrames.authStatus, modelsList: gatewayFrames.modelsList }, null, 2)}\n`,
  );
  await writeFile(
    path.join(artifactDir, "verdict.json"),
    `${JSON.stringify(
      {
        targetSha,
        realGateway: true,
        realChromium: true,
        savedProfiles: profiles.sort(),
        providerOutcomes: outcomes,
        providerCard: { containsReady: true, containsCredentialsRejected: false, text: cardText },
        verdict: "pass",
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `[control-ui multi-profile real-gateway proof] exact-head=${targetSha} saved-profiles=2 ready-outcome=true rejected-outcome=true provider-card-ready=true credentials-rejected=false real-gateway=true real-chromium=true`,
  );
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (gateway && gateway.exitCode === null) {
    gateway.kill("SIGTERM");
    await Promise.race([
      once(gateway, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (gateway.exitCode === null) {
      gateway.kill("SIGKILL");
    }
  }
  await writeFile(gatewayLogPath, `${gatewayStdout}\n${gatewayStderr}`).catch(() => {});
  await rm(runtimeDir, { recursive: true, force: true });
}
