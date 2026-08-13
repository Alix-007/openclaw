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

const FAKE_REQUEST_SECRET = "openclaw-proof-fake-9Xv7Kp4Qm2Ns8Lw6";
const SAFE_MARKER = "SAFE_LOOPBACK_PROVIDER_FAILURE";

function requireProof(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new Error(`foundation runtime proof failed: ${code}`);
  }
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
  throw new Error("foundation runtime proof failed: production-sink-timeout");
}

function assertSecretAbsent(text: string, surface: string): void {
  requireProof(!text.includes(FAKE_REQUEST_SECRET), `${surface}-secret-absent`);
  requireProof(!text.includes(`Bearer ${FAKE_REQUEST_SECRET}`), `${surface}-bearer-absent`);
  requireProof(
    !text.includes(encodeURIComponent(FAKE_REQUEST_SECRET)),
    `${surface}-encoded-secret-absent`,
  );
}

async function main(): Promise<void> {
  const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA;
  const artifactDir = process.env.OPENCLAW_PROOF_ARTIFACT_DIR;
  requireProof(targetSha?.match(/^[0-9a-f]{40}$/u), "exact-target-sha");
  requireProof(artifactDir, "artifact-directory");
  requireProof(process.versions.node.startsWith("24."), "node24-runtime");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-request-redaction-proof-"));
  const sinkFile = path.join(tempDir, "runtime.jsonl");
  const configFile = path.join(tempDir, "openclaw.json");
  await fs.writeFile(
    configFile,
    JSON.stringify({ logging: { level: "info", consoleLevel: "silent", file: sinkFile } }),
  );
  process.env.OPENCLAW_CONFIG_PATH = configFile;

  const productModule = (relativePath: string) =>
    pathToFileURL(path.join(process.cwd(), relativePath)).href;
  const [{ postJsonRequest }, { createSubsystemLogger }, { formatErrorMessage }] =
    await Promise.all([
      import(productModule("src/media-understanding/shared.ts")),
      import(productModule("src/logging/subsystem.ts")),
      import(productModule("src/infra/errors.ts")),
    ]);
  requireProof(typeof postJsonRequest === "function", "shared-provider-caller-import");
  requireProof(typeof createSubsystemLogger === "function", "production-log-sink-import");
  requireProof(typeof formatErrorMessage === "function", "agent-visible-formatter-import");

  let requestCount = 0;
  const server = http.createServer((request, response) => {
    requestCount += 1;
    const authorization = request.headers.authorization ?? "";
    if (authorization !== `Bearer ${FAKE_REQUEST_SECRET}`) {
      response.statusCode = 400;
      response.end("missing proof credential");
      return;
    }
    response.statusCode = 429;
    response.setHeader("content-type", "application/json");
    response.setHeader("x-request-id", `request-${FAKE_REQUEST_SECRET}`);
    response.end(
      JSON.stringify({
        error: {
          message: `${SAFE_MARKER} reflected=${FAKE_REQUEST_SECRET}`,
          code: `quota-${FAKE_REQUEST_SECRET}`,
          type: `rate-${FAKE_REQUEST_SECRET}`,
        },
      }),
    );
  });

  const port = await listen(server);
  let normalizedError: ProviderErrorLike | undefined;
  try {
    normalizedError = await postJsonRequest({
      url: `http://127.0.0.1:${port}/provider`,
      headers: new Headers({ authorization: `Bearer ${FAKE_REQUEST_SECRET}` }),
      body: { proof: true },
      fetchFn: fetch,
      allowPrivateNetwork: true,
      mode: "strict",
      retryStage: "read",
      retry: { attempts: 1 },
    }).then(
      () => undefined,
      (error: unknown) => error as ProviderErrorLike,
    );
  } finally {
    await close(server);
  }

  requireProof(normalizedError instanceof Error, "normalized-provider-error");
  requireProof(normalizedError.status === 429, "normalized-provider-status");
  requireProof(requestCount === 1, "single-loopback-request");

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
  assertSecretAbsent(diagnostics, "normalized-diagnostics");
  assertSecretAbsent(String(normalizedError), "normalized-string");
  assertSecretAbsent(agentVisibleText, "agent-visible-text");

  const logger = createSubsystemLogger("proof/request-secret-runtime");
  logger.error(`${SAFE_MARKER} ${agentVisibleText}`, {
    status: normalizedError.status,
    code: normalizedError.code,
    errorType: normalizedError.errorType,
    errorBody: normalizedError.errorBody,
    requestId: normalizedError.requestId,
  });
  const sink = await waitForSink(sinkFile);
  requireProof(sink.includes(SAFE_MARKER), "production-sink-safe-marker-preserved");
  assertSecretAbsent(sink, "production-sink");

  const records = sink
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  requireProof(records.length === 1, "production-sink-record-count");

  await fs.mkdir(artifactDir, { recursive: true });
  const artifactSink = path.join(artifactDir, "production-sink.jsonl");
  await fs.writeFile(artifactSink, sink);
  const verdict = {
    schemaVersion: 1,
    verdict: "pass",
    targetSha,
    boundary: [
      "real-loopback-provider-failure",
      "production-shared-post-json-request",
      "production-provider-error-normalization",
      "production-agent-visible-error-formatting",
      "production-jsonl-log-sink",
    ],
    assertions: {
      exactTargetSha: true,
      fixedFakeRequestSecretOnly: true,
      singleLoopbackRequest: true,
      normalizedDiagnosticsSecretAbsent: true,
      agentVisibleTextSecretAbsent: true,
      productionSinkSecretAbsent: true,
      safeMarkerPreserved: true,
    },
    observations: {
      httpStatus: normalizedError.status,
      requestCount,
      logRecords: records.length,
      sinkSha256: createHash("sha256").update(sink).digest("hex"),
      nodeVersion: process.version,
    },
    redactedOutput: {
      normalizedMessage: normalizedError.message,
      agentVisibleText,
      requestId: normalizedError.requestId,
    },
    secrets: {
      source: "fixed-synthetic-proof-value",
      realCredentialsRead: false,
      artifactContainsSyntheticValue: false,
    },
  };
  const verdictText = `${JSON.stringify(verdict, null, 2)}\n`;
  assertSecretAbsent(verdictText, "verdict");
  await fs.writeFile(path.join(artifactDir, "verdict.json"), verdictText);
  await fs.rm(tempDir, { recursive: true, force: true });

  console.log(
    "[foundation request-secret runtime proof] loopback=true shared-normalization=true agent-visible=true production-sink=true secret-output=false",
  );
}

await main();
