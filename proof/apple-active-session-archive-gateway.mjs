// Synthetic loopback Gateway for the Alix iOS active-session archive proof.
// It exposes one running main session and one running non-main session. The
// proof test only opens their context menus; no session mutation is accepted.
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const createdAt = Date.now();
const requests = [];
const mutationAttempts = [];
const sessions = [
  {
    key: "agent:main:active-archive-proof",
    kind: "direct",
    displayName: "Active archive proof",
    label: "Active archive proof",
    sessionId: "archive-proof-active-session",
    hasActiveRun: true,
    activeRunIds: ["archive-proof-active-run"],
    status: "running",
    updatedAt: createdAt,
    modelProvider: "openai",
    model: "gpt-5.6-sol",
    contextTokens: 200_000,
    totalTokens: 1_024,
    totalTokensFresh: true,
  },
  {
    key: "agent:main:main",
    kind: "direct",
    displayName: "Main archive control",
    label: "Main archive control",
    sessionId: "archive-proof-main-session",
    hasActiveRun: true,
    activeRunIds: ["archive-proof-main-run"],
    status: "running",
    updatedAt: createdAt - 1_000,
    modelProvider: "openai",
    model: "gpt-5.6-sol",
    contextTokens: 200_000,
    totalTokens: 512,
    totalTokensFresh: true,
  },
];
const methods = [
  "health",
  "config.get",
  "agents.list",
  "sessions.list",
  "chat.history",
  "voicewake.get",
  "cron.list",
  "cron.status",
  "system-presence",
  "node.list",
  "sessions.subscribe",
  "sessions.unsubscribe",
  "session.status",
  "models.list",
  "sessions.preview",
  "sessions.patch",
];

const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({
      ok: true,
      connections: webSockets.clients.size,
      requests,
      mutationAttempts,
    }),
  );
});
const webSockets = new WebSocketServer({ server });

function sessionForKey(key) {
  return sessions.find((session) => session.key === key) ?? sessions[1];
}

webSockets.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "synthetic-archive-proof-nonce", ts: Date.now() },
    }),
  );

  socket.on("message", (raw) => {
    const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
    const request = JSON.parse(bytes.toString("utf8"));
    if (request.type !== "req") {
      return;
    }

    const params = request.params ?? {};
    const observed = {
      method: request.method,
      role: params.role,
      sessionKey: params.sessionKey ?? params.key,
      offset: params.offset,
      limit: params.limit,
    };
    requests.push(observed);
    console.log(JSON.stringify(observed));

    const reply = (payload) =>
      socket.send(JSON.stringify({ type: "res", id: request.id, ok: true, payload }));
    const fail = (message) =>
      socket.send(
        JSON.stringify({
          type: "res",
          id: request.id,
          ok: false,
          error: { code: "INVALID_REQUEST", message },
        }),
      );

    switch (request.method) {
      case "connect":
        socket.proofRole = params.role;
        reply({
          type: "hello-ok",
          protocol: 3,
          server: { version: "archive-proof", connId: `synthetic-${params.role ?? "client"}` },
          features: { methods, events: ["tick"] },
          snapshot: {
            presence: [],
            health: { ok: true },
            stateVersion: { presence: 1, health: 1 },
            uptimeMs: 1_000,
            sessionDefaults: {
              defaultAgentId: "main",
              mainKey: "main",
              mainSessionKey: "agent:main:main",
              scope: "per-sender",
            },
          },
          auth: {
            role: params.role,
            scopes: params.scopes ?? [],
            deviceToken: `synthetic-${params.role ?? "client"}`,
          },
          policy: { maxPayload: 1_048_576, maxBufferedBytes: 1_048_576, tickIntervalMs: 30_000 },
        });
        break;
      case "health":
        reply({
          ok: true,
          ts: Date.now(),
          durationMs: 1,
          channels: {},
          agents: [],
          sessions: { count: 2 },
        });
        break;
      case "config.get":
        reply({
          config: {
            agents: { defaults: { model: { primary: "openai/gpt-5.6-sol" } } },
            gateway: { mode: "local" },
          },
          hash: "synthetic-archive-proof",
          valid: true,
        });
        break;
      case "agents.list":
        reply({
          defaultId: "main",
          mainKey: "main",
          scope: "per-sender",
          agents: [{ id: "main", name: "Archive proof" }],
        });
        break;
      case "sessions.list": {
        const offset = params.offset ?? 0;
        const rows = sessions.slice(offset, offset + (params.limit ?? 200));
        reply({
          ts: Date.now(),
          count: rows.length,
          totalCount: sessions.length,
          offset,
          nextOffset: null,
          hasMore: false,
          defaults: {
            mainSessionKey: "agent:main:main",
            modelProvider: "openai",
            model: "gpt-5.6-sol",
            contextTokens: 200_000,
          },
          sessions: rows,
        });
        break;
      }
      case "chat.history": {
        const session = sessionForKey(params.sessionKey);
        reply({
          sessionKey: session.key,
          sessionId: session.sessionId,
          messages: [],
          sessionInfo: {
            hasActiveRun: session.hasActiveRun,
            activeRunIds: session.activeRunIds,
          },
        });
        break;
      }
      case "voicewake.get":
        reply({ triggers: [] });
        break;
      case "cron.list":
        reply({ jobs: [] });
        break;
      case "cron.status":
        reply({ enabled: true, jobs: 0 });
        break;
      case "system-presence":
        reply([]);
        break;
      case "node.list":
        reply({ nodes: [] });
        break;
      case "sessions.subscribe":
      case "sessions.unsubscribe":
        reply({ ok: true });
        break;
      case "session.status": {
        const session = sessionForKey(params.sessionKey ?? params.key);
        reply({
          key: session.key,
          status: session.status,
          hasActiveRun: session.hasActiveRun,
          activeRunIds: session.activeRunIds,
        });
        break;
      }
      case "models.list":
        reply({
          models: [{ id: "gpt-5.6-sol", provider: "openai", name: "GPT-5.6 Sol", available: true }],
        });
        break;
      case "sessions.preview":
        reply({ ts: Date.now(), previews: [] });
        break;
      case "sessions.patch":
        mutationAttempts.push(params);
        fail("Archive proof is read-only; session mutation is disabled");
        break;
      default:
        fail(`Unsupported synthetic method: ${request.method}`);
    }
  });
});

const tick = setInterval(() => {
  for (const socket of webSockets.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "event", event: "tick", payload: { ts: Date.now() } }));
    }
  }
}, 10_000);

function close() {
  clearInterval(tick);
  for (const socket of webSockets.clients) {
    socket.terminate();
  }
  webSockets.close();
  server.close();
}

server.listen(19_876, "127.0.0.1", () => {
  console.log("Synthetic archive proof Gateway listening on loopback:19876");
});
process.on("SIGINT", close);
process.on("SIGTERM", close);
