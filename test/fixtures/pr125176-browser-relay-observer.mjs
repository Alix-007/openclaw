import fs from "node:fs";
import { registerHooks } from "node:module";
import WebSocket, { WebSocketServer } from "ws";

const outputPath = process.env.OPENCLAW_PR125176_OBSERVER_LOG;
const directServers = new WeakSet();
const directSockets = new WeakSet();

function record(event, detail = {}) {
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(
    outputPath,
    `${JSON.stringify({ event, atNs: process.hrtime.bigint().toString(), ...detail })}\n`,
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (
      specifier.endsWith("/register.runtime.js") ||
      resolved.url.endsWith("/browser/register.runtime.js")
    ) {
      record("browser.runtime.resolve", { module: "browser/register.runtime.js" });
    }
    return resolved;
  },
});

const handleUpgrade = WebSocketServer.prototype.handleUpgrade;
WebSocketServer.prototype.handleUpgrade = function (request, socket, head, callback) {
  const direct = new URL(request.url ?? "/", "http://127.0.0.1").pathname === "/browser/extension";
  if (direct) {
    directServers.add(this);
    record("direct.handleUpgrade");
  }
  return handleUpgrade.call(this, request, socket, head, (webSocket, upgradedRequest) => {
    if (direct) {
      directSockets.add(webSocket);
    }
    callback(webSocket, upgradedRequest);
  });
};

const terminate = WebSocket.prototype.terminate;
WebSocket.prototype.terminate = function () {
  if (directSockets.has(this)) {
    record("direct.socket.terminate");
  }
  return terminate.call(this);
};

const closeServer = WebSocketServer.prototype.close;
WebSocketServer.prototype.close = function (callback) {
  if (directServers.has(this)) {
    record("direct.server.close");
  }
  return closeServer.call(this, callback);
};
