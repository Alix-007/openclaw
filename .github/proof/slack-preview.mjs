import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const exactHead = process.env.OPENCLAW_PROOF_HEAD_SHA;
if (!/^[0-9a-f]{40}$/u.test(exactHead ?? "")) {
  throw new Error("OPENCLAW_PROOF_HEAD_SHA must be an immutable full SHA");
}

const importRepo = (relativePath) => import(pathToFileURL(path.join(repoRoot, relativePath)).href);
const { createQaCrablineTransportAdapter } = await importRepo(
  "extensions/qa-lab/src/crabline-transport.ts",
);
const { startQaGatewayChild } = await importRepo("extensions/qa-lab/src/gateway-child.ts");

const artifactDir = path.join(repoRoot, ".artifacts/qa-e2e/pr-128626-slack-preview");
const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pr128626-proof-"));
const recorderPath = path.join(outputDir, "artifacts", "crabline", "slack-fake-provider.jsonl");
const verdictPath = path.join(artifactDir, "verdict.json");
const failurePath = path.join(artifactDir, "failure.json");
const partialMarker = "PR128626_VISIBLE_ANSWER_BOUNDARY";
const finalMarker = "PR128626_SECOND_PREVIEW_OK";
const providerRounds = [];
let gateway;
let agentWait;
let providerServer;
let transport;

await fs.mkdir(artifactDir, { recursive: true });

function writeJson(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function writeEvent(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function reasoningItem(round) {
  return {
    id: `reasoning_pr128626_${round}`,
    type: "reasoning",
    summary: [],
    content: [],
  };
}

async function writeReasoning(response, round) {
  const item = reasoningItem(round);
  writeEvent(response, { type: "response.output_item.added", output_index: 0, item });
  writeEvent(response, {
    type: "response.reasoning_text.delta",
    output_index: 0,
    item_id: item.id,
    delta: `Inspecting proof path ${round + 1}`,
  });
  await sleep(750);
  writeEvent(response, { type: "response.output_item.done", output_index: 0, item });
  return item;
}

function toolCall(round, outputIndex) {
  const serialized = JSON.stringify({ path: "PROOF.md" });
  return {
    outputIndex,
    serialized,
    item: {
      type: "function_call",
      id: `item_pr128626_${round}`,
      call_id: `call_pr128626_${round}`,
      name: "read",
      arguments: serialized,
    },
  };
}

function writeToolCall(response, round, outputIndex) {
  const call = toolCall(round, outputIndex);
  writeEvent(response, {
    type: "response.output_item.added",
    output_index: outputIndex,
    item: { ...call.item, arguments: "" },
  });
  writeEvent(response, {
    type: "response.function_call_arguments.delta",
    item_id: call.item.id,
    output_index: outputIndex,
    delta: call.serialized,
  });
  writeEvent(response, {
    type: "response.function_call_arguments.done",
    item_id: call.item.id,
    output_index: outputIndex,
    arguments: call.serialized,
  });
  writeEvent(response, {
    type: "response.output_item.done",
    output_index: outputIndex,
    item: call.item,
  });
  return call.item;
}

async function writeMessage(response, { id, marker, outputIndex }) {
  const item = {
    type: "message",
    id,
    role: "assistant",
    phase: "final_answer",
    status: "completed",
    content: [{ type: "output_text", text: marker, annotations: [] }],
  };
  writeEvent(response, {
    type: "response.output_item.added",
    output_index: outputIndex,
    item: { ...item, status: "in_progress", content: [] },
  });
  writeEvent(response, {
    type: "response.output_text.delta",
    item_id: id,
    output_index: outputIndex,
    content_index: 0,
    delta: marker,
  });
  await sleep(750);
  writeEvent(response, {
    type: "response.output_text.done",
    item_id: id,
    output_index: outputIndex,
    content_index: 0,
    text: marker,
  });
  writeEvent(response, { type: "response.output_item.done", output_index: outputIndex, item });
  return item;
}

async function writeProviderResponse(response, round) {
  const responseId = `resp_pr128626_${round}`;
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  writeEvent(response, { type: "response.created", response: { id: responseId } });
  const output = [await writeReasoning(response, round)];

  if (round < 2) {
    output.push(writeToolCall(response, round, 1));
  } else if (round === 2) {
    output.push(
      await writeMessage(response, {
        id: "message_pr128626_partial",
        marker: partialMarker,
        outputIndex: 1,
      }),
    );
    output.push(writeToolCall(response, round, 2));
  } else {
    output.push(
      await writeMessage(response, {
        id: "message_pr128626_final",
        marker: finalMarker,
        outputIndex: 1,
      }),
    );
  }

  writeEvent(response, {
    type: "response.completed",
    response: {
      id: responseId,
      status: "completed",
      output,
      usage: { input_tokens: 24, output_tokens: 12, total_tokens: 36 },
    },
  });
  response.end("data: [DONE]\n\n");
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readRecorderEvents() {
  let raw;
  try {
    raw = await fs.readFile(recorderPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const events = [];
  for (const line of raw.split(/\r?\n/u).filter(Boolean)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // The recorder appends JSONL while this proof polls it; ignore only an incomplete tail.
      if (line !== raw.trimEnd().split(/\r?\n/u).at(-1)) {
        throw new Error("Slack recorder contains malformed JSONL before its active tail");
      }
    }
  }
  return events;
}

function isSlackMethod(event, method) {
  return event?.type === "api" && String(event.path).includes(method);
}

async function waitForFinalUpdate(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readRecorderEvents();
    if (
      events.some(
        (event) =>
          isSlackMethod(event, "chat.update") && JSON.stringify(event.body).includes(finalMarker),
      )
    ) {
      return events;
    }
    await sleep(250);
  }
  throw new Error(`Slack recorder did not observe ${finalMarker} within ${timeoutMs}ms`);
}

async function closeServer(server) {
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  const [buildStamp, runtimeStamp, slackDispatchSource] = await Promise.all([
    fs.readFile(path.join(repoRoot, "dist", ".buildstamp"), "utf8").then(JSON.parse),
    fs.readFile(path.join(repoRoot, "dist", ".runtime-postbuildstamp"), "utf8").then(JSON.parse),
    fs.readFile(
      path.join(repoRoot, "extensions/slack/src/monitor/message-handler/dispatch-progress.ts"),
      "utf8",
    ),
  ]);
  if (
    buildStamp.head !== exactHead ||
    runtimeStamp.head !== exactHead ||
    !slackDispatchSource.includes("hasStreamedAnswer")
  ) {
    throw new Error("proof inputs are not the exact built PR head");
  }

  providerServer = createServer((request, response) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/v1/models") {
        writeJson(response, {
          object: "list",
          data: [{ id: "gpt-5.6-luna", object: "model", owned_by: "qa" }],
        });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/embeddings") {
        writeJson(response, {
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        });
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/responses") {
        response.writeHead(404).end();
        return;
      }
      const body = JSON.parse(await readRequestBody(request));
      const serializedInput = JSON.stringify(body.input ?? []);
      const toolOutputCount = serializedInput.match(/"type":"function_call_output"/gu)?.length ?? 0;
      const round = Math.min(toolOutputCount, 3);
      const eventsAtStart = await readRecorderEvents();
      providerRounds.push({
        round,
        toolOutputCount,
        postCountAtStart: eventsAtStart.filter((event) => isSlackMethod(event, "chat.postMessage"))
          .length,
      });
      await writeProviderResponse(response, round);
    })().catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise((resolve, reject) => {
    providerServer.once("error", reject);
    providerServer.listen(0, "127.0.0.1", resolve);
  });
  const providerAddress = providerServer.address();
  if (!providerAddress || typeof providerAddress === "string") {
    throw new Error("proof provider did not bind a loopback port");
  }

  transport = await createQaCrablineTransportAdapter({
    outputDir,
    selection: {
      capabilityMatrixPath: "crabline-fake-provider-capabilities.json",
      channel: "slack",
      channelDriver: "crabline",
      smokeArtifactPath: "crabline-fake-provider-smoke.json",
    },
  });
  gateway = await startQaGatewayChild({
    repoRoot,
    useRepoCli: false,
    providerBaseUrl: `http://127.0.0.1:${providerAddress.port}/v1`,
    providerMode: "mock-openai",
    primaryModel: "mock-openai/gpt-5.6-luna",
    alternateModel: "mock-openai/gpt-5.6-luna",
    transport,
    transportBaseUrl: "http://127.0.0.1:1",
    controlUiEnabled: false,
    mutateConfig: (cfg) => ({
      ...cfg,
      agents: {
        ...cfg.agents,
        defaults: { ...cfg.agents?.defaults, skipBootstrap: true },
      },
      plugins: { ...cfg.plugins, slots: { ...cfg.plugins?.slots, memory: "none" } },
      channels: {
        ...cfg.channels,
        slack: {
          ...cfg.channels?.slack,
          enabled: true,
          dmPolicy: "open",
          allowFrom: ["*"],
          historyLimit: 0,
          dmHistoryLimit: 0,
          streaming: {
            mode: "partial",
            nativeTransport: false,
            preview: { toolProgress: true },
            progress: { label: false, toolProgress: true },
          },
        },
      },
    }),
    runtimeEnvPatch: transport.createRuntimeEnvPatch?.(),
  });
  await fs.writeFile(path.join(gateway.workspaceDir, "PROOF.md"), "bounded proof fixture\n");
  await transport.waitReady({ gateway, timeoutMs: 30_000, pollIntervalMs: 250 });

  const delivery = transport.buildAgentDelivery({ target: "dm:D128626" });
  const started = await gateway.call(
    "agent",
    {
      idempotencyKey: randomUUID(),
      agentId: "qa",
      sessionKey: "agent:qa:proof:slack-preview-boundary",
      message: "Read PROOF.md three times, showing progress, then send the final marker.",
      deliver: true,
      channel: delivery.channel,
      to: delivery.to ?? "D128626",
      replyChannel: delivery.replyChannel,
      replyTo: delivery.replyTo,
    },
    { timeoutMs: 30_000 },
  );
  if (!started?.runId) {
    throw new Error("agent RPC did not return a runId");
  }
  agentWait = await gateway.call(
    "agent.wait",
    { runId: started.runId, timeoutMs: 150_000 },
    { timeoutMs: 160_000 },
  );
  if (agentWait?.status !== "ok") {
    throw new Error(`agent run did not complete successfully: ${JSON.stringify(agentWait)}`);
  }
  const events = await waitForFinalUpdate(120_000);
  const apiEvents = events.filter((event) => event.type === "api");
  const postEvents = apiEvents.filter((event) => isSlackMethod(event, "chat.postMessage"));
  const updateEvents = apiEvents.filter((event) => isSlackMethod(event, "chat.update"));
  const secondPostIndex = apiEvents.findIndex(
    (event, index) =>
      isSlackMethod(event, "chat.postMessage") &&
      apiEvents.slice(0, index).some((prior) => isSlackMethod(prior, "chat.postMessage")),
  );
  const updateTs = updateEvents.map((event) => String(event.body?.ts ?? "")).filter(Boolean);
  const uniqueUpdateTs = [...new Set(updateTs)];
  const updatesBeforeSecondPost = apiEvents
    .slice(0, secondPostIndex)
    .filter((event) => isSlackMethod(event, "chat.update"));
  const preRotationTs = [
    ...new Set(
      updatesBeforeSecondPost.map((event) => String(event.body?.ts ?? "")).filter(Boolean),
    ),
  ];
  const partialUpdate = updateEvents.find((event) =>
    JSON.stringify(event.body).includes(partialMarker),
  );
  const finalUpdate = updateEvents.find((event) =>
    JSON.stringify(event.body).includes(finalMarker),
  );
  const roundSignature = providerRounds.map(({ round }) => round).join(",");
  const postCountsAtRoundStart = providerRounds.map(({ postCountAtStart }) => postCountAtStart);
  const pass =
    roundSignature === "0,1,2,3" &&
    postCountsAtRoundStart[2] === 1 &&
    postCountsAtRoundStart[3] === 1 &&
    postEvents.length === 2 &&
    secondPostIndex > 0 &&
    preRotationTs.length === 1 &&
    uniqueUpdateTs.length === 2 &&
    String(partialUpdate?.body?.ts ?? "") === uniqueUpdateTs[0] &&
    String(finalUpdate?.body?.ts ?? "") === uniqueUpdateTs[1];
  const verdict = {
    result: pass ? "pass" : "fail",
    target: {
      immutableHead: exactHead,
      buildStampHead: buildStamp.head,
      runtimePostbuildStampHead: runtimeStamp.head,
      changedSourceSha256: createHash("sha256").update(slackDispatchSource).digest("hex"),
    },
    boundary: "Crabline loopback Slack HTTP + exact dist Gateway + mock OpenAI Responses SSE",
    observed: {
      providerRounds,
      agentWaitStatus: agentWait.status,
      postMessageCount: postEvents.length,
      updateCount: updateEvents.length,
      updateMessageIdentityCount: uniqueUpdateTs.length,
      preAnswerMessageIdentityCount: preRotationTs.length,
      partialAnswerOnFirstMessage: String(partialUpdate?.body?.ts ?? "") === uniqueUpdateTs[0],
      finalAnswerOnSecondMessage: String(finalUpdate?.body?.ts ?? "") === uniqueUpdateTs[1],
    },
    cleanup: "pending",
  };
  if (!pass) {
    throw new Error(`proof verdict failed: ${JSON.stringify(verdict)}`);
  }

  await gateway.stop();
  gateway = undefined;
  await transport.cleanup?.();
  transport = undefined;
  await closeServer(providerServer);
  providerServer = undefined;
  await fs.rm(outputDir, { recursive: true, force: true });
  verdict.cleanup = "gateway/provider/transport/temp removed";
  await fs.writeFile(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
  process.stdout.write(
    `[slack preview reasoning-boundary proof] head=${exactHead} rounds=${roundSignature} posts=2 identities=2 partial-first=true final-second=true cleanup=true\n`,
  );
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
} catch (error) {
  const failure = {
    result: "fail",
    targetHead: exactHead,
    message: error instanceof Error ? error.message : String(error),
    providerRounds,
    agentWaitStatus: agentWait?.status ?? null,
  };
  await fs.writeFile(failurePath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  const gatewayTail = gateway?.logs?.().slice(-4_000);
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}${gatewayTail ? `\nGateway tail:\n${gatewayTail}` : ""}\n`,
  );
  process.exitCode = 1;
} finally {
  await gateway?.stop().catch(() => undefined);
  await transport?.cleanup?.().catch(() => undefined);
  await closeServer(providerServer).catch(() => undefined);
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
}
