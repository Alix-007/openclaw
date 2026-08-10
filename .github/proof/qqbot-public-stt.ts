import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { transcribeAudio } from "../../../extensions/qqbot/src/engine/utils/stt.js";

const PUBLIC_HOST_SUFFIX = ".trycloudflare.com";
const SAFE_MARKER = "public-stt-visible-429";
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

interface FixtureObservation {
  authorizationExact: boolean;
  cloudflareIngress: boolean;
  filePartPresent: boolean;
  methodAndPathExact: boolean;
  modelPartPresent: boolean;
  multipart: boolean;
}

function assertProof(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function lowercasePercentEscapes(value: string): string {
  return value.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
}

function percentEncodeEveryUtf8Byte(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => `%${byte.toString(16).padStart(2, "0")}`,
  ).join("");
}

function mixedPercentEncode(value: string): string {
  return Array.from(value, (character, index) =>
    index % 2 === 0 ? percentEncodeEveryUtf8Byte(character) : character,
  ).join("");
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    assertProof(size <= MAX_REQUEST_BYTES, "fixture request exceeded its proof bound");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function startFixture(params: {
  apiKey: string;
  reflectedForms: readonly string[];
}): Promise<{
  origin: string;
  observations: FixtureObservation[];
  close: () => Promise<void>;
}> {
  const observations: FixtureObservation[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const cloudflareIngress =
        typeof request.headers["cf-ray"] === "string" && request.headers["cf-ray"].length > 0;
      if (request.url === "/health") {
        response.writeHead(cloudflareIngress ? 204 : 412);
        response.end();
        return;
      }

      const body = await readRequestBody(request);
      const contentType = request.headers["content-type"] ?? "";
      const bodyText = body.toString("latin1");
      const observation: FixtureObservation = {
        authorizationExact: request.headers.authorization === `Bearer ${params.apiKey}`,
        cloudflareIngress,
        filePartPresent:
          bodyText.includes('name="file"') && bodyText.includes('filename="proof.wav"'),
        methodAndPathExact: request.method === "POST" && request.url === "/audio/transcriptions",
        modelPartPresent: bodyText.includes('name="model"') && bodyText.includes("proof-stt-model"),
        multipart: /^multipart\/form-data;\s*boundary=/i.test(contentType),
      };
      observations.push(observation);

      if (!Object.values(observation).every(Boolean)) {
        writeJson(response, 400, { error: "fixture request contract mismatch" });
        return;
      }

      writeJson(response, 429, {
        error: {
          message: `${SAFE_MARKER}; ${params.reflectedForms.join("; ")}`,
        },
        request_id: "public-stt-fixture-request",
      });
    })().catch(() => {
      if (!response.headersSent) {
        writeJson(response, 500, { error: "fixture failure" });
      } else {
        response.destroy();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    observations,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function startQuickTunnel(
  binary: string,
  origin: string,
): Promise<{
  child: ChildProcess;
  publicUrl: string;
}> {
  const child = spawn(
    binary,
    ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", origin],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const publicUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("quick tunnel URL was not issued before the proof deadline"));
      }
    }, 60_000);
    timeout.unref?.();

    const inspect = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-64 * 1024);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!settled && match) {
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    child.stdout?.on("data", inspect);
    child.stderr?.on("data", inspect);
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`quick tunnel exited before startup (${code ?? signal ?? "unknown"})`));
      }
    });
  });
  return { child, publicUrl };
}

async function waitForPublicIngress(publicUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${publicUrl}/health`, {
        headers: { "user-agent": "openclaw-qqbot-proof" },
        signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel();
      if (response.status === 204) {
        return;
      }
    } catch {
      // Quick Tunnel DNS and edge routing can take a few seconds to converge.
    }
    await delay(1_000);
  }
  throw new Error("public tunnel did not reach the authenticated fixture");
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit").catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const exactHead = process.env.OPENCLAW_PROOF_HEAD_SHA ?? "";
  const cloudflared = process.env.CLOUDFLARED_BIN ?? "";
  assertProof(/^[0-9a-f]{40}$/.test(exactHead), "exact proof head must be a full Git SHA");
  assertProof(cloudflared.length > 0, "CLOUDFLARED_BIN is required");

  const secretPrefix = "qQPublicSttP";
  const secretSuffix = "sSfQ";
  const distinctiveFragment = randomBytes(18).toString("base64url");
  const apiKey = `${secretPrefix}/${distinctiveFragment}~mix+proof=${secretSuffix}`;
  const encoded = encodeURIComponent(apiKey);
  const fullyEncoded = percentEncodeEveryUtf8Byte(apiKey);
  const formEncoded = new URLSearchParams([["echo", apiKey]]).toString().slice("echo=".length);
  const lowercaseEncoded = lowercasePercentEscapes(encoded);
  const lowercaseFormEncoded = lowercasePercentEscapes(formEncoded);
  const mixedPercent = lowercasePercentEscapes(mixedPercentEncode(apiKey));
  const slashEscaped = apiKey.replaceAll("/", "\\/");
  const reflectedForms = [
    `raw=${apiKey}`,
    `encoded=${lowercaseEncoded}`,
    `fully-encoded=${fullyEncoded}`,
    `form=${lowercaseFormEncoded}`,
    `mixed=${mixedPercent}`,
    `json-slash=${slashEscaped}`,
    `authorization=Bearer ${apiKey}`,
  ];
  const forbidden = [
    apiKey,
    encoded,
    fullyEncoded,
    formEncoded,
    lowercaseEncoded,
    lowercaseFormEncoded,
    mixedPercent,
    slashEscaped,
    secretPrefix,
    secretSuffix,
    distinctiveFragment,
  ];

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "openclaw-qqbot-public-stt-"));
  const audioPath = path.join(temporaryDirectory, "proof.wav");
  await writeFile(audioPath, Buffer.from("RIFF0000WAVEfmt proof-audio", "ascii"));

  let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
  let tunnel: Awaited<ReturnType<typeof startQuickTunnel>> | undefined;
  try {
    fixture = await startFixture({ apiKey, reflectedForms });
    tunnel = await startQuickTunnel(cloudflared, fixture.origin);
    const parsedPublicUrl = new URL(tunnel.publicUrl);
    assertProof(parsedPublicUrl.protocol === "https:", "quick tunnel did not issue a TLS URL");
    assertProof(
      parsedPublicUrl.hostname.endsWith(PUBLIC_HOST_SUFFIX),
      "quick tunnel host was outside the documented public suffix",
    );
    await waitForPublicIngress(tunnel.publicUrl);

    let visibleError = "";
    try {
      await transcribeAudio(audioPath, {
        channels: {
          qqbot: {
            stt: {
              apiKey,
              baseUrl: tunnel.publicUrl,
              model: "proof-stt-model",
            },
          },
        },
      });
    } catch (error) {
      visibleError = error instanceof Error ? error.message : String(error);
    }

    assertProof(visibleError.startsWith("STT failed (HTTP 429):"), "expected STT 429 error");
    const observation = fixture.observations.at(-1);
    assertProof(observation, "authenticated STT request did not reach the fixture");
    assertProof(Object.values(observation).every(Boolean), "STT request contract was incomplete");
    const absent = forbidden.every((value) => !visibleError.includes(value));
    assertProof(absent, "a synthetic credential form escaped the production boundary");
    assertProof(visibleError.includes(SAFE_MARKER), "safe provider marker was not retained");

    const verdict = {
      schema: "openclaw.qqbot.public-stt-proof/v1",
      exactHead,
      provider: "controlled-openai-compatible-stt-fixture",
      credentialMode: "synthetic-request-scoped-bearer",
      officialProviderClaim: false,
      network: {
        publicDns: true,
        tls: true,
        cloudflareIngress: observation.cloudflareIngress,
        directLoopbackRequest: false,
        hostClass: "random.trycloudflare.com",
      },
      request: {
        productionTranscribeAudio: true,
        productionSsrfGuard: true,
        authorizationExact: observation.authorizationExact,
        multipart: observation.multipart,
        methodAndPathExact: observation.methodAndPathExact,
        filePartPresent: observation.filePartPresent,
        modelPartPresent: observation.modelPartPresent,
      },
      response: {
        status: 429,
        safeMarkerPresent: visibleError.includes(SAFE_MARKER),
        rawAbsent: !visibleError.includes(apiKey),
        urlEncodedAbsent:
          !visibleError.includes(encoded) && !visibleError.includes(lowercaseEncoded),
        fullyEncodedAbsent: !visibleError.includes(fullyEncoded),
        formEncodedAbsent:
          !visibleError.includes(formEncoded) && !visibleError.includes(lowercaseFormEncoded),
        mixedPercentAbsent: !visibleError.includes(mixedPercent),
        jsonSlashEscapedAbsent: !visibleError.includes(slashEscaped),
        prefixAbsent: !visibleError.includes(secretPrefix),
        suffixAbsent: !visibleError.includes(secretSuffix),
        fragmentAbsent: !visibleError.includes(distinctiveFragment),
      },
      secretOutput: false,
      passed: true,
    };
    await writeFile("qqbot-public-stt-verdict.json", `${JSON.stringify(verdict, null, 2)}\n`);
    console.info(`[qqbot public-tls stt proof] ${JSON.stringify(verdict)}`);
  } finally {
    await stopChild(tunnel?.child);
    await fixture?.close().catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error("[qqbot public-tls stt proof] FAILED");
  process.exitCode = 1;
});
