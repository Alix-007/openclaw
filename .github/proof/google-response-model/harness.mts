import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { GoogleGenAI } from "@google/genai";
import {
  createGoogleAssistantOutput,
  runGoogleGenerateContentLifecycle,
} from "../../../packages/ai/src/providers/google-shared.js";
import type { Model } from "../../../packages/ai/src/types.js";
import { AssistantMessageEventStream } from "../../../packages/ai/src/utils/event-stream.js";

const productSha = "3adc4c0f7d92b4f2f358f69bfadf3e8fe3f67663";
const requestedModel = "gemini-2.5-pro";
const servedModel = "gemini-2.5-pro-002";

const model: Model<"google-generative-ai"> = {
  id: requestedModel,
  name: "Gemini 2.5 Pro",
  api: "google-generative-ai",
  provider: "google",
  baseUrl: "",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

const requests: Array<{ method?: string; path?: string }> = [];
const server = http.createServer((request, response) => {
  requests.push({ method: request.method, path: request.url });
  request.resume();
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "proof response" }] },
          finishReason: "STOP",
        },
      ],
      modelVersion: servedModel,
      responseId: "google-response-model-proof",
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 2,
        totalTokenCount: 3,
      },
    })}\n\n`,
  );
});

server.listen(0, "127.0.0.1");
await once(server, "listening");

try {
  execFileSync("git", ["merge-base", "--is-ancestor", productSha, "HEAD"], {
    stdio: "ignore",
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("proof server did not expose a TCP address");
  }

  const packageJson = JSON.parse(
    await readFile(
      new URL("../../../node_modules/@google/genai/package.json", import.meta.url),
      "utf8",
    ),
  ) as { version?: string };
  const client = new GoogleGenAI({
    apiKey: "redacted-proof-key",
    httpOptions: { baseUrl: `http://127.0.0.1:${address.port}`, apiVersion: "" },
  });
  const stream = new AssistantMessageEventStream();
  const output = createGoogleAssistantOutput(model);
  const resultPromise = stream.result();

  await runGoogleGenerateContentLifecycle({
    stream,
    model,
    output,
    createClient: () => client,
    buildParams: () => ({
      model: requestedModel,
      contents: [{ role: "user", parts: [{ text: "proof request" }] }],
    }),
    nextToolCallId: () => "proof-call",
  });
  const result = await resultPromise;
  const request = requests.at(0);
  const verdict = {
    pass:
      packageJson.version === "2.17.1" &&
      result.responseId === "google-response-model-proof" &&
      result.responseModel === servedModel &&
      result.stopReason === "stop" &&
      request?.method === "POST" &&
      request.path === `/models/${requestedModel}:streamGenerateContent?alt=sse` &&
      requests.length === 1,
    productSha,
    sdkVersion: packageJson.version,
    requestedModel,
    responseId: result.responseId,
    responseModel: result.responseModel,
    stopReason: result.stopReason,
    requestMethod: request?.method,
    requestPath: request?.path,
    requestCount: requests.length,
  };

  console.log(JSON.stringify(verdict));
  if (!verdict.pass) {
    process.exitCode = 1;
  }
} finally {
  server.close();
  await once(server, "close");
}
