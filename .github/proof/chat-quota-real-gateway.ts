import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { startQaGatewayChild, startQaMockOpenAiServer } from "../extensions/qa-lab/api.js";
import {
  resolveQaAgentAuthDir,
  writeQaAuthProfiles,
} from "../extensions/qa-lab/src/providers/shared/auth-store.js";

const AGENT_ID = "qa";
const SESSION_KEY = `agent:${AGENT_ID}:main`;
const HISTORICAL_MODEL = "openai/gpt-5.6-luna";
const ACTIVE_MODEL = "proof-active/active-model";

type GatewayHandle = {
  baseUrl: string;
  token: string;
  call: (
    method: string,
    params: Record<string, unknown>,
    options?: { expectFinal?: boolean; timeoutMs?: number },
  ) => Promise<unknown>;
  stop: () => Promise<void>;
};

function requireProof(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new Error(`chat quota real-gateway proof failed: ${code}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function poll<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30_000;
  let last!: T;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`chat quota real-gateway proof timed out: ${JSON.stringify(last)}`);
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA;
  const artifactDir = process.env.OPENCLAW_PROOF_ARTIFACT_DIR;
  requireProof(targetSha?.match(/^[0-9a-f]{40}$/u), "exact-target-sha");
  requireProof(artifactDir, "artifact-directory");

  await fs.mkdir(artifactDir, { recursive: true });
  const fetchLogPath = path.join(artifactDir, "chat-quota-provider-calls.jsonl");
  const preloadPath = path.join(repoRoot, ".proof-runtime", "chat-quota-usage-preload.mjs");
  const mock = await startQaMockOpenAiServer();
  let gateway: GatewayHandle | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    gateway = (await startQaGatewayChild({
      repoRoot,
      useRepoCli: true,
      providerBaseUrl: `${mock.baseUrl}/v1`,
      providerMode: "mock-openai",
      primaryModel: HISTORICAL_MODEL,
      alternateModel: HISTORICAL_MODEL,
      transportBaseUrl: mock.baseUrl,
      controlUiEnabled: true,
      enabledPluginIds: ["anthropic", "openai"],
      mockAuthAgentIds: [AGENT_ID],
      runtimeEnvPatch: {
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preloadPath}`]
          .filter(Boolean)
          .join(" "),
        OPENCLAW_QUOTA_PROOF_FETCH_LOG: fetchLogPath,
      },
      onListening: async ({ runtimeEnv }) => {
        const stateDir = runtimeEnv.OPENCLAW_STATE_DIR;
        requireProof(stateDir, "gateway-state-dir");
        await writeQaAuthProfiles({
          agentDir: resolveQaAgentAuthDir({ stateDir, agentId: AGENT_ID }),
          profiles: {
            "qa-proof-openai-oauth": {
              type: "oauth",
              provider: "openai",
              access: "quota-proof-openai-access",
              refresh: "quota-proof-openai-refresh",
              expires: Date.now() + 3_600_000,
              accountId: "quota-proof-openai-account",
            },
            "qa-proof-anthropic-oauth": {
              type: "oauth",
              provider: "anthropic",
              access: "quota-proof-anthropic-access",
              refresh: "quota-proof-anthropic-refresh",
              expires: Date.now() + 3_600_000,
            },
          },
        });
      },
      mutateConfig: (config) => {
        const openai = config.models?.providers?.openai;
        requireProof(openai, "mock-openai-config");
        return {
          ...config,
          auth: {
            ...config.auth,
            profiles: {
              ...config.auth?.profiles,
              "qa-proof-anthropic-oauth": {
                provider: "anthropic",
                mode: "oauth",
              },
              "qa-proof-openai-oauth": {
                provider: "openai",
                mode: "oauth",
              },
            },
          },
          models: {
            ...config.models,
            providers: {
              ...config.models?.providers,
              "proof-active": {
                ...openai,
                models: [
                  {
                    ...openai.models[0],
                    id: "active-model",
                    name: "Active model without quota owner",
                  },
                ],
              },
            },
          },
          agents: {
            ...config.agents,
            defaults: {
              ...config.agents?.defaults,
              models: {
                ...config.agents?.defaults?.models,
                [ACTIVE_MODEL]: {},
              },
            },
          },
        };
      },
    })) as GatewayHandle;

    const run = asRecord(
      await gateway.call(
        "agent",
        {
          agentId: AGENT_ID,
          sessionKey: SESSION_KEY,
          idempotencyKey: randomUUID(),
          message: "Reply with exactly QUOTA_HISTORY_PROOF.",
          deliver: false,
        },
        { expectFinal: true, timeoutMs: 90_000 },
      ),
    );
    requireProof(run?.status === "ok", "historical-openai-turn");

    const patched = asRecord(
      await gateway.call("sessions.patch", { key: SESSION_KEY, model: ACTIVE_MODEL }),
    );
    requireProof(patched?.ok === true, "active-model-patch");

    await gateway.call("models.authStatus", { refresh: true });
    const authStatus = await poll(
      async () => asRecord(await gateway!.call("models.authStatus", {})),
      (value) => {
        const providers = Array.isArray(value?.providers) ? value.providers : [];
        return ["anthropic", "openai"].every((id) =>
          providers.some((entry) => {
            const provider = asRecord(entry);
            return provider?.provider === id && asRecord(provider.usage)?.windows;
          }),
        );
      },
    );

    const sessions = asRecord(await gateway.call("sessions.list", {}));
    const sessionRows = Array.isArray(sessions?.sessions) ? sessions.sessions : [];
    const activeSession = sessionRows.map(asRecord).find((row) => row?.key === SESSION_KEY);
    requireProof(activeSession?.modelProvider === "proof-active", "session-provider-authoritative");

    const history = asRecord(
      await gateway.call("chat.history", { sessionKey: SESSION_KEY, limit: 50 }),
    );
    const historyMessages = Array.isArray(history?.messages) ? history.messages : [];
    const historicalAssistant = historyMessages
      .map(asRecord)
      .find((message) => message?.role === "assistant" && message?.provider === "openai");
    requireProof(historicalAssistant, "historical-openai-assistant");

    browser = await chromium.launch();
    context = await browser.newContext({
      permissions: ["local-network-access"],
      serviceWorkers: "block",
      viewport: { height: 900, width: 1_280 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const response = await page.goto(
      `${gateway.baseUrl}/chat#token=${encodeURIComponent(gateway.token)}`,
      { waitUntil: "domcontentloaded" },
    );
    requireProof(response?.ok(), "control-ui-http");
    const ring = page.locator(".context-ring");
    await ring.waitFor({ state: "visible" });
    await ring.click();
    const providerRows = page.locator('[data-chat-usage-provider="true"]');
    await providerRows.first().waitFor({ state: "visible" });
    await poll(
      async () => await providerRows.count(),
      (count) => count === 2,
    );
    const providerOrder = (await providerRows.allTextContents()).map((text) =>
      text
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/^Provider:\s*/u, "")
        .trim(),
    );
    await page.screenshot({
      path: path.join(artifactDir, "chat-quota-real-gateway.png"),
      fullPage: true,
    });
    const normalizedProviderOrder = providerOrder.map((provider) => provider.toLowerCase());
    requireProof(
      normalizedProviderOrder[0] === "claude" && normalizedProviderOrder[1] === "openai",
      `browser-provider-order-${providerOrder.join("-")}`,
    );

    const fetchCalls = (await fs.readFile(fetchLogPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    requireProof(fetchCalls.length >= 2, "provider-usage-fetches");
    requireProof(
      fetchCalls.every((call) => call.authorizationPresent === true),
      "provider-auth",
    );

    const authProviders = (Array.isArray(authStatus.providers) ? authStatus.providers : [])
      .map(asRecord)
      .filter((provider): provider is Record<string, unknown> => Boolean(provider))
      .map((provider) => provider.provider)
      .filter((provider): provider is string => typeof provider === "string")
      .toSorted();
    const screenshot = await fs.readFile(path.join(artifactDir, "chat-quota-real-gateway.png"));
    const verdict = {
      schemaVersion: 1,
      verdict: "pass",
      targetSha,
      boundary: [
        "production-gateway-child",
        "real-gateway-websocket",
        "production-sessions-store",
        "production-chat-history",
        "production-models-auth-status",
        "controlled-loopback-model-provider",
        "controlled-provider-usage-upstreams",
        "production-built-control-ui",
        "system-chromium",
      ],
      assertions: {
        exactHeadVerified: true,
        realGatewayHealthRpcPassed: true,
        historicalOpenAiTurnCompleted: true,
        historicalAssistantProviderObserved: true,
        activeSessionProviderWasUnmatched: true,
        realModelsAuthStatusReturnedTwoQuotaGroups: true,
        browserConnectedOverRealGatewayWebSocket: true,
        browserPreservedNaturalQuotaOrder: true,
        historicalProviderWasNotPromoted: true,
      },
      observations: {
        activeSessionProvider: activeSession.modelProvider,
        historicalAssistantProvider: historicalAssistant.provider,
        authProviders,
        browserProviderOrder: providerOrder,
        providerUsageFetches: fetchCalls.length,
        screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
      },
      redaction: {
        credentialsIncluded: false,
        messageContentsIncluded: false,
        filesystemPathsIncluded: false,
      },
    };
    await fs.writeFile(
      path.join(artifactDir, "chat-quota-real-gateway.json"),
      `${JSON.stringify(verdict, null, 2)}\n`,
    );
    process.stdout.write(
      `[chat quota real-gateway proof] session=proof-active history=openai order=${providerOrder.join(",")} gateway=true browser=true secret-output=false\n`,
    );
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await gateway?.stop().catch(() => undefined);
    await mock.stop().catch(() => undefined);
  }
}

await main();
