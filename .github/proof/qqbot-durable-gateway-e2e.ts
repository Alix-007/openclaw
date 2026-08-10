import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const PROOF_MARKER = "[qqbot durable gateway real-behavior proof]";
const targetRoot = process.cwd();
const targetRequire = createRequire(path.join(targetRoot, "package.json"));
const { WebSocketServer } = targetRequire("ws") as typeof import("ws");
const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA?.trim() ?? "";
const visibleInputMarker = "QQBOT-DURABLE-INPUT-VISIBLE";
const visibleOutputMarker = "QQBOT-DURABLE-OUTPUT-VISIBLE";
const messageId = "proof-c2c-message";
const deliveryId = "proof-c2c-delivery";
const userId = "proof-c2c-user";

if (!/^[0-9a-f]{40}$/u.test(targetSha)) {
  throw new Error("OPENCLAW_PROOF_HEAD_SHA must be a full Git SHA");
}

function createCredentialFixture() {
  const token = `qq-proof-${randomBytes(24).toString("base64url")}/exact+secret`;
  const encoded = encodeURIComponent(token);
  const form = new URLSearchParams({ credential: token }).toString().slice("credential=".length);
  const lowerEncoded = encoded.replace(/%[0-9A-F]{2}/gu, (part) => part.toLowerCase());
  const lowerForm = form.replace(/%[0-9A-F]{2}/gu, (part) => part.toLowerCase());
  return {
    token,
    reflected: { raw: token, encoded: lowerEncoded, form: lowerForm },
    forbidden: [...new Set([token, encoded, form, lowerEncoded, lowerForm])],
  };
}

const credential = createCredentialFixture();

function redactForOutput(value: unknown): string {
  let text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  for (const forbidden of credential.forbidden.toSorted((a, b) => b.length - a.length)) {
    text = text.split(forbidden).join("<redacted>");
  }
  return text;
}

function credentialsAbsent(text: string): boolean {
  return credential.forbidden.every((forbidden) => !text.includes(forbidden));
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("loopback server did not expose a TCP port");
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readRequestBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(res: import("node:http").ServerResponse, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(200, {
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json",
  });
  res.end(body);
}

async function waitFor<T>(
  read: () => Promise<T | null> | T | null,
  label: string,
  timeoutMs = 60_000,
  pollIntervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`${label} did not settle within ${timeoutMs}ms`);
}

type IngressRow = {
  queue_name: string;
  event_id: string;
  channel_id: string;
  account_id: string;
  lane_key: string | null;
  status: string;
  payload_json: string;
  attempts: number;
  completed_at: number | null;
};

async function readIngressRow(databasePath: string, eventId: string): Promise<IngressRow | null> {
  try {
    await fs.access(databasePath);
  } catch {
    return null;
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (
      (database
        .prepare(
          `SELECT queue_name, event_id, channel_id, account_id, lane_key, status,
                  payload_json, attempts, completed_at
             FROM channel_ingress_events
            WHERE channel_id = ? AND account_id = ? AND event_id = ?`,
        )
        .get("qqbot", "default", eventId) as IngressRow | undefined) ?? null
    );
  } finally {
    database.close();
  }
}

async function run(): Promise<void> {
  const qaApi = await import(pathToFileURL(path.join(targetRoot, "extensions/qa-lab/api.ts")).href);
  const ingressEnvelope = await import(
    pathToFileURL(path.join(targetRoot, "extensions/qqbot/src/engine/gateway/ingress-envelope.ts"))
      .href
  );

  const originalEnvelope = JSON.stringify({
    op: 0,
    id: deliveryId,
    s: 41,
    t: "C2C_MESSAGE_CREATE",
    d: {
      id: messageId,
      content:
        `${visibleInputMarker} raw=${credential.reflected.raw} ` +
        `encoded=${credential.reflected.encoded} form=${credential.reflected.form}. ` +
        `Reply exactly \`${visibleOutputMarker}\`.`,
      timestamp: "2026-08-10T12:00:00Z",
      author: { user_openid: userId },
    },
  });
  const originalFacts = ingressEnvelope.inspectQQBotIngressEnvelope(originalEnvelope);
  assert(originalFacts, "original envelope must be a QQBot turn");

  const outboundRequests: Array<{ path: string; body: string; authorization: string }> = [];
  let websocketClient: import("ws").WebSocket | null = null;
  let identifyPayload: Record<string, unknown> | null = null;
  let gateway: {
    baseUrl: string;
    tempRoot: string;
    stop: () => Promise<void>;
  } | null = null;
  let mock: { baseUrl: string; stop: () => Promise<void> } | null = null;

  const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    websocketServer.once("listening", () => resolve());
    websocketServer.once("error", reject);
  });
  const websocketAddress = websocketServer.address();
  if (!websocketAddress || typeof websocketAddress === "string") {
    throw new Error("QQBot proof WebSocket did not expose a TCP port");
  }
  const websocketUrl = `ws://127.0.0.1:${websocketAddress.port}`;

  websocketServer.on("connection", (socket) => {
    websocketClient = socket;
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 } }));
    socket.on("message", (raw) => {
      const rawText = Array.isArray(raw)
        ? Buffer.concat(raw).toString("utf8")
        : Buffer.from(raw).toString("utf8");
      const payload = JSON.parse(rawText) as { op?: number; d?: Record<string, unknown> };
      if (payload.op === 1) {
        socket.send(JSON.stringify({ op: 11, d: null }));
        return;
      }
      if (payload.op !== 2) {
        return;
      }
      identifyPayload = payload.d ?? null;
      socket.send(JSON.stringify({ op: 0, s: 1, t: "READY", d: { session_id: "proof-session" } }));
      setTimeout(() => socket.send(originalEnvelope), 25);
    });
  });

  const qqApiServer = createServer((req, res) => {
    void (async () => {
      const body = await readRequestBody(req);
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/app/getAppAccessToken") {
        writeJson(res, { access_token: credential.token, expires_in: 7200 });
        return;
      }
      if (requestUrl.pathname === "/gateway") {
        writeJson(res, { url: websocketUrl });
        return;
      }
      if (requestUrl.pathname.startsWith(`/v2/users/${userId}/messages`)) {
        outboundRequests.push({
          path: requestUrl.pathname,
          body,
          authorization: req.headers.authorization ?? "",
        });
        writeJson(res, {
          id: `proof-outbound-${outboundRequests.length}`,
          timestamp: Date.now(),
          ext_info: { ref_idx: `proof-ref-${outboundRequests.length}` },
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"proof route not found"}');
    })().catch(() => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"proof handler failed"}');
    });
  });
  const qqApiPort = await listen(qqApiServer);
  const qqApiBaseUrl = `http://127.0.0.1:${qqApiPort}`;

  try {
    mock = await qaApi.startQaMockOpenAiServer();
    const preloadPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "qqbot-fetch-loopback-preload.mjs",
    );
    gateway = await qaApi.startQaGatewayChild({
      repoRoot: targetRoot,
      useRepoCli: true,
      providerBaseUrl: `${mock.baseUrl}/v1`,
      providerMode: "mock-openai",
      transportBaseUrl: qqApiBaseUrl,
      controlUiEnabled: false,
      enabledPluginIds: ["qqbot"],
      runtimeEnvPatch: {
        NODE_OPTIONS: `--import=${preloadPath}`,
        OPENCLAW_QQBOT_PROOF_HTTP_BASE: qqApiBaseUrl,
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
        NO_PROXY: "*",
        no_proxy: "*",
      },
      mutateConfig: (cfg) => ({
        ...cfg,
        channels: {
          ...cfg.channels,
          qqbot: {
            enabled: true,
            appId: "proof-app",
            clientSecret: "proof-client-secret-not-live",
            dmPolicy: "open",
            allowFrom: ["*"],
            markdownSupport: false,
            streaming: { mode: "off", nativeTransport: false },
          },
        },
      }),
    });

    const identify = await waitFor(() => identifyPayload, "QQBot IDENTIFY");
    // OPENCLAW_STATE_DIR is <tempRoot>/state; the shared DB owns its own state/ child.
    const databasePath = path.join(gateway.tempRoot, "state", "state", "openclaw.sqlite");
    const ingressBeforeAdoption = await waitFor(
      async () => {
        const row = await readIngressRow(databasePath, originalFacts.eventId);
        return row &&
          (row.status === "pending" || row.status === "claimed") &&
          row.payload_json !== "null"
          ? row
          : null;
      },
      "durable ingress payload before adoption",
      60_000,
      5,
    );
    const storedPayload = JSON.parse(ingressBeforeAdoption.payload_json) as {
      rawEnvelope?: unknown;
    };
    if (typeof storedPayload.rawEnvelope !== "string") {
      throw new Error("durable ingress payload omitted rawEnvelope");
    }
    const storedEnvelope = storedPayload.rawEnvelope;
    const storedFacts = ingressEnvelope.inspectQQBotIngressEnvelope(storedEnvelope);
    assert(storedFacts, "stored envelope must remain a QQBot turn");

    const finalOutbound = await waitFor(
      () => outboundRequests.find((request) => request.body.includes(visibleOutputMarker)) ?? null,
      "QQBot visible outbound",
      90_000,
    );
    const ingressTombstone = await waitFor(async () => {
      const row = await readIngressRow(databasePath, originalFacts.eventId);
      return row?.status === "completed" && row.completed_at !== null ? row : null;
    }, "completed durable ingress row");
    assert.equal(ingressTombstone.payload_json, "null", "completed tombstone must clear payload");

    const providerRequestsBeforeDuplicate = (await (
      await fetch(`${mock.baseUrl}/debug/requests`)
    ).json()) as Array<{ allInputText?: unknown; prompt?: unknown }>;
    const providerRequest = providerRequestsBeforeDuplicate.find((request) => {
      const text = `${optionalString(request.allInputText)}\n${optionalString(request.prompt)}`;
      return text.includes(visibleInputMarker);
    });
    assert(providerRequest, "mock provider must observe the QQBot turn");
    const agentVisibleText = `${optionalString(providerRequest.allInputText)}\n${optionalString(
      providerRequest.prompt,
    )}`;
    const providerVisibleCountBeforeDuplicate = providerRequestsBeforeDuplicate.filter((request) =>
      `${optionalString(request.allInputText)}\n${optionalString(request.prompt)}`.includes(
        visibleInputMarker,
      ),
    ).length;
    const visibleOutboundCountBeforeDuplicate = outboundRequests.filter((request) =>
      request.body.includes(visibleOutputMarker),
    ).length;

    assert(websocketClient, "QQBot WebSocket client must remain connected for duplicate proof");
    websocketClient.send(originalEnvelope);
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const ingressAfterDuplicate = await readIngressRow(databasePath, originalFacts.eventId);
    assert(ingressAfterDuplicate, "durable ingress tombstone disappeared after duplicate DISPATCH");
    const providerRequestsAfterDuplicate = (await (
      await fetch(`${mock.baseUrl}/debug/requests`)
    ).json()) as Array<{ allInputText?: unknown; prompt?: unknown }>;
    const providerVisibleCountAfterDuplicate = providerRequestsAfterDuplicate.filter((request) =>
      `${optionalString(request.allInputText)}\n${optionalString(request.prompt)}`.includes(
        visibleInputMarker,
      ),
    ).length;
    const visibleOutboundCountAfterDuplicate = outboundRequests.filter((request) =>
      request.body.includes(visibleOutputMarker),
    ).length;
    const allOutboundText = outboundRequests.map((request) => request.body).join("\n");
    const identifyToken = identify.token;
    const healthResponse = await fetch(`${gateway.baseUrl}/healthz`, { method: "HEAD" });
    const readyResponse = await fetch(`${gateway.baseUrl}/readyz`, { method: "HEAD" });

    const beforeIdentity = {
      eventId: originalFacts.eventId,
      eventType: originalFacts.eventType,
      laneKey: originalFacts.laneKey,
      deliveryId: originalFacts.payload.id,
      sequence: originalFacts.payload.s,
    };
    const afterIdentity = {
      eventId: storedFacts.eventId,
      eventType: storedFacts.eventType,
      laneKey: storedFacts.laneKey,
      deliveryId: storedFacts.payload.id,
      sequence: storedFacts.payload.s,
    };
    const verdict = {
      schema: "openclaw.qqbot.durable-gateway-real-behavior-proof/v1",
      exactHead: targetSha,
      productionBoundaries: {
        actualLoopbackWebSocket: websocketClient !== null,
        gatewayConnectionIdentify: identifyToken === `QQBot ${credential.token}`,
        sqliteEnqueueClaimDispatch:
          (ingressBeforeAdoption.status === "pending" ||
            ingressBeforeAdoption.status === "claimed") &&
          ingressTombstone.status === "completed" &&
          ingressTombstone.attempts >= 1 &&
          ingressTombstone.completed_at !== null &&
          ingressTombstone.payload_json === "null",
        duplicateCompletedIgnored:
          ingressAfterDuplicate.status === "completed" &&
          ingressAfterDuplicate.completed_at === ingressTombstone.completed_at &&
          ingressAfterDuplicate.attempts === ingressTombstone.attempts &&
          providerVisibleCountAfterDuplicate === providerVisibleCountBeforeDuplicate &&
          visibleOutboundCountAfterDuplicate === visibleOutboundCountBeforeDuplicate,
        buildAgentBodyProviderVisible: agentVisibleText.includes(visibleInputMarker),
        visibleOutboundTurn: finalOutbound.body.includes(visibleOutputMarker),
        gatewayHealth: healthResponse.ok,
        gatewayReady: readyResponse.ok,
      },
      identityBefore: beforeIdentity,
      identityAfter: afterIdentity,
      identityUnchanged: JSON.stringify(beforeIdentity) === JSON.stringify(afterIdentity),
      ingressLifecycle: {
        beforeAdoptionStatus: ingressBeforeAdoption.status,
        completedStatus: ingressTombstone.status,
        completedPayloadCleared: ingressTombstone.payload_json === "null",
        duplicateProviderDispatches: providerVisibleCountAfterDuplicate,
        duplicateVisibleOutboundTurns: visibleOutboundCountAfterDuplicate,
      },
      durable: {
        visibleMarker: storedEnvelope.includes(visibleInputMarker),
        redactionMarker: storedEnvelope.includes("<redacted>"),
        rawEncodedFormAbsent: credentialsAbsent(storedEnvelope),
      },
      agentVisible: {
        visibleMarker: agentVisibleText.includes(visibleInputMarker),
        redactionMarker: agentVisibleText.includes("<redacted>"),
        rawEncodedFormAbsent: credentialsAbsent(agentVisibleText),
      },
      output: {
        visibleMarker: allOutboundText.includes(visibleOutputMarker),
        rawEncodedFormAbsent: credentialsAbsent(allOutboundText),
        secretOutput: !credentialsAbsent(allOutboundText),
      },
    };
    const requiredBooleans = [
      ...Object.values(verdict.productionBoundaries),
      verdict.identityUnchanged,
      ...Object.values(verdict.durable),
      ...Object.values(verdict.agentVisible),
      verdict.output.visibleMarker,
      verdict.output.rawEncodedFormAbsent,
      !verdict.output.secretOutput,
    ];
    assert(requiredBooleans.every(Boolean), "production-boundary verdict contains a false gate");

    await fs.writeFile(
      path.join(targetRoot, "proof-qqbot-durable-verdict.json"),
      `${JSON.stringify(verdict, null, 2)}\n`,
      "utf8",
    );
    console.info(`${PROOF_MARKER} ${JSON.stringify(verdict)}`);
  } finally {
    await gateway?.stop().catch(() => undefined);
    await mock?.stop().catch(() => undefined);
    websocketClient?.close();
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    await closeServer(qqApiServer);
  }
}

run().catch((error: unknown) => {
  console.error(`[qqbot durable gateway proof] FAILED: ${redactForOutput(error)}`);
  process.exitCode = 1;
});
