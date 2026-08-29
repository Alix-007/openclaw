import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { withTempDir } from "openclaw/plugin-sdk/test-env";
import { afterEach, describe, expect, it } from "vitest";
import { createImageTool } from "../../../../src/agents/tools/image-tool.js";
import {
  handleDynamicToolCallWithTimeout,
  resolveDynamicToolCallTimeoutMs,
} from "./dynamic-tool-execution.js";
import { createCodexDynamicToolBridge } from "./dynamic-tools.js";
import { createCodexNativeTestState } from "./native-app-server.test-support.js";
import type {
  CodexDynamicToolCallParams,
  CodexDynamicToolCallResponse,
  CodexThreadStartResponse,
  CodexTurnStartResponse,
  JsonValue,
} from "./protocol.js";
import { createIsolatedCodexAppServerClient } from "./shared-client.js";

const TARGET_SHA = process.env.OPENCLAW_PROOF_HEAD_SHA ?? "unknown";
const CALL_ID = "call-pr-132559-image-timeout";
const TOOL_NAMESPACE = "openclaw";
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const OWNER_TIMEOUT = "Image inspection timed out after 1000ms";
const GENERIC_TIMEOUT = "OpenClaw dynamic tool call timed out";
const OUTPUT_DIR = ".artifacts/qa-e2e/pr-132559-codex-image-timeout";

type ImageToolTestApi = {
  setProviderDepsForTest: (overrides?: Record<string, unknown>) => void;
};

function imageToolTestApi(): ImageToolTestApi {
  const api = (globalThis as Record<PropertyKey, unknown>)[Symbol.for("openclaw.imageToolTestApi")];
  if (!api || typeof api !== "object") {
    throw new Error("image tool test API is unavailable");
  }
  return api as ImageToolTestApi;
}

function sse(events: JsonValue[]): string {
  return events
    .map((event) => {
      const type = (event as { type?: string }).type;
      return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    })
    .join("");
}

function completedEvent(id: string): JsonValue {
  return {
    type: "response.completed",
    response: {
      id,
      usage: {
        input_tokens: 1,
        input_tokens_details: null,
        output_tokens: 1,
        output_tokens_details: null,
        total_tokens: 2,
      },
    },
  };
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function startMockResponsesServer() {
  const requests: unknown[] = [];
  let responseIndex = 0;
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/responses")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const body = await readBody(request);
    if (!body) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "request body required" }));
      return;
    }
    requests.push(JSON.parse(body));
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "close",
    });
    if (responseIndex++ === 0) {
      response.end(
        sse([
          { type: "response.created", response: { id: "resp-timeout-1" } },
          {
            type: "response.output_item.done",
            item: {
              type: "function_call",
              call_id: CALL_ID,
              namespace: TOOL_NAMESPACE,
              name: "view_image",
              arguments: JSON.stringify({ path: TINY_PNG }),
            },
          },
          completedEvent("resp-timeout-1"),
        ]),
      );
      return;
    }
    response.end(
      sse([
        { type: "response.created", response: { id: "resp-timeout-2" } },
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            role: "assistant",
            id: "msg-timeout-complete",
            content: [{ type: "output_text", text: "ROUNDTRIP_COMPLETE" }],
          },
        },
        completedEvent("resp-timeout-2"),
      ]),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

afterEach(() => {
  imageToolTestApi().setProviderDepsForTest();
});

describe("PR 132559 real Codex app-server image timeout round trip", () => {
  it("returns the image owner's structured timeout through Codex", async () => {
    await withTempDir("openclaw-pr-132559-proof-", async (root) => {
      const mock = await startMockResponsesServer();
      const agentDir = path.join(root, "agent");
      const native = await createCodexNativeTestState(root);
      await fs.writeFile(
        path.join(native.codexHome, "config.toml"),
        [
          'model = "mock-model"',
          'model_provider = "mock_provider"',
          'approval_policy = "never"',
          'sandbox_mode = "read-only"',
          'cli_auth_credentials_store = "file"',
          "[model_providers.mock_provider]",
          'name = "PR 132559 proof provider"',
          `base_url = ${JSON.stringify(mock.baseUrl)}`,
          'wire_api = "responses"',
          "request_max_retries = 0",
          "stream_max_retries = 0",
          "[features]",
          "respect_system_proxy = false",
          "[analytics]",
          "enabled = false",
          "[feedback]",
          "enabled = false",
          "",
        ].join("\n"),
      );

      const client = await createIsolatedCodexAppServerClient({
        startOptions: {
          transport: "stdio",
          command: native.command,
          args: ["app-server", "--listen", "stdio://"],
          commandSource: "config",
          cwd: native.cwd,
          headers: {},
          homeScope: "user",
          env: {
            ...native.env,
            OPENAI_API_KEY: "pr-132559-proof-only-not-a-secret",
          },
        },
        agentDir,
        authProfileId: null,
        timeoutMs: 120_000,
      });

      const provider = {
        id: "proof",
        capabilities: ["image"],
        defaultModels: { image: "vision" },
        describeImage: async ({ signal }: { signal: AbortSignal }) =>
          await new Promise<never>((_resolve, reject) => {
            const abort = () => reject(signal.reason);
            if (signal.aborted) {
              abort();
              return;
            }
            signal.addEventListener("abort", abort, { once: true });
          }),
      };
      imageToolTestApi().setProviderDepsForTest({
        buildProviderRegistry: () => new Map([["proof", provider]]),
        getMediaUnderstandingProvider: (id: string, registry: Map<string, typeof provider>) =>
          registry.get(id),
        resolveImageCompressionPolicy: async ({ imageCount }: { imageCount: number }) => ({
          imageCount,
        }),
        loadImageWebMediaRuntime: async () => ({
          loadWebMedia: async () => {
            throw new Error("data URL proof must not use loadWebMedia");
          },
          optimizeImageBufferForWebMedia: async (params: {
            buffer: Buffer;
            contentType: string;
          }) => ({
            kind: "image",
            buffer: params.buffer,
            contentType: params.contentType,
          }),
        }),
      });

      const config = {
        agents: { defaults: { imageModel: { primary: "proof/vision" } } },
        tools: { media: { image: { timeoutSeconds: 1 } } },
      };
      const imageTool = createImageTool({
        config: config as never,
        agentDir,
        workspaceDir: native.cwd,
        modelHasVision: false,
      });
      expect(imageTool).not.toBeNull();
      if (!imageTool) {
        throw new Error("view_image was not created");
      }
      const abortController = new AbortController();
      const toolBridge = createCodexDynamicToolBridge({
        tools: [imageTool],
        signal: abortController.signal,
        hookContext: {
          agentId: "proof",
          sessionId: "pr-132559",
          sessionKey: "agent:proof:main",
          runId: "pr-132559-proof",
        },
      });

      const observed: {
        call?: CodexDynamicToolCallParams;
        response?: CodexDynamicToolCallResponse;
        completed?: unknown;
      } = {};
      let resolveTurnCompleted: (() => void) | undefined;
      const turnCompleted = new Promise<void>((resolve) => {
        resolveTurnCompleted = resolve;
      });
      const removeNotifications = client.addNotificationHandler((notification) => {
        if (notification.method === "item/completed") {
          const item = (notification.params as { item?: { id?: string } } | undefined)?.item;
          if (item?.id === CALL_ID) {
            observed.completed = notification.params;
          }
        }
        if (notification.method === "turn/completed") {
          resolveTurnCompleted?.();
        }
      });
      const removeRequests = client.addRequestHandler(async (request) => {
        if (request.method !== "item/tool/call") {
          return undefined;
        }
        const call = request.params as CodexDynamicToolCallParams;
        observed.call = call;
        const timeoutMs = resolveDynamicToolCallTimeoutMs({
          call,
          config: config as never,
        });
        const runtimeResponse = await handleDynamicToolCallWithTimeout({
          call,
          toolBridge,
          signal: abortController.signal,
          timeoutMs,
        });
        const response = {
          contentItems: runtimeResponse.contentItems,
          success: runtimeResponse.success,
        } satisfies CodexDynamicToolCallResponse;
        observed.response = response;
        return response as unknown as JsonValue;
      });

      try {
        const thread = await client.request<CodexThreadStartResponse>(
          "thread/start",
          {
            cwd: native.cwd,
            model: "mock-model",
            modelProvider: "mock_provider",
            dynamicTools: [
              {
                type: "namespace",
                name: TOOL_NAMESPACE,
                description: "OpenClaw tools.",
                tools: [
                  {
                    type: "function",
                    name: "view_image",
                    description: "Inspect an image through OpenClaw.",
                    inputSchema: {
                      type: "object",
                      properties: { path: { type: "string" } },
                      required: ["path"],
                      additionalProperties: false,
                    },
                  },
                ],
              },
            ],
          },
          { timeoutMs: 60_000 },
        );
        const turn = await client.request<CodexTurnStartResponse>(
          "turn/start",
          {
            threadId: thread.thread.id,
            input: [{ type: "text", text: "Inspect the image.", textElements: [] }],
          },
          { timeoutMs: 60_000 },
        );
        await withDeadline(turnCompleted, 30_000, "Codex turn did not complete");

        expect(turn.turn.id).toBeTruthy();
        expect(observed.call).toMatchObject({ callId: CALL_ID, tool: "view_image" });
        expect(observed.response).toEqual({
          success: false,
          contentItems: [{ type: "inputText", text: OWNER_TIMEOUT }],
        });
        expect(JSON.stringify(observed.response)).not.toContain(GENERIC_TIMEOUT);
        expect(observed.completed).toMatchObject({
          item: {
            id: CALL_ID,
            type: "dynamicToolCall",
            status: "failed",
            success: false,
            contentItems: [{ type: "inputText", text: OWNER_TIMEOUT }],
          },
        });
        expect(mock.requests).toHaveLength(2);
        const followUpBody = JSON.stringify(mock.requests[1]);
        expect(followUpBody).toContain("function_call_output");
        expect(followUpBody).toContain(OWNER_TIMEOUT);
        expect(followUpBody).not.toContain(GENERIC_TIMEOUT);

        const verdict = {
          schemaVersion: 1,
          proofKind: "real-codex-app-server+mock-responses+controlled-image-provider",
          target: {
            repository: "Alix-007/openclaw",
            immutableHead: TARGET_SHA,
            codexServerVersion: client.getRuntimeIdentity()?.serverVersion,
          },
          observed: {
            request: {
              method: "item/tool/call",
              callId: observed.call?.callId,
              tool: observed.call?.tool,
            },
            openClawResponse: observed.response,
            codexCompletedItem: observed.completed,
            followUpContainsFunctionCallOutput: true,
            genericOuterTimeoutPresent: false,
          },
          result: "pass",
        };
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        await fs.writeFile(
          path.join(OUTPUT_DIR, "verdict.json"),
          `${JSON.stringify(verdict, null, 2)}\n`,
        );
        console.log(JSON.stringify(verdict));
        console.log(
          "[codex image timeout round-trip proof] exact-head=true real-app-server=true owner-timeout=true codex-completed=true follow-up-output=true generic-outer-timeout=false",
        );
      } finally {
        removeRequests();
        removeNotifications();
        abortController.abort();
        await client.closeAndWait();
        await mock.close();
      }
    });
  }, 180_000);
});
