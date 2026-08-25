import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSummary } from "../../../packages/agent-core/src/harness/compaction/compaction.js";
import type {
  AssistantMessage,
  Model,
  StreamFn,
  Usage,
} from "../../../packages/agent-core/src/llm.js";
import { createAssistantMessageEventStream } from "../../../packages/agent-core/src/llm.js";
import type { AgentMessage } from "../../../packages/agent-core/src/types.js";

const PRODUCT_HEAD = "a0658c572070eb98f18f117ec255e05765881ea0";
const PRIVATE_SENTINEL = "PRIVATE_REASONING_SENTINEL_129567";
const proofDir = dirname(fileURLToPath(import.meta.url));

function usage(): Usage {
  return {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    contextUsage: { state: "available", promptTokens: 1, totalTokens: 2 },
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

const model: Model = {
  id: "proof-summary-model",
  name: "Proof Summary Model",
  api: "test-api",
  provider: "proof-provider",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 8_000,
};

const messages: AgentMessage[] = [
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: PRIVATE_SENTINEL },
      { type: "text", text: "Visible answer" },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/index.ts" } },
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usage(),
    stopReason: "stop",
    timestamp: 1,
  },
];

let providerPrompt = "";
const streamFn: StreamFn = (_model, context) => {
  providerPrompt = context.messages
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const response: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "Redacted compaction summary" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usage(),
    stopReason: "stop",
    timestamp: 2,
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: "stop", message: response });
  stream.end();
  return stream;
};

const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const result = await generateSummary(
  messages,
  model,
  1_000,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  streamFn,
);

const observation = {
  productHead: currentHead,
  expectedProductHead: PRODUCT_HEAD,
  summarySucceeded: result.ok,
  summaryText: result.ok ? result.value : undefined,
  privateThinkingPresent: providerPrompt.includes(PRIVATE_SENTINEL),
  thinkingLabelPresent: providerPrompt.includes("[Assistant thinking]"),
  visibleAnswerPresent: providerPrompt.includes("[Assistant]: Visible answer"),
  toolCallPresent: providerPrompt.includes('[Assistant tool calls]: read(path="src/index.ts")'),
  conversationEnvelopePresent:
    providerPrompt.includes("<conversation>") && providerPrompt.includes("</conversation>"),
  promptSha256: createHash("sha256").update(providerPrompt).digest("hex"),
};

const pass =
  observation.productHead === PRODUCT_HEAD &&
  observation.summarySucceeded &&
  observation.summaryText === "Redacted compaction summary" &&
  !observation.privateThinkingPresent &&
  !observation.thinkingLabelPresent &&
  observation.visibleAnswerPresent &&
  observation.toolCallPresent &&
  observation.conversationEnvelopePresent;

await writeFile(
  join(proofDir, "observation.json"),
  `${JSON.stringify({ ...observation, pass }, null, 2)}\n`,
);
await writeFile(
  join(proofDir, "proof.log"),
  [
    `productHead=${currentHead}`,
    `summarySucceeded=${observation.summarySucceeded}`,
    `privateThinkingPresent=${observation.privateThinkingPresent}`,
    `thinkingLabelPresent=${observation.thinkingLabelPresent}`,
    `visibleAnswerPresent=${observation.visibleAnswerPresent}`,
    `toolCallPresent=${observation.toolCallPresent}`,
    `conversationEnvelopePresent=${observation.conversationEnvelopePresent}`,
    `promptSha256=${observation.promptSha256}`,
    pass ? "PASS" : "FAIL",
    "",
  ].join("\n"),
);

console.log(JSON.stringify({ ...observation, pass }));
if (!pass) {
  process.exitCode = 1;
}
