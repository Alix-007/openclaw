import fs from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import path from "node:path";
import { createOpenAIResponsesTransportStreamFn } from "@openclaw/ai/transports";
import type { Model } from "openclaw/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import { streamWithIdleTimeout } from "./embedded-agent-runner/run/llm-idle-timeout.js";

const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA?.trim() || "unknown";
const artifactDir = path.resolve(
  process.env.OPENCLAW_PROOF_ARTIFACT_DIR?.trim() || "proof-artifacts",
);
const idleTimeoutMs = 1_000;
const internalEventDelayMs = 220;

type LoopbackServer = {
  close: () => Promise<void>;
  requestCount: () => number;
  url: string;
};

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function listen(handler: RequestListener): Promise<LoopbackServer> {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    handler(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Responses proof server did not bind a loopback port");
  }
  return {
    close: async () => await closeServer(server),
    requestCount: () => requests,
    url: `http://127.0.0.1:${address.port}/v1`,
  };
}

function createModel(baseUrl: string): Model<"openai-responses"> {
  return {
    id: "gpt-production-parser-proof",
    name: "Production parser proof",
    api: "openai-responses",
    provider: "custom-openai",
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}

async function consumeResponses(params: {
  baseUrl: string;
  onIdleTimeout: (error: Error) => void;
}): Promise<string> {
  const stream = streamWithIdleTimeout(
    createOpenAIResponsesTransportStreamFn(),
    idleTimeoutMs,
    params.onIdleTimeout,
  )(
    createModel(params.baseUrl),
    {
      messages: [{ role: "user", content: "Reply OK", timestamp: Date.now() }],
      tools: [],
    },
    { apiKey: "proof-key", maxRetries: 0 },
  );
  let text = "";
  for await (const event of stream as AsyncIterable<{ type: string; delta?: string }>) {
    if (event.type === "text_delta") {
      text += event.delta ?? "";
    }
  }
  return text;
}

describe("Responses production HTTP idle-activity proof", () => {
  it("keeps internal parser progress alive and times out a silent control", async () => {
    let internalPhaseElapsedMs = 0;
    const activeServer = await listen((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const item = {
          id: "ws_internal",
          type: "web_search_call",
          status: "in_progress",
          action: { type: "search", query: "idle activity proof" },
        };
        const internalEvents = [
          {
            type: "response.created",
            response: { id: "resp_internal", status: "in_progress", output: [] },
          },
          { type: "response.output_item.added", output_index: 0, item },
          {
            type: "response.web_search_call.in_progress",
            item_id: item.id,
            output_index: 0,
          },
          {
            type: "response.web_search_call.searching",
            item_id: item.id,
            output_index: 0,
          },
          {
            type: "response.web_search_call.completed",
            item_id: item.id,
            output_index: 0,
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: { ...item, status: "completed" },
          },
        ];
        const startedAt = Date.now();
        let index = 0;
        const writeNext = () => {
          if (response.destroyed) {
            return;
          }
          if (index < internalEvents.length) {
            response.write(`data: ${JSON.stringify(internalEvents[index])}\n\n`);
            index += 1;
            setTimeout(writeNext, internalEventDelayMs);
            return;
          }
          internalPhaseElapsedMs = Date.now() - startedAt;
          response.write(
            `data: ${JSON.stringify({
              type: "response.output_item.added",
              output_index: 1,
              item: { id: "msg_internal", type: "message", role: "assistant", content: [] },
            })}\n\n`,
          );
          response.write(
            `data: ${JSON.stringify({
              type: "response.output_text.delta",
              item_id: "msg_internal",
              output_index: 1,
              content_index: 0,
              delta: "OK",
            })}\n\n`,
          );
          response.write(
            `data: ${JSON.stringify({
              type: "response.completed",
              response: { id: "resp_internal", status: "completed", output: [] },
            })}\n\n`,
          );
          response.end();
        };
        writeNext();
      });
    });

    let activeTimeouts = 0;
    let activeText = "";
    try {
      activeText = await consumeResponses({
        baseUrl: activeServer.url,
        onIdleTimeout: () => {
          activeTimeouts += 1;
        },
      });
    } finally {
      await activeServer.close();
    }
    expect(activeText).toBe("OK");
    expect(activeTimeouts).toBe(0);
    expect(activeServer.requestCount()).toBe(1);
    expect(internalPhaseElapsedMs).toBeGreaterThan(idleTimeoutMs);

    const silentServer = await listen((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.flushHeaders();
      });
    });
    let silentTimeouts = 0;
    let silentError = "";
    try {
      await consumeResponses({
        baseUrl: silentServer.url,
        onIdleTimeout: (error) => {
          silentTimeouts += 1;
          silentError = error.message;
        },
      });
    } catch (error) {
      silentError ||= error instanceof Error ? error.message : String(error);
    } finally {
      await silentServer.close();
    }
    expect(silentServer.requestCount()).toBe(1);
    expect(silentTimeouts).toBe(1);
    expect(silentError).toContain("LLM idle timeout");

    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "proof-responses-idle-activity.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          verdict: "pass",
          targetSha,
          boundary: {
            client: "production-createOpenAIResponsesTransportStreamFn",
            parser: "production-Responses-SSE-parser",
            transport: "real-loopback-HTTP-SSE",
            server: "controlled-provider-fixture-not-hosted-OpenAI",
            watchdog: "production-streamWithIdleTimeout",
          },
          assertions: {
            activeRequestCount: activeServer.requestCount(),
            activeInternalPhaseExceededIdleWindow: internalPhaseElapsedMs > idleTimeoutMs,
            activeFinalText: activeText === "OK",
            activeIdleTimeouts: activeTimeouts,
            silentRequestCount: silentServer.requestCount(),
            silentIdleTimeouts: silentTimeouts,
            silentControlTimedOut: silentError.includes("LLM idle timeout"),
          },
          redaction: {
            apiKeyIncluded: false,
            endpointIncluded: false,
            responsePayloadIncluded: false,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.info(
      "[responses idle-activity proof] production-client=true production-parser=true loopback-http-sse=true internal-window-exceeded=true final-text=true active-idle-timeout=false silent-control-timeout=true hosted-provider=false",
    );
  }, 30_000);
});
