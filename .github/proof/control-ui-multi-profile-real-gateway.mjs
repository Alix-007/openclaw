import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const pluginId = "proof-multi-profile-plugin";
const providerId = "proof-multi-profile";
const defaultAgentId = "main";
const selectedAgentId = "writer";
const readyProfileId = `${providerId}:ready`;
const rejectedProfileId = `${providerId}:rejected`;
const modelId = "proof-model";
const port = 19821;
const baseUrl = `http://127.0.0.1:${port}/`;
const gatewayToken = "proof-only-gateway-token";
const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA;
const rpcOnly = process.env.OPENCLAW_PROOF_RPC_ONLY === "1";
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

async function callGateway(method, params, env) {
  const result = await run(
    process.execPath,
    [
      "openclaw.mjs",
      "gateway",
      "call",
      method,
      "--url",
      `ws://127.0.0.1:${port}`,
      "--token",
      gatewayToken,
      "--params",
      JSON.stringify(params),
      "--timeout",
      "30000",
      "--json",
    ],
    { env },
  );
  return JSON.parse(result.stdout);
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
let activePage;
let gatewayExchanges = [];

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
      label: "Proof Multi-Profile",
      auth: [],
      catalog: {
        order: "profile",
        async run(ctx) {
          const selectedProfileId = ctx.resolveProviderAuth(${JSON.stringify(providerId)}).profileId;
          const selectedAgentReady = selectedProfileId === ${JSON.stringify(readyProfileId)};
          return {
            provider: {
              baseUrl: "http://127.0.0.1:9",
              api: "openai-completions",
              models: [{
                id: ${JSON.stringify(modelId)},
                name: "Proof Model",
                input: ["text"],
                contextWindow: 8192,
                maxTokens: 1024
              }]
            },
            outcomes: selectedAgentReady
              ? [
                  { provider: ${JSON.stringify(providerId)}, profileId: ${JSON.stringify(rejectedProfileId)}, status: "auth-rejected" },
                  { provider: ${JSON.stringify(providerId)}, profileId: ${JSON.stringify(readyProfileId)}, status: "ready" }
                ]
              : [{ provider: ${JSON.stringify(providerId)}, status: "auth-rejected" }]
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
        agents: {
          defaults: {
            model: { primary: `${providerId}/${modelId}` },
            models: { [`${providerId}/${modelId}`]: {} },
          },
          entries: {
            [defaultAgentId]: { default: true, identity: { name: "Main" } },
            [selectedAgentId]: { identity: { name: "Writer" } },
          },
        },
        gateway: { mode: "local", auth: { mode: "token" } },
        plugins: {
          enabled: true,
          allow: [pluginId],
          load: { paths: [pluginPath] },
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
  for (const [agentId, profileId, token] of [
    [defaultAgentId, rejectedProfileId, "proof-rejected-subscription-token-not-used"],
    [selectedAgentId, readyProfileId, "proof-ready-subscription-token-not-used"],
    [selectedAgentId, rejectedProfileId, "proof-rejected-subscription-token-not-used"],
  ]) {
    await run(
      process.execPath,
      [
        "openclaw.mjs",
        "models",
        "auth",
        "--agent",
        agentId,
        "paste-token",
        "--provider",
        providerId,
        "--profile-id",
        profileId,
        "--expires-in",
        "365d",
      ],
      { env: proofEnv, input: `${token}\n` },
    );
  }
  for (const [agentId, profileIds] of [
    [defaultAgentId, [rejectedProfileId]],
    [selectedAgentId, [readyProfileId, rejectedProfileId]],
  ]) {
    const orderArgs = [
      "openclaw.mjs",
      "models",
      "auth",
      "order",
      "set",
      "--provider",
      providerId,
      "--agent",
      agentId,
    ];
    for (const profileId of profileIds) {
      orderArgs.push(profileId);
    }
    await run(process.execPath, orderArgs, { env: proofEnv });
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

  const queryAgent = async (agentId) => {
    const authStatus = await callGateway("models.authStatus", { agentId }, proofEnv);
    const modelsList = await callGateway(
      "models.list",
      { view: "all", includeProviderCapabilities: true, agentId },
      proofEnv,
    );
    const configuredModelsList = await callGateway(
      "models.list",
      { view: "configured", agentId },
      proofEnv,
    );
    const providerAuth = authStatus.providers?.find((item) => item.provider === providerId);
    const providerModel = modelsList.models?.find(
      (item) => item.provider === providerId && item.id === modelId,
    );
    const configuredProviderModel = configuredModelsList.models?.find(
      (item) => item.provider === providerId && item.id === modelId,
    );
    return {
      agentId,
      authStatus,
      modelsList,
      configuredModelsList,
      providerAuth,
      providerModel,
      configuredProviderModel,
      savedProfiles: providerAuth?.profiles?.map((item) => item.profileId) ?? [],
      providerOutcomes:
        modelsList.providerOutcomes?.filter((item) => item.provider === providerId) ?? [],
    };
  };
  const rpcDefaultAgent = await queryAgent(defaultAgentId);
  const rpcSelectedAgent = await queryAgent(selectedAgentId);
  await writeFile(
    path.join(artifactDir, "rpc-preflight.json"),
    `${JSON.stringify(
      {
        targetSha,
        defaultAgent: rpcDefaultAgent,
        selectedAgent: rpcSelectedAgent,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (
    rpcDefaultAgent.providerAuth?.status !== "ok" ||
    !rpcDefaultAgent.savedProfiles.includes(rejectedProfileId) ||
    rpcDefaultAgent.providerModel?.available !== false ||
    rpcDefaultAgent.providerOutcomes.length !== 1 ||
    rpcDefaultAgent.providerOutcomes[0]?.status !== "auth-rejected"
  ) {
    throw new Error(
      `Expected default-agent rejected control before Chromium: ${JSON.stringify(rpcDefaultAgent)}`,
    );
  }
  if (rpcSelectedAgent.providerAuth?.status !== "ok") {
    throw new Error(
      `Expected selected-agent healthy saved-profile auth, got ${rpcSelectedAgent.providerAuth?.status ?? "missing"}`,
    );
  }
  if (
    !rpcSelectedAgent.savedProfiles.includes(readyProfileId) ||
    !rpcSelectedAgent.savedProfiles.includes(rejectedProfileId)
  ) {
    throw new Error(`Missing selected-agent saved profiles: ${JSON.stringify(rpcSelectedAgent)}`);
  }
  if (rpcSelectedAgent.savedProfiles[0] !== readyProfileId) {
    throw new Error(
      `Expected selected-agent ready profile first: ${JSON.stringify(rpcSelectedAgent)}`,
    );
  }
  if (rpcSelectedAgent.providerModel?.available !== true) {
    throw new Error(
      `Expected selected-agent proof model available before Chromium: ${JSON.stringify(rpcSelectedAgent)}`,
    );
  }
  if (rpcSelectedAgent.configuredProviderModel?.available !== true) {
    throw new Error(
      `Expected selected-agent configured model available before Chromium: ${JSON.stringify(rpcSelectedAgent)}`,
    );
  }
  if (
    rpcSelectedAgent.providerOutcomes.length !== 2 ||
    !rpcSelectedAgent.providerOutcomes.some(
      (item) => item.profileId === readyProfileId && item.status === "ready",
    ) ||
    !rpcSelectedAgent.providerOutcomes.some(
      (item) => item.profileId === rejectedProfileId && item.status === "auth-rejected",
    )
  ) {
    throw new Error(
      `Missing selected-agent provider outcomes: ${JSON.stringify(rpcSelectedAgent)}`,
    );
  }

  if (rpcOnly) {
    await writeFile(
      path.join(artifactDir, "rpc-verdict.json"),
      `${JSON.stringify(
        {
          targetSha,
          realGateway: true,
          defaultAgent: rpcDefaultAgent,
          selectedAgent: rpcSelectedAgent,
          verdict: "pass",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(
      `[control-ui multi-profile rpc preflight proof] exact-head=${targetSha} default-agent-rejected=true selected-agent=writer selected-saved-profiles=2 selected-auth-ok=true selected-model-available=true ready-outcome=true rejected-outcome=true real-gateway=true`,
    );
  } else {
    browser = await chromium.launch();
    context = await browser.newContext({
      colorScheme: "dark",
      locale: "en-US",
      recordVideo: { dir: artifactDir, size: { width: 1440, height: 1000 } },
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    activePage = page;
    const pendingRequests = new Map();
    const evidenceMethods = new Set(["models.authStatus", "models.list"]);
    gatewayExchanges = [];
    page.on("websocket", (socket) => {
      socket.on("framesent", ({ payload }) => {
        const frame = parseFrame(payload);
        if (frame?.id && evidenceMethods.has(frame.method)) {
          pendingRequests.set(frame.id, { method: frame.method, params: frame.params });
        }
      });
      socket.on("framereceived", ({ payload }) => {
        const frame = parseFrame(payload);
        const request = frame?.id ? pendingRequests.get(frame.id) : undefined;
        if (request) {
          gatewayExchanges.push({ request, response: frame });
          pendingRequests.delete(frame.id);
        }
      });
    });

    const response = await page.goto(`${baseUrl}settings/model-providers#token=${gatewayToken}`);
    if (!response?.ok()) {
      throw new Error(`Control UI returned ${response?.status() ?? "no response"}`);
    }
    const card = page.locator(`[data-provider-id="${providerId}"]`);
    await card.waitFor({ state: "visible", timeout: 30_000 });
    const findExchange = (method, view, agentId) =>
      gatewayExchanges.findLast(
        (exchange) =>
          exchange.request.method === method &&
          (view === undefined || exchange.request.params?.view === view) &&
          exchange.request.params?.agentId === agentId,
      );
    const waitForAgentFrames = async (agentId) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const frames = {
          authStatus: findExchange("models.authStatus", undefined, agentId),
          modelsList: findExchange("models.list", "all", agentId),
          configuredModelsList: findExchange("models.list", "configured", agentId),
        };
        if (frames.authStatus && frames.modelsList && frames.configuredModelsList) {
          return frames;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`Missing real Gateway frames for agent ${agentId}`);
    };
    const captureObservedState = async (label, agentId, frames) => {
      const cardText = (await card.textContent())?.replaceAll(/\s+/g, " ").trim() ?? "";
      const modelsList = responsePayload(frames.modelsList?.response);
      const configuredModelsList = responsePayload(frames.configuredModelsList?.response);
      const authStatus = responsePayload(frames.authStatus?.response);
      await page.screenshot({
        path: path.join(artifactDir, `provider-card-${label}.png`),
        fullPage: true,
      });
      await writeFile(path.join(artifactDir, `page-${label}.html`), await page.content(), "utf8");
      await writeFile(
        path.join(artifactDir, `observed-${label}.json`),
        `${JSON.stringify(
          {
            targetSha,
            agentId,
            route: new URL(page.url()).pathname,
            cardText,
            gatewayFrames: frames,
            authStatus,
            modelsList,
            configuredModelsList,
            providerAuth: authStatus?.providers?.find((item) => item.provider === providerId),
            providerModel: modelsList?.models?.find((item) => item.provider === providerId),
            configuredProviderModel: configuredModelsList?.models?.find(
              (item) => item.provider === providerId,
            ),
            providerOutcomes: modelsList?.providerOutcomes?.filter(
              (item) => item.provider === providerId,
            ),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      return cardText;
    };
    const defaultFrames = await waitForAgentFrames(defaultAgentId);
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(`[data-provider-id="${id}"]`)
          ?.textContent?.includes("Credentials rejected"),
      providerId,
      { timeout: 30_000 },
    );
    const defaultCardText = await captureObservedState(
      "default-agent-rejected",
      defaultAgentId,
      defaultFrames,
    );
    if (!defaultCardText.includes("Credentials rejected") || defaultCardText.includes("Ready")) {
      throw new Error(`Unexpected default-agent provider card state: ${defaultCardText}`);
    }

    const pageScope = page.locator(".agent-scope-control openclaw-agent-select");
    await pageScope.locator(".agent-select__trigger").click();
    await pageScope
      .locator("wa-dropdown-item[data-agent-option]")
      .filter({ hasText: "Writer" })
      .click();
    await page.waitForFunction(
      (agentId) =>
        document.querySelector(".agent-scope-control openclaw-agent-select")?.value === agentId,
      selectedAgentId,
      { timeout: 30_000 },
    );
    const selectedFrames = await waitForAgentFrames(selectedAgentId);
    await page.waitForFunction(
      (id) => document.querySelector(`[data-provider-id="${id}"]`)?.textContent?.includes("Ready"),
      providerId,
      { timeout: 30_000 },
    );
    const selectedCardText = await captureObservedState(
      "selected-agent-ready",
      selectedAgentId,
      selectedFrames,
    );
    if (!selectedCardText.includes("Ready") || selectedCardText.includes("Credentials rejected")) {
      throw new Error(`Unexpected selected-agent provider card state: ${selectedCardText}`);
    }

    const modelsList = responsePayload(selectedFrames.modelsList.response);
    const authStatus = responsePayload(selectedFrames.authStatus.response);
    const configuredModelsList = responsePayload(selectedFrames.configuredModelsList.response);
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
      !profiles.includes(rejectedProfileId) ||
      !configuredModelsList.models?.some(
        (item) => item.provider === providerId && item.id === modelId && item.available === true,
      )
    ) {
      throw new Error(`Missing multi-profile evidence: ${JSON.stringify({ outcomes, profiles })}`);
    }

    await writeFile(
      path.join(artifactDir, "gateway-frames.json"),
      `${JSON.stringify(
        {
          exchanges: gatewayExchanges,
          defaultAgent: defaultFrames,
          selectedAgent: selectedFrames,
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      path.join(artifactDir, "verdict.json"),
      `${JSON.stringify(
        {
          targetSha,
          realGateway: true,
          realChromium: true,
          defaultAgent: {
            id: defaultAgentId,
            providerCard: {
              containsReady: false,
              containsCredentialsRejected: true,
              text: defaultCardText,
            },
          },
          selectedAgent: {
            id: selectedAgentId,
            providerCard: {
              containsReady: true,
              containsCredentialsRejected: false,
              text: selectedCardText,
            },
          },
          savedProfiles: profiles.toSorted(),
          providerOutcomes: outcomes,
          verdict: "pass",
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `[control-ui multi-profile real-gateway proof] exact-head=${targetSha} default-agent-rejected=true selected-agent=writer selected-saved-profiles=2 ready-outcome=true rejected-outcome=true selected-provider-card-ready=true selected-credentials-rejected=false real-gateway=true real-chromium=true`,
    );
  }
} catch (error) {
  if (activePage) {
    await activePage
      .screenshot({ path: path.join(artifactDir, "provider-card-failure.png"), fullPage: true })
      .catch(() => {});
    const failureHtml = await activePage.content().catch(() => undefined);
    if (failureHtml !== undefined) {
      await writeFile(path.join(artifactDir, "page-failure.html"), failureHtml, "utf8").catch(
        () => {},
      );
    }
  }
  await writeFile(
    path.join(artifactDir, "gateway-exchanges-failure.json"),
    `${JSON.stringify({ targetSha, exchanges: gatewayExchanges }, null, 2)}\n`,
  ).catch(() => {});
  throw error;
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
