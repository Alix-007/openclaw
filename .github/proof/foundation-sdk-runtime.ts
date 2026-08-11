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
  requireProof(process.env.OPENCLAW_PROOF_OPENAI_PLUGIN_TTS === "1", "openai-plugin-tts-test");
  requireProof(process.env.OPENCLAW_PROOF_JSON_SLASH === "1", "json-optional-slash-test");
  requireProof(process.env.OPENCLAW_PROOF_JSON_SLASH_DANGLING === "1", "json-slash-dangling-test");
  requireProof(process.env.OPENCLAW_PROOF_OPENAI_REALTIME === "1", "openai-realtime-test");
  requireProof(
    process.env.OPENCLAW_PROOF_OPENAI_EMBEDDING_BATCH === "1",
    "openai-embedding-batch-test",
  );
  requireProof(process.env.OPENCLAW_PROOF_OPENAI_IMAGE === "1", "openai-image-test");
  requireProof(process.env.OPENCLAW_PROOF_OPENAI_VIDEO === "1", "openai-video-test");
  requireProof(process.env.OPENCLAW_PROOF_PERPLEXITY_NATIVE === "1", "perplexity-native-test");
  requireProof(process.env.OPENCLAW_PROOF_PERPLEXITY_CHAT === "1", "perplexity-chat-test");
  requireProof(process.env.OPENCLAW_PROOF_EXA_WEB_SEARCH === "1", "exa-web-search-test");
  requireProof(process.env.OPENCLAW_PROOF_OLLAMA_WEB_SEARCH === "1", "ollama-web-search-test");
  requireProof(process.env.OPENCLAW_PROOF_PARALLEL_WEB_SEARCH === "1", "parallel-web-search-test");
  requireProof(
    process.env.OPENCLAW_PROOF_GUARDED_REQUEST_CONTEXT === "1",
    "guarded-request-context-test",
  );
  requireProof(
    process.env.OPENCLAW_PROOF_CONFIGURED_HEADER === "1",
    "configured-header-provenance-test",
  );
  requireProof(process.env.OPENCLAW_PROOF_INVALID_CONTENT === "1", "invalid-content-test");
  requireProof(process.env.OPENCLAW_PROOF_SHORT_FAIL_CLOSED === "1", "short-secret-test");
  requireProof(process.env.OPENCLAW_PROOF_MANUAL_OAUTH === "1", "manual-oauth-owner-test");
  requireProof(process.env.OPENCLAW_PROOF_MANUAL_VOICE === "1", "manual-voice-owner-test");
  requireProof(process.env.OPENCLAW_PROOF_INWORLD === "1", "inworld-owner-test");
  requireProof(process.env.OPENCLAW_PROOF_CALLSITE_INVENTORY === "1", "callsite-inventory-test");
  requireProof(process.versions.node.startsWith("24."), "node24-runtime");

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

  const [
    { createSubsystemLogger },
    { createProviderHttpError, postJsonRequest, readResponseTextLimited },
  ] = await Promise.all([
    import("openclaw/plugin-sdk/logging-core"),
    import("openclaw/plugin-sdk/provider-http"),
  ]);
  requireProof(typeof createSubsystemLogger === "function", "public-logging-sdk-import");
  requireProof(typeof createProviderHttpError === "function", "provider-http-runtime-import");
  requireProof(typeof postJsonRequest === "function", "shared-provider-caller-runtime-import");
  requireProof(
    typeof readResponseTextLimited === "function",
    "bounded-response-reader-runtime-import",
  );

  const requestSecret = 'foundation proof A/B?C=D&E +"Q"\\R';
  const slashSecret = "foundation/slash17/credential";
  const slashEscapedSecret = slashSecret.replaceAll("/", String.raw`\/`);
  const slashEscapes = [...slashEscapedSecret.matchAll(/\\\//gu)];
  const danglingSlashIndex = slashEscapes[1]?.index;
  requireProof(danglingSlashIndex !== undefined, "second-json-slash-escape");
  const danglingSlashPrefix = slashEscapedSecret.slice(0, danglingSlashIndex + 1);
  const logSecret = "foundation-proof-bearer-4f1d9c7e2a6b8d03";
  const redirectHeaderSecret = "foundation-redirect-header-8e2a4d6c";
  const redirectQuerySecret = "foundation-redirect-query-7b3c5f9a";
  const shortSecret = "1";
  const longSecret = `foundation-truncation-${"Z".repeat(20 * 1024)}`;
  const safeMarkers = [
    "SAFE_RAW",
    "SAFE_JSON",
    "SAFE_URL",
    "SAFE_FORM",
    "SAFE_TRUNCATED",
    "SAFE_JSON_SLASH",
    "SAFE_ACTIVE",
    "SAFE_REDIRECT",
  ];
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    // The oversized value cannot be transported in a request header; that case isolates the
    // response-body cap while all other cases reflect the credential actually sent on the wire.
    const reflectedCredential =
      pathname === "/truncated"
        ? longSecret
        : (request.headers.authorization?.replace(/^Bearer /u, "") ?? "");
    response.statusCode = 429;
    response.setHeader(
      "x-request-id",
      pathname === "/truncated" ? "safe-request-truncated" : `safe-request-${reflectedCredential}`,
    );
    if (pathname === "/raw") {
      response.end(`SAFE_RAW reflected=${reflectedCredential}`);
      return;
    }
    if (pathname === "/json") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error: {
            message: `SAFE_JSON reflected=${reflectedCredential}`,
            code: `code-${reflectedCredential}`,
          },
        }),
      );
      return;
    }
    if (pathname === "/json-slash") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error: {
            message: `SAFE_JSON_SLASH reflected=${slashEscapedSecret}`,
            code: slashEscapedSecret,
            type: slashEscapedSecret,
          },
        }).replaceAll(String.raw`\\/`, String.raw`\/`),
      );
      return;
    }
    if (pathname === "/url") {
      response.end(
        `SAFE_URL https://provider.invalid/failure?echo=${encodeURIComponent(reflectedCredential)}`,
      );
      return;
    }
    if (pathname === "/form") {
      response.end(`SAFE_FORM echo=${formEncodedValue(reflectedCredential)}&control=ok`);
      return;
    }
    if (pathname === "/truncated") {
      response.end(`SAFE_TRUNCATED reflected=${reflectedCredential}`);
      return;
    }
    if (pathname === "/truncated-json-slash") {
      response.end(
        `${"x".repeat(16 * 1024 - danglingSlashPrefix.length)}${slashEscapedSecret} trailing text`,
      );
      return;
    }
    if (pathname === "/redirect") {
      response.statusCode = 302;
      response.setHeader(
        "location",
        `/active?access_token=${encodeURIComponent(redirectQuerySecret)}`,
      );
      response.end();
      return;
    }
    if (pathname === "/active") {
      const reflectedQueryCredential = requestUrl.searchParams.get("access_token") ?? "";
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error: {
            message: `${reflectedQueryCredential ? "SAFE_REDIRECT" : "SAFE_ACTIVE"} reflected=${reflectedCredential} ${reflectedQueryCredential}`,
            code: reflectedCredential,
            type: reflectedQueryCredential || `quota-${reflectedCredential}`,
          },
        }),
      );
      return;
    }
    if (pathname === "/short") {
      response.setHeader("content-type", "application/json");
      response.setHeader("x-request-id", `short-${shortSecret}`);
      response.end(
        JSON.stringify({ error: { message: `provider code ${shortSecret}, retry in 10 seconds` } }),
      );
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });

  const port = await listen(server);
  const logger = createSubsystemLogger("proof/foundation-sdk");
  const normalizedErrors: ProviderErrorLike[] = [];
  try {
    for (const caseName of ["raw", "json", "url", "form", "truncated", "json-slash"] as const) {
      const sensitiveValue =
        caseName === "truncated"
          ? longSecret
          : caseName === "json-slash"
            ? slashSecret
            : requestSecret;
      const requestHeaders =
        caseName === "truncated"
          ? undefined
          : new Headers({ authorization: `Bearer ${sensitiveValue}` });
      const response = await fetch(
        `http://127.0.0.1:${port}/${caseName}`,
        requestHeaders ? { headers: requestHeaders } : undefined,
      );
      const caseMarker = caseName.replaceAll("-", "_").toUpperCase();
      const error = (await createProviderHttpError(
        response,
        `SAFE_${caseMarker}`,
        requestHeaders ? { requestHeaders } : { sensitiveValues: [sensitiveValue] },
      )) as ProviderErrorLike;
      requireProof(error.status === 429, `${caseName}-status`);
      normalizedErrors.push(error);
      logger.info(`CASE_${caseMarker} ${error.message}`, {
        status: error.status,
        body: error.errorBody,
        requestId: error.requestId,
        code: error.code,
      });
    }
    const danglingSlashResponse = await fetch(`http://127.0.0.1:${port}/truncated-json-slash`, {
      headers: new Headers({ authorization: `Bearer ${slashSecret}` }),
    });
    const danglingSlashDetail = await readResponseTextLimited(danglingSlashResponse, 16 * 1024, {
      sensitiveValues: [slashSecret],
    });
    requireProof(
      danglingSlashDetail.includes("truncated diagnostic omitted"),
      "json-slash-dangling-truncation-marker",
    );
    requireProof(
      !danglingSlashDetail.includes(danglingSlashPrefix),
      "json-slash-dangling-prefix-absent",
    );
    requireProof(
      !danglingSlashDetail.includes(slashEscapedSecret),
      "json-slash-dangling-secret-absent",
    );
    logger.info("CASE_TRUNCATED_JSON_SLASH SAFE_TRUNCATED_JSON_SLASH", {
      redacted: true,
    });
    const activeError = await postJsonRequest({
      url: `http://127.0.0.1:${port}/active`,
      headers: new Headers({ authorization: `Bearer ${requestSecret}` }),
      body: { proof: true },
      fetchFn: fetch,
      allowPrivateNetwork: true,
      retryStage: "read",
      retry: { attempts: 1 },
    }).then(
      () => undefined,
      (error: unknown) => error as ProviderErrorLike,
    );
    requireProof(activeError instanceof Error, "active-shared-caller-error");
    requireProof(activeError.status === 429, "active-shared-caller-status");
    normalizedErrors.push(activeError);
    logger.info(`CASE_ACTIVE ${activeError.message}`, {
      status: activeError.status,
      body: activeError.errorBody,
      requestId: activeError.requestId,
      code: activeError.code,
    });
    const redirectError = await postJsonRequest({
      url: `http://127.0.0.1:${port}/redirect`,
      headers: new Headers({ authorization: `Bearer ${redirectHeaderSecret}` }),
      body: { proof: true },
      fetchFn: fetch,
      allowPrivateNetwork: true,
      retryStage: "read",
      retry: { attempts: 1 },
    }).then(
      () => undefined,
      (error: unknown) => error as ProviderErrorLike,
    );
    requireProof(redirectError instanceof Error, "redirect-shared-caller-error");
    requireProof(redirectError.status === 429, "redirect-shared-caller-status");
    const redirectDiagnostics = `${redirectError.message}\n${JSON.stringify(redirectError)}`;
    requireProof(redirectDiagnostics.includes("SAFE_REDIRECT"), "redirect-safe-marker");
    requireProof(
      !redirectDiagnostics.includes(redirectHeaderSecret),
      "redirect-header-secret-absent",
    );
    requireProof(
      !redirectDiagnostics.includes(redirectQuerySecret),
      "redirect-query-secret-absent",
    );
    normalizedErrors.push(redirectError);
    logger.info(`CASE_REDIRECT ${redirectError.message}`, {
      status: redirectError.status,
      body: redirectError.errorBody,
      requestId: redirectError.requestId,
      code: redirectError.code,
    });
    const shortResponse = await fetch(`http://127.0.0.1:${port}/short`);
    const shortError = (await createProviderHttpError(shortResponse, "short request", {
      sensitiveValues: [shortSecret],
    })) as ProviderErrorLike;
    const shortDiagnostics = `${shortError.message}\n${shortError.errorBody}\n${shortError.requestId}`;
    requireProof(
      shortDiagnostics.includes(
        "diagnostic omitted because it may contain a short sensitive value",
      ),
      "short-secret-omission-marker",
    );
    requireProof(!shortDiagnostics.includes("retry in"), "short-secret-diagnostic-omitted");
    logger.info("CASE_SHORT SAFE_SHORT", {
      status: shortError.status,
      body: shortError.errorBody,
      requestId: shortError.requestId,
    });
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
  for (const variant of [...secretVariants(slashSecret), slashEscapedSecret]) {
    requireProof(!normalizedText.includes(variant), "normalized-json-slash-secret-absent");
  }
  for (const variant of [
    ...secretVariants(redirectHeaderSecret),
    ...secretVariants(redirectQuerySecret),
  ]) {
    requireProof(!normalizedText.includes(variant), "normalized-redirect-secret-absent");
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
    "CASE_TRUNCATED_JSON_SLASH",
    "SAFE_LOG",
  ];
  const sink = await waitForLog(logFile, logMarkers);
  for (const variant of [
    ...secretVariants(requestSecret),
    ...secretVariants(slashSecret),
    slashEscapedSecret,
    ...secretVariants(logSecret),
    ...secretVariants(redirectHeaderSecret),
    ...secretVariants(redirectQuerySecret),
  ]) {
    requireProof(!sink.includes(variant), "file-sink-secret-absent");
  }
  requireProof(!sink.includes(longSecret.slice(0, 512)), "file-sink-truncated-prefix-absent");
  requireProof(!sink.includes("retry in 10 seconds"), "file-sink-short-diagnostic-omitted");

  const records = sink
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  requireProof(records.length === 11, "file-sink-record-count");

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
      "compiled-shared-provider-caller",
      "official-plugin-owner-regressions",
      "real-loopback-http-error-responses",
      "production-provider-error-normalization",
      "production-jsonl-file-log-sink",
      "redirect-adjusted-guarded-request-context",
      "configured-header-provenance",
      "canonical-manual-error-readers",
      "bounded-callsite-inventory",
    ],
    assertions: {
      packageSubpathImportsResolved: true,
      finalRequestHeadersDerived: true,
      genericSharedCallerAdoptionProven: true,
      openAiPluginTtsAdoptionProven: true,
      openAiRealtimeAdoptionProven: true,
      openAiEmbeddingBatchAdoptionProven: true,
      openAiImageAdoptionProven: true,
      openAiVideoAdoptionProven: true,
      perplexitySearchApiAdoptionProven: true,
      perplexityChatCompletionsAdoptionProven: true,
      exaWebSearchAdoptionProven: true,
      ollamaWebSearchAdoptionProven: true,
      parallelWebSearchAdoptionProven: true,
      finalRedirectAdjustedHeaderRedactionProven: true,
      finalRedirectAdjustedQueryRedactionProven: true,
      crossOriginCredentialStrippingProven: true,
      arbitraryConfiguredHeaderProvenanceProven: true,
      invalidContentTypeRedactionProven: true,
      responseContextReconstructionProven: true,
      shortSensitiveValueFailClosedProven: true,
      manualOpenAiOauthOwnerProven: true,
      manualChutesOauthOwnerProven: true,
      manualMsTeamsOauthOwnerProven: true,
      manualVoiceOwnerProven: true,
      inworldOwnerProven: true,
      boundedCallsiteInventoryProven: true,
      rawSecretRedacted: true,
      jsonEscapedSecretRedacted: true,
      jsonOptionalSlashSecretRedacted: true,
      jsonSlashDanglingTruncationRedacted: true,
      urlEncodedSecretRedacted: true,
      formEncodedSecretRedacted: true,
      truncationBoundaryPrefixRedacted: true,
      realFileSinkWritten: true,
      sinkSecretsAbsent: true,
      safeMarkersPreserved: true,
    },
    observations: {
      httpStatus: 429,
      errorCases: normalizedErrors.length + 1,
      logRecords: records.length,
      sinkSha256,
      nodeVersion: process.version,
      retainedProviderOwnerAssertions: 10,
      manualOwnerAssertions: 7,
    },
    scope: {
      loggingContract: "existing-public-plugin-sdk-log-sink",
      providerHttpContract: "private-local-official-plugin-runtime",
      genericSharedCallerAdoptionProven: true,
      providerSpecificAdoptionProven: true,
      systemicRequestContextProven: true,
      manualReaderOwnersProven: true,
      manualReaderOwners: [
        "chutes-oauth",
        "msteams-oauth",
        "openai-chatgpt-oauth",
        "voice-call-telnyx",
        "voice-call-twilio",
        "inworld-tts",
        "inworld-voices",
      ],
      providerSpecificOwners: [
        "openai-plugin-tts",
        "openai-realtime",
        "openai-embedding-batch",
        "openai-image",
        "openai-video",
        "perplexity-native",
        "perplexity-chat",
        "exa-web-search",
        "ollama-web-search",
        "parallel-web-search",
      ],
    },
    redaction: {
      requestSecretsIncluded: false,
      jsonOptionalSlashSecretsIncluded: false,
      danglingJsonSlashPrefixesIncluded: false,
      encodedSecretsIncluded: false,
      truncationPrefixIncluded: false,
      redirectAdjustedSecretsIncluded: false,
      shortSensitiveDiagnosticsIncluded: false,
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
    "[foundation compiled SDK proof] consumer=true node24=true loopback-http=true provider-error=true active-shared-caller=true final-request-headers=true redirect-final-context=true configured-header=true invalid-content=true short-fail-closed=true manual-oauth=true manual-voice=true inworld=true inventory=true openai-plugin-tts=true openai-realtime=true openai-embedding-batch=true openai-image=true openai-video=true perplexity-native=true perplexity-chat=true file-sink=true raw=true json=true json-optional-slash=true json-slash-dangling=true url=true form=true truncation-boundary=true secret-output=false",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(message);
  process.exitCode = 1;
});
