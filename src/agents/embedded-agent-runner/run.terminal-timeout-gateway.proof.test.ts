import { randomUUID } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { startGatewayServer, type GatewayServer } from "../../gateway/server.js";
import { connectGatewayClient } from "../../gateway/test-helpers.e2e.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../../test-utils/openclaw-test-state.js";
import { getDeterministicFreePortBlock } from "../../test-utils/ports.js";

const TARGET_HEAD = "accb41acfb7e696d9f738d394e284c6706f65882";
const GENERIC_TIMEOUT = "LLM request timed out.";
const AUTHORITATIVE_TIMEOUT = "Request timed out before a response was generated.";
const MODEL_REF = "timeout-proof/timeout-proof";
const SESSION_KEY = "agent:main:pr-122036-timeout-proof";

type GatewayClient = Awaited<ReturnType<typeof connectGatewayClient>>;
type AgentResponse = {
  runId?: string;
  status?: string;
  result?: {
    payloads?: Array<{ text?: string }>;
    meta?: { timeoutPhase?: string; providerStarted?: boolean };
  };
};

let client: GatewayClient | undefined;
let gateway: GatewayServer | undefined;
let provider: Awaited<ReturnType<typeof startStalledOpenAiServer>> | undefined;
let state: OpenClawTestState | undefined;

afterEach(async () => {
  await client?.stopAndWait({ timeoutMs: 1_000 }).catch(() => undefined);
  await provider?.stop().catch(() => undefined);
  await gateway
    ?.close({ reason: "PR #122036 proof complete", drainTimeoutMs: 0 })
    .catch(() => undefined);
  await state?.cleanup().catch(() => undefined);
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  client = undefined;
  gateway = undefined;
  provider = undefined;
  state = undefined;
});

describe("PR #122036 ephemeral Gateway timeout delivery proof", () => {
  it(
    "returns one authoritative timeout over the production agent RPC",
    { timeout: 120_000 },
    async () => {
      provider = await startStalledOpenAiServer();
      const port = await getDeterministicFreePortBlock({ offsets: [0, 1, 2, 3, 4] });
      const token = `pr-122036-${randomUUID()}`;
      state = await createOpenClawTestState({
        label: "pr-122036-timeout-gateway",
        layout: "split",
        env: {
          OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
          OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: "1",
          OPENCLAW_SKIP_CANVAS_HOST: "1",
          OPENCLAW_SKIP_CHANNELS: "1",
          OPENCLAW_SKIP_CRON: "1",
          OPENCLAW_SKIP_GMAIL_WATCHER: "1",
          OPENCLAW_SKIP_PROVIDERS: undefined,
          OPENCLAW_TEST_MINIMAL_GATEWAY: "1",
        },
      });
      await state.writeConfig(
        createProofConfig({
          baseUrl: provider.baseUrl,
          port,
          token,
          workspace: state.workspaceDir,
        }),
      );
      clearRuntimeConfigSnapshot();
      clearConfigCache();

      gateway = await startGatewayServer(port, {
        bind: "loopback",
        auth: { mode: "token", token },
        controlUiEnabled: false,
        sidecarStartup: "defer",
      });
      client = await connectGatewayClient({
        url: `ws://127.0.0.1:${port}`,
        token,
        role: "operator",
        scopes: ["operator.admin", "operator.read", "operator.write"],
        requestTimeoutMs: 30_000,
        timeoutMs: 30_000,
      });

      const response = await client.request<AgentResponse>(
        "agent",
        {
          sessionKey: SESSION_KEY,
          message: "This request must reach the configured timeout boundary.",
          deliver: false,
          idempotencyKey: randomUUID(),
        },
        { expectFinal: true, timeoutMs: 30_000 },
      );
      const payloads = response.result?.payloads ?? [];
      const genericTimeouts = payloads.filter(
        (payload) => payload.text?.trim() === GENERIC_TIMEOUT,
      );
      const authoritativeTimeouts = payloads.filter((payload) =>
        payload.text?.includes(AUTHORITATIVE_TIMEOUT),
      );
      const providerState = provider.snapshot();

      expect(providerState.requestsStarted).toBe(1);
      expect(response.status).toBe("timeout");
      expect(response.result?.meta?.providerStarted).toBe(true);
      expect(genericTimeouts).toHaveLength(0);
      expect(authoritativeTimeouts).toHaveLength(1);
      expect(payloads).toHaveLength(1);

      const verdictPath = process.env.OPENCLAW_PROOF_VERDICT_PATH;
      if (verdictPath) {
        const { mkdir, writeFile } = await import("node:fs/promises");
        const verdict = {
          schema: "openclaw.pr-real-behavior-proof/v1",
          result: "pass",
          target: {
            repository: "openclaw/openclaw",
            pullRequest: 122036,
            immutableHead: TARGET_HEAD,
          },
          proofHarnessCommit: process.env.OPENCLAW_PROOF_HARNESS_COMMIT ?? "working-tree",
          environment: {
            credentials: "none",
            gateway: "ephemeral in-process Gateway",
            provider: "loopback OpenAI-compatible stalled HTTP response",
            transport: "authenticated Gateway WebSocket agent RPC",
            node: process.version,
          },
          productionBoundary: [
            "authenticated Gateway WebSocket agent RPC",
            "production embedded agent runner",
            "OpenAI-compatible provider HTTP request",
            "agent timeout and terminal finalization",
            "final Gateway RPC result payloads",
          ],
          observed: {
            gatewayStatus: response.status,
            timeoutPhase: response.result?.meta?.timeoutPhase,
            providerStarted: response.result?.meta?.providerStarted,
            providerRequestsStarted: providerState.requestsStarted,
            providerRequestsClosedAfterTimeout: providerState.requestsClosed,
            finalPayloads: payloads.length,
            genericTimeoutPayloads: genericTimeouts.length,
            authoritativeTimeoutPayloads: authoritativeTimeouts.length,
          },
          redaction: {
            containsCredentials: false,
            containsLocalPaths: false,
            containsSessionIdentifiers: false,
          },
        };
        await mkdir(path.dirname(verdictPath), { recursive: true });
        await writeFile(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
      }
    },
  );
});

function createProofConfig(params: {
  baseUrl: string;
  port: number;
  token: string;
  workspace: string;
}): OpenClawConfig {
  return {
    plugins: { slots: { memory: "none" } },
    agents: {
      defaults: {
        heartbeat: { every: "0m" },
        timeoutSeconds: 2,
        model: { primary: MODEL_REF },
        models: { [MODEL_REF]: { agentRuntime: { id: "openclaw" } } },
        skipBootstrap: true,
        skills: [],
        workspace: params.workspace,
      },
    },
    tools: { profile: "minimal" },
    models: {
      mode: "replace",
      providers: {
        "timeout-proof": {
          baseUrl: `${params.baseUrl}/v1`,
          apiKey: "test-token-placeholder",
          api: "openai-responses",
          request: { allowPrivateNetwork: true },
          models: [
            {
              id: "timeout-proof",
              name: "timeout-proof",
              api: "openai-responses",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128_000,
              maxTokens: 4_096,
            },
          ],
        },
      },
    },
    gateway: {
      mode: "local",
      port: params.port,
      bind: "loopback",
      auth: { mode: "token", token: params.token },
      controlUi: { enabled: false },
    },
  };
}

async function startStalledOpenAiServer() {
  let requestsStarted = 0;
  let requestsClosed = 0;
  const pendingResponses = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "timeout-proof", object: "model" }] }));
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/responses") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":{"message":"not found"}}');
      return;
    }

    requestsStarted += 1;
    pendingResponses.add(response);
    response.once("close", () => {
      requestsClosed += 1;
      pendingResponses.delete(response);
    });
    // Leave the provider response pending so the production timeout owns abort.
    request.resume();
  });
  const port = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    snapshot: () => ({
      pendingResponses: pendingResponses.size,
      requestsClosed,
      requestsStarted,
    }),
    stop: async () => await closeServer(server),
  };
}

async function listen(server: Server): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate stalled provider port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
