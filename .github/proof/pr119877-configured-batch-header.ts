import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ProviderErrorLike = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
  errorCode?: string;
  errorType?: string;
  errorBody?: string;
  requestId?: string;
};

type RequestTrace = {
  sequence: number;
  method: string;
  path: string;
  configuredHeaderPresent: boolean;
  bodyBytes: number;
  responseStatus: number;
};

const EXPECTED_TARGET_SHA = "9ebc312ce89f07189ed1316e48581e74da7b4cd2";
const CONFIGURED_HEADER_NAME = "X-Workspace";
const CONFIGURED_HEADER_VALUE = "literal-workspace-routing-value";
const SAFE_MARKER = "SAFE_CONFIGURED_BATCH_FAILURE";

function requireProof(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new Error(`configured batch header proof failed: ${code}`);
  }
}

function assertConfiguredValueAbsent(text: string, surface: string): void {
  requireProof(!text.includes(CONFIGURED_HEADER_VALUE), `${surface}-raw-value-absent`);
  requireProof(
    !text.includes(encodeURIComponent(CONFIGURED_HEADER_VALUE)),
    `${surface}-encoded-value-absent`,
  );
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  requireProof(address && typeof address === "object", "loopback-listener-address");
  return address.port;
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitForSink(file: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const content = await fs.readFile(file, "utf8").catch(() => "");
    if (content.includes(SAFE_MARKER)) {
      return content;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("configured batch header proof failed: production-sink-timeout");
}

async function readBodyBytes(request: http.IncomingMessage): Promise<number> {
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk));
  }
  return bytes;
}

async function main(): Promise<void> {
  const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA;
  const artifactDir = process.env.OPENCLAW_PROOF_ARTIFACT_DIR;
  requireProof(targetSha === EXPECTED_TARGET_SHA, "exact-target-sha");
  requireProof(artifactDir, "artifact-directory");
  requireProof(process.versions.node.startsWith("24."), "node24-runtime");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-batch-header-proof-"));
  const sinkFile = path.join(tempDir, "runtime.jsonl");
  const configFile = path.join(tempDir, "openclaw.json");
  await fs.writeFile(
    configFile,
    JSON.stringify({ logging: { level: "info", consoleLevel: "silent", file: sinkFile } }),
  );
  process.env.OPENCLAW_CONFIG_PATH = configFile;

  const productModule = (relativePath: string) =>
    pathToFileURL(path.join(process.cwd(), relativePath)).href;
  const [remoteClientModule, batchModule, loggerModule, errorModule, redactionModule] =
    await Promise.all([
      import(productModule("packages/memory-host-sdk/src/host/embeddings-remote-client.ts")),
      import(productModule("extensions/openai/embedding-batch.ts")),
      import(productModule("src/logging/subsystem.ts")),
      import(productModule("src/infra/errors.ts")),
      import(productModule("src/logging/redact.ts")),
    ]);
  const { resolveRemoteEmbeddingBearerClient } = remoteClientModule;
  const { runOpenAiEmbeddingBatches } = batchModule;
  const { createSubsystemLogger } = loggerModule;
  const { formatErrorMessage } = errorModule;
  const { redactSensitiveText } = redactionModule;
  requireProof(typeof resolveRemoteEmbeddingBearerClient === "function", "remote-client-import");
  requireProof(typeof runOpenAiEmbeddingBatches === "function", "batch-owner-import");
  requireProof(typeof createSubsystemLogger === "function", "production-log-sink-import");
  requireProof(typeof formatErrorMessage === "function", "agent-visible-formatter-import");
  requireProof(typeof redactSensitiveText === "function", "heuristic-redactor-import");
  requireProof(
    redactSensitiveText(`ordinary ${CONFIGURED_HEADER_VALUE}`).includes(CONFIGURED_HEADER_VALUE),
    "configured-value-is-not-heuristically-redacted",
  );

  const requestTrace: RequestTrace[] = [];
  const server = http.createServer((request, response) => {
    void (async () => {
      const bodyBytes = await readBodyBytes(request);
      const configuredHeaderPresent =
        request.headers[CONFIGURED_HEADER_NAME.toLowerCase()] === CONFIGURED_HEADER_VALUE;
      const pathName = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      let responseStatus = 500;
      let responseBody: Record<string, unknown> = { error: { message: "unexpected proof route" } };
      if (request.method === "POST" && pathName === "/v1/files") {
        responseStatus = 200;
        responseBody = { id: "file-0" };
      } else if (request.method === "POST" && pathName === "/v1/batches") {
        responseStatus = 200;
        responseBody = { id: "batch-0", status: "in_progress" };
      } else if (request.method === "GET" && pathName === "/v1/batches/batch-0") {
        responseStatus = 400;
        response.setHeader("x-request-id", `request-${CONFIGURED_HEADER_VALUE}`);
        responseBody = {
          error: {
            message: `${SAFE_MARKER} reflected=${CONFIGURED_HEADER_VALUE}`,
            code: CONFIGURED_HEADER_VALUE,
            type: CONFIGURED_HEADER_VALUE,
          },
        };
      }
      requestTrace.push({
        sequence: requestTrace.length + 1,
        method: request.method ?? "UNKNOWN",
        path: pathName,
        configuredHeaderPresent,
        bodyBytes,
        responseStatus,
      });
      response.statusCode = responseStatus;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(responseBody));
    })().catch(() => {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: { message: "proof loopback handler failed" } }));
    });
  });

  const port = await listen(server);
  let normalizedError: ProviderErrorLike | undefined;
  try {
    const client = await resolveRemoteEmbeddingBearerClient({
      provider: "openai",
      defaultBaseUrl: `http://127.0.0.1:${port}/v1`,
      options: {
        config: { models: {} },
        model: "text-embedding-3-small",
        remote: {
          apiKey: "fixture-bearer",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          headers: { [CONFIGURED_HEADER_NAME]: CONFIGURED_HEADER_VALUE },
        },
      },
    });
    normalizedError = await runOpenAiEmbeddingBatches({
      openAi: { ...client, model: "text-embedding-3-small" },
      agentId: "proof-agent",
      requests: [
        {
          custom_id: "proof-0",
          method: "POST",
          url: "/v1/embeddings",
          body: { model: "text-embedding-3-small", input: "proof payload" },
        },
      ],
      wait: true,
      concurrency: 1,
      pollIntervalMs: 1,
      timeoutMs: 10_000,
    }).then(
      () => undefined,
      (error: unknown) => error as ProviderErrorLike,
    );
  } finally {
    await close(server);
  }

  requireProof(normalizedError instanceof Error, "normalized-provider-error");
  requireProof(normalizedError.status === 400, "normalized-provider-status");
  requireProof(requestTrace.length === 3, "three-production-batch-requests");
  requireProof(
    requestTrace.every((entry) => entry.configuredHeaderPresent),
    "configured-header-reached-every-request",
  );
  requireProof(
    JSON.stringify(requestTrace.map(({ method, path: requestPath }) => [method, requestPath])) ===
      JSON.stringify([
        ["POST", "/v1/files"],
        ["POST", "/v1/batches"],
        ["GET", "/v1/batches/batch-0"],
      ]),
    "production-request-order",
  );

  const diagnostics = JSON.stringify({
    name: normalizedError.name,
    message: normalizedError.message,
    stack: normalizedError.stack,
    status: normalizedError.status,
    statusCode: normalizedError.statusCode,
    code: normalizedError.code,
    errorCode: normalizedError.errorCode,
    errorType: normalizedError.errorType,
    errorBody: normalizedError.errorBody,
    requestId: normalizedError.requestId,
  });
  const agentVisibleText = formatErrorMessage(normalizedError);
  requireProof(diagnostics.includes(SAFE_MARKER), "diagnostic-safe-marker-preserved");
  requireProof(agentVisibleText.includes(SAFE_MARKER), "agent-visible-safe-marker-preserved");
  requireProof(diagnostics.includes("***"), "exact-request-redaction-marker-present");
  assertConfiguredValueAbsent(diagnostics, "normalized-diagnostics");
  assertConfiguredValueAbsent(String(normalizedError), "normalized-string");
  assertConfiguredValueAbsent(agentVisibleText, "agent-visible-text");

  const logger = createSubsystemLogger("proof/configured-batch-header");
  logger.error(`${SAFE_MARKER} ${agentVisibleText}`, {
    status: normalizedError.status,
    code: normalizedError.code,
    errorType: normalizedError.errorType,
    errorBody: normalizedError.errorBody,
    requestId: normalizedError.requestId,
  });
  const sink = await waitForSink(sinkFile);
  requireProof(sink.includes(SAFE_MARKER), "production-sink-safe-marker-preserved");
  assertConfiguredValueAbsent(sink, "production-sink");
  const records = sink
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  requireProof(records.length === 1, "production-sink-record-count");

  await fs.mkdir(artifactDir, { recursive: true });
  const artifactSink = path.join(artifactDir, "production-sink.jsonl");
  const artifactTrace = path.join(artifactDir, "request-trace.json");
  await fs.writeFile(artifactSink, sink);
  const traceText = `${JSON.stringify(requestTrace, null, 2)}\n`;
  assertConfiguredValueAbsent(traceText, "request-trace");
  await fs.writeFile(artifactTrace, traceText);
  const verdict = {
    schemaVersion: 1,
    verdict: "pass",
    targetSha,
    boundary: [
      "production-remote-embedding-client",
      "production-batch-header-reconstruction",
      "production-guarded-remote-http",
      "production-provider-error-normalization",
      "production-agent-visible-error-formatting",
      "production-jsonl-log-sink",
    ],
    assertions: {
      exactTargetSha: true,
      configuredHeaderName: CONFIGURED_HEADER_NAME.toLowerCase(),
      nonHeuristicValueControl: true,
      productionRequestOrder: true,
      configuredHeaderReachedEveryRequest: true,
      reflectedValueRemovedFromDiagnostics: true,
      reflectedValueRemovedFromAgentVisibleText: true,
      reflectedValueRemovedFromProductionSink: true,
      safeMarkerPreserved: true,
    },
    observations: {
      httpRequests: requestTrace.length,
      requestPaths: requestTrace.map(({ method, path: requestPath }) => `${method} ${requestPath}`),
      finalHttpStatus: normalizedError.status,
      logRecords: records.length,
      sinkSha256: createHash("sha256").update(sink).digest("hex"),
      traceSha256: createHash("sha256").update(traceText).digest("hex"),
      nodeVersion: process.version,
    },
    redactedOutput: {
      normalizedMessage: normalizedError.message,
      agentVisibleText,
      requestId: normalizedError.requestId,
    },
    secrets: {
      source: "fixed-synthetic-configured-header-value",
      realCredentialsRead: false,
      artifactContainsSyntheticValue: false,
    },
  };
  const verdictText = `${JSON.stringify(verdict, null, 2)}\n`;
  assertConfiguredValueAbsent(verdictText, "verdict");
  await fs.writeFile(path.join(artifactDir, "verdict.json"), verdictText);
  await fs.rm(tempDir, { recursive: true, force: true });

  console.log(
    "[configured batch header proof] exact=true loopback=true requests=3 remote-client=true batch-copy=true guarded-http=true agent-visible=true jsonl=true configured-value-output=false",
  );
}

await main();
