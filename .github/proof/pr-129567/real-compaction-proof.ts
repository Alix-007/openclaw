import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOllamaStreamFn } from "../../../extensions/ollama/src/stream-api.js";
import { AuthStorage } from "../../../src/agents/sessions/auth-storage.js";
import { createExtensionRuntime } from "../../../src/agents/sessions/extensions/loader.js";
import type { LoadExtensionsResult } from "../../../src/agents/sessions/extensions/types.js";
import {
  ModelRegistry,
  type ProviderConfigInput,
} from "../../../src/agents/sessions/model-registry.js";
import type { ResourceLoader } from "../../../src/agents/sessions/resource-loader.js";
import { createAgentSession } from "../../../src/agents/sessions/sdk.js";
import { SessionManager } from "../../../src/agents/sessions/session-manager.js";
import { SettingsManager } from "../../../src/agents/sessions/settings-manager.js";
import type {
  AssistantMessage,
  AssistantMessageEventStreamContract,
  Model,
} from "../../../src/llm/types.js";

const EXPECTED_PRODUCT_HEAD = "a0658c572070eb98f18f117ec255e05765881ea0";
const INPUT_THINKING_SENTINEL = "PRIVATE_INPUT_REASONING_129567_DO_NOT_FORWARD";
const VISIBLE_HISTORY_SENTINEL = "VISIBLE_HISTORY_129567_MUST_FORWARD";
const MODEL_ID = process.env.OLLAMA_MODEL?.trim() || "qwen3:0.6b";
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(
  /\/+$/,
  "",
);
const OUTPUT_PATH = process.env.PROOF_OUTPUT?.trim() || "artifacts/pr-129567-proof.json";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createResourceLoader(): ResourceLoader {
  const extensionsResult: LoadExtensionsResult = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };
  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function createUsage() {
  return {
    input: 64,
    output: 16,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 80,
    contextUsage: { state: "available" as const, promptTokens: 64, totalTokens: 80 },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

async function readJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  assert(response.ok, `${url} returned ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function startObservabilityProxy(upstreamBaseUrl: string) {
  const requests: Array<{
    path: string;
    inputThinkingAbsent: boolean;
    thinkingLabelAbsent: boolean;
    visibleHistoryPresent: boolean;
  }> = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        assert(length <= 8 * 1024 * 1024, "observed provider request exceeded 8 MiB");
        chunks.push(buffer);
      }
      const body = Buffer.concat(chunks);
      if (request.url === "/api/chat") {
        const serialized = body.toString("utf8");
        JSON.parse(serialized);
        requests.push({
          path: request.url,
          inputThinkingAbsent: !serialized.includes(INPUT_THINKING_SENTINEL),
          thinkingLabelAbsent: !serialized.includes("[Assistant thinking]"),
          visibleHistoryPresent: serialized.includes(VISIBLE_HISTORY_SENTINEL),
        });
      }

      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined && name !== "host" && name !== "content-length") {
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
      }
      const upstream = await fetch(`${upstreamBaseUrl}${request.url ?? "/"}`, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : body,
      });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.statusCode = 502;
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main(): Promise<void> {
  const { execFileSync } = await import("node:child_process");
  const proofHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const productHead = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim();
  assert(productHead === EXPECTED_PRODUCT_HEAD, `unexpected product head ${productHead}`);

  const version = await readJson(`${OLLAMA_BASE_URL}/api/version`);
  const show = await readJson(`${OLLAMA_BASE_URL}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL_ID }),
  });
  const capabilities = Array.isArray(show.capabilities)
    ? show.capabilities.filter((value): value is string => typeof value === "string")
    : [];
  assert(capabilities.includes("thinking"), `${MODEL_ID} does not report thinking capability`);

  const proxy = await startObservabilityProxy(OLLAMA_BASE_URL);
  const root = await mkdtemp(join(tmpdir(), "openclaw-pr-129567-proof-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });
    await mkdir(agentDir, { recursive: true });

    const model: Model = {
      id: MODEL_ID,
      name: MODEL_ID,
      api: "ollama",
      provider: "ollama",
      baseUrl: proxy.baseUrl,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_768,
      maxTokens: 512,
      params: { think: true, num_ctx: 8_192 },
    };
    const providerResponses: AssistantMessage[] = [];
    const realStreamFn = createOllamaStreamFn(proxy.baseUrl);
    const observedStreamFn: NonNullable<ProviderConfigInput["streamSimple"]> = (
      activeModel,
      context,
      options,
    ) => {
      const streamResult = realStreamFn(activeModel, context, options);
      assert(!(streamResult instanceof Promise), "Ollama stream unexpectedly returned a Promise");
      assert(
        "push" in streamResult && "end" in streamResult,
        "Ollama stream contract is incomplete",
      );
      const stream = streamResult as AssistantMessageEventStreamContract;
      return new Proxy(stream, {
        get(target, property) {
          if (property === "result") {
            return async () => {
              const result = await target.result();
              providerResponses.push(result);
              return result;
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };

    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("ollama", "ollama-local-proof");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider("ollama", { api: "ollama", streamSimple: observedStreamFn });
    const settingsManager = SettingsManager.inMemory({
      defaultThinkingLevel: "low",
      compaction: { enabled: true, reserveTokens: 1_024, keepRecentTokens: 0 },
      retry: {
        enabled: false,
        provider: { timeoutMs: 180_000, maxRetries: 0, maxRetryDelayMs: 0 },
      },
    });
    const created = await createAgentSession({
      cwd,
      agentDir,
      model,
      thinkingLevel: "low",
      noTools: "all",
      resourceLoader: createResourceLoader(),
      authStorage,
      modelRegistry,
      settingsManager,
    });
    session = created.session;
    const sessionManager = session.sessionManager;
    const target = sessionManager.getSessionTarget();
    assert(target, "agent session did not create a persistent transcript target");

    const now = Date.now();
    sessionManager.appendMessage({
      role: "user",
      content: "Summarize the completed fixture.",
      timestamp: now,
    });
    sessionManager.appendMessage({
      role: "assistant",
      content: [
        { type: "thinking", thinking: INPUT_THINKING_SENTINEL },
        { type: "text", text: VISIBLE_HISTORY_SENTINEL },
      ],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: createUsage(),
      stopReason: "stop",
      timestamp: now + 1,
    });
    sessionManager.appendMessage({
      role: "user",
      content: "Record that the fixture is complete.",
      timestamp: now + 2,
    });
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "The sanitized fixture is complete." }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: createUsage(),
      stopReason: "stop",
      timestamp: now + 3,
    });
    sessionManager.appendMessage({
      role: "user",
      content: "Continue from the compacted checkpoint.",
      timestamp: now + 4,
    });

    const result = await session.compact();
    sessionManager.flushPendingPersistence();
    const reopened = SessionManager.open(target, cwd);
    const persistedCompactions = reopened
      .getEntries()
      .filter((entry) => entry.type === "compaction");
    const persisted = persistedCompactions.at(-1);
    assert(persisted?.type === "compaction", "persistent transcript has no compaction entry");
    const replay = JSON.stringify(reopened.buildSessionContext());
    const historicalTranscript = JSON.stringify(reopened.getEntries());

    assert(
      proxy.requests.length === 1,
      `expected one real provider request, got ${proxy.requests.length}`,
    );
    const observedRequest = proxy.requests[0];
    assert(observedRequest?.inputThinkingAbsent, "input thinking reached the provider request");
    assert(
      observedRequest.thinkingLabelAbsent,
      "assistant thinking label reached the provider request",
    );
    assert(
      observedRequest.visibleHistoryPresent,
      "visible assistant history was omitted from the request",
    );
    assert(
      providerResponses.length === 1,
      `expected one provider response, got ${providerResponses.length}`,
    );
    const providerResponse = providerResponses[0];
    assert(
      providerResponse?.stopReason === "stop",
      `provider stopped with ${providerResponse?.stopReason}`,
    );
    const providerThinking = providerResponse.content
      .filter((block) => block.type === "thinking")
      .map((block) => block.thinking)
      .join("");
    const providerText = providerResponse.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    assert(
      providerThinking.trim().length > 0,
      "real provider returned no separate thinking content",
    );
    assert(providerText.trim().length > 0, "real provider returned no visible completion text");
    assert(result.summary === persisted.summary, "returned and persisted summaries differ");
    assert(
      !persisted.summary.includes(INPUT_THINKING_SENTINEL),
      "input thinking entered persisted summary",
    );
    assert(
      !persisted.summary.includes(providerThinking),
      "provider thinking entered persisted summary",
    );
    assert(
      !replay.includes(INPUT_THINKING_SENTINEL),
      "input thinking entered compacted replay context",
    );
    assert(
      !replay.includes(providerThinking),
      "provider thinking entered compacted replay context",
    );
    assert(
      historicalTranscript.includes(INPUT_THINKING_SENTINEL),
      "synthetic historical input was not durably persisted before compaction",
    );

    const artifact = {
      schema: "openclaw.pr129567.real-compaction-proof.v1",
      proofHead,
      productHead,
      provider: {
        kind: "real-local-ollama",
        version: typeof version.version === "string" ? version.version : "unknown",
        imageDigest: process.env.OLLAMA_IMAGE_DIGEST?.trim() || "unknown",
        model: MODEL_ID,
        capabilities,
        completionSink: "real Ollama /api/chat",
        observabilityProxy: "byte-forwarding request observer; no response synthesis or mutation",
      },
      session: {
        persistence: "SQLite",
        providerRequestCount: proxy.requests.length,
        providerResponseCount: providerResponses.length,
        compactionEntryCount: persistedCompactions.length,
        originalReasoningRetainedOnlyInHistoricalPrefix:
          historicalTranscript.includes(INPUT_THINKING_SENTINEL) &&
          !replay.includes(INPUT_THINKING_SENTINEL),
      },
      request: observedRequest,
      completion: {
        stopReason: providerResponse.stopReason,
        thinkingChars: providerThinking.length,
        thinkingSha256: sha256(providerThinking),
        visibleTextChars: providerText.length,
        visibleTextSha256: sha256(providerText),
      },
      persistedCompaction: {
        summaryChars: persisted.summary.length,
        summarySha256: sha256(persisted.summary),
        inputThinkingAbsent: !persisted.summary.includes(INPUT_THINKING_SENTINEL),
        providerThinkingAbsent: !persisted.summary.includes(providerThinking),
        replayInputThinkingAbsent: !replay.includes(INPUT_THINKING_SENTINEL),
        replayProviderThinkingAbsent: !replay.includes(providerThinking),
      },
      assertions: {
        exactProductHead: "PASS",
        realThinkingCapableProvider: "PASS",
        inputThinkingOmittedFromRequest: "PASS",
        visibleHistoryRetainedInRequest: "PASS",
        providerReturnedSeparateThinkingAndText: "PASS",
        providerCompletionSucceeded: "PASS",
        compactionPersistedToSqlite: "PASS",
        thinkingOmittedFromPersistedSummaryAndReplay: "PASS",
      },
      githubRunId: process.env.GITHUB_RUN_ID?.trim() || null,
    };
    await mkdir(join(OUTPUT_PATH, ".."), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } finally {
    session?.dispose();
    await proxy.close();
    await rm(root, { recursive: true, force: true });
  }
}

await main();
