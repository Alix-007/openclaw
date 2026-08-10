import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

type ProviderErrorLike = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
  errorCode?: string;
  errorType?: string;
  errorBody?: string;
  requestId?: string;
};

function requireProof(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new Error(`foundation proof failed: ${code}`);
  }
}

function jsonEscapedValue(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function formEncodedValue(value: string): string {
  return new URLSearchParams({ echo: value }).toString().slice("echo=".length);
}

function secretVariants(value: string): string[] {
  const encoded = encodeURIComponent(value);
  return [
    ...new Set([
      value,
      encoded,
      encoded.toLowerCase(),
      jsonEscapedValue(value),
      formEncodedValue(value),
    ]),
  ];
}

async function waitForLog(file: string, markers: readonly string[]): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const content = await fs.readFile(file, "utf8").catch(() => "");
    if (markers.every((marker) => content.includes(marker))) {
      return content;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("foundation proof failed: log-sink-timeout");
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
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

async function main(): Promise<void> {
  const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA;
  const artifactDir = process.env.OPENCLAW_PROOF_ARTIFACT_DIR;
  requireProof(targetSha?.match(/^[0-9a-f]{40}$/u), "exact-target-sha");
  requireProof(artifactDir, "artifact-directory");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-foundation-proof-"));
  const logFile = path.join(tempDir, "foundation.jsonl");
  const configFile = path.join(tempDir, "openclaw.json");
  await fs.writeFile(
    configFile,
    JSON.stringify({
      logging: {
        level: "info",
        file: logFile,
        consoleLevel: "silent",
      },
    }),
  );
  process.env.OPENCLAW_CONFIG_PATH = configFile;

  const [{ createSubsystemLogger }, { createProviderHttpError }] = await Promise.all([
    import("openclaw/plugin-sdk/logging-core"),
    import("openclaw/plugin-sdk/provider-http"),
  ]);
  requireProof(typeof createSubsystemLogger === "function", "public-logging-sdk-import");
  requireProof(typeof createProviderHttpError === "function", "provider-http-runtime-import");

  const requestSecret = 'foundation proof A/B?C=D&E +"Q"\\R';
  const logSecret = "foundation-proof-bearer-4f1d9c7e2a6b8d03";
  const longSecret = `foundation-truncation-${"Z".repeat(20 * 1024)}`;
  const safeMarkers = ["SAFE_RAW", "SAFE_JSON", "SAFE_URL", "SAFE_FORM", "SAFE_TRUNCATED"];
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.statusCode = 429;
    response.setHeader(
      "x-request-id",
      pathname === "/truncated" ? "safe-request-truncated" : `safe-request-${requestSecret}`,
    );
    if (pathname === "/raw") {
      response.end(`SAFE_RAW reflected=${requestSecret}`);
      return;
    }
    if (pathname === "/json") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error: {
            message: `SAFE_JSON reflected=${requestSecret}`,
            code: `code-${requestSecret}`,
          },
        }),
      );
      return;
    }
    if (pathname === "/url") {
      response.end(
        `SAFE_URL https://provider.invalid/failure?echo=${encodeURIComponent(requestSecret)}`,
      );
      return;
    }
    if (pathname === "/form") {
      response.end(`SAFE_FORM echo=${formEncodedValue(requestSecret)}&control=ok`);
      return;
    }
    if (pathname === "/truncated") {
      response.end(`SAFE_TRUNCATED reflected=${longSecret}`);
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });

  const port = await listen(server);
  const logger = createSubsystemLogger("proof/foundation-sdk");
  const normalizedErrors: ProviderErrorLike[] = [];
  try {
    for (const caseName of ["raw", "json", "url", "form", "truncated"] as const) {
      const response = await fetch(`http://127.0.0.1:${port}/${caseName}`);
      const sensitiveValue = caseName === "truncated" ? longSecret : requestSecret;
      const error = (await createProviderHttpError(response, `SAFE_${caseName.toUpperCase()}`, {
        sensitiveValues: [sensitiveValue],
      })) as ProviderErrorLike;
      requireProof(error.status === 429, `${caseName}-status`);
      normalizedErrors.push(error);
      logger.info(`CASE_${caseName.toUpperCase()} ${error.message}`, {
        status: error.status,
        body: error.errorBody,
        requestId: error.requestId,
        code: error.code,
      });
    }
    logger.info(`SAFE_LOG Authorization: Bearer ${logSecret}`, {
      authorization: `Bearer ${logSecret}`,
    });
  } finally {
    await close(server);
  }

  const normalizedText = JSON.stringify(
    normalizedErrors.map((error) => ({
      name: error.name,
      message: error.message,
      status: error.status,
      statusCode: error.statusCode,
      code: error.code,
      errorCode: error.errorCode,
      errorType: error.errorType,
      errorBody: error.errorBody,
      requestId: error.requestId,
    })),
  );
  for (const variant of secretVariants(requestSecret)) {
    requireProof(!normalizedText.includes(variant), "normalized-request-secret-absent");
  }
  requireProof(
    !normalizedText.includes(longSecret.slice(0, 512)),
    "normalized-truncated-secret-prefix-absent",
  );
  for (const marker of safeMarkers) {
    requireProof(normalizedText.includes(marker), `normalized-${marker.toLowerCase()}-marker`);
  }

  const logMarkers = [
    ...safeMarkers.map((marker) => `CASE_${marker.slice("SAFE_".length)}`),
    "SAFE_LOG",
  ];
  const sink = await waitForLog(logFile, logMarkers);
  for (const variant of [...secretVariants(requestSecret), ...secretVariants(logSecret)]) {
    requireProof(!sink.includes(variant), "file-sink-secret-absent");
  }
  requireProof(!sink.includes(longSecret.slice(0, 512)), "file-sink-truncated-prefix-absent");

  const records = sink
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  requireProof(records.length === 6, "file-sink-record-count");

  await fs.mkdir(artifactDir, { recursive: true });
  const sinkSha256 = createHash("sha256").update(sink).digest("hex");
  const verdict = {
    schemaVersion: 1,
    verdict: "pass",
    targetSha,
    boundary: [
      "compiled-external-plugin-sdk-consumer",
      "public-logging-core-package-subpath",
      "private-local-provider-http-runtime-subpath",
      "real-loopback-http-error-responses",
      "production-provider-error-normalization",
      "production-jsonl-file-log-sink",
    ],
    assertions: {
      packageSubpathImportsResolved: true,
      rawSecretRedacted: true,
      jsonEscapedSecretRedacted: true,
      urlEncodedSecretRedacted: true,
      formEncodedSecretRedacted: true,
      truncationBoundaryPrefixRedacted: true,
      realFileSinkWritten: true,
      sinkSecretsAbsent: true,
      safeMarkersPreserved: true,
    },
    observations: {
      httpStatus: 429,
      errorCases: 5,
      logRecords: records.length,
      sinkSha256,
    },
    scope: {
      loggingContract: "public-plugin-sdk",
      providerHttpContract: "private-local-official-plugin-runtime",
      providerSpecificAdoptionProven: false,
    },
    redaction: {
      requestSecretsIncluded: false,
      encodedSecretsIncluded: false,
      truncationPrefixIncluded: false,
      filesystemPathsIncluded: false,
      responseBodiesIncluded: false,
    },
  };
  await fs.copyFile(logFile, path.join(artifactDir, "foundation-sdk-sink.jsonl"));
  await fs.writeFile(
    path.join(artifactDir, "proof-foundation-sdk-runtime.json"),
    `${JSON.stringify(verdict, null, 2)}\n`,
  );
  console.log(
    "[foundation compiled SDK proof] consumer=true loopback-http=true provider-error=true file-sink=true raw=true json=true url=true form=true truncation-boundary=true secret-output=false",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(message);
  process.exitCode = 1;
});
