import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const repo = process.argv[2];
const expectedSha = process.argv[3];
const artifactPath = process.argv[4];
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
if (sha !== expectedSha) throw new Error(`HEAD mismatch: ${sha}`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-auto-disabled-85229c8-"));
const stateDir = path.join(root, "state");
const configPath = path.join(root, "openclaw.json");
fs.mkdirSync(stateDir, { recursive: true });
const token = "cron-auto-disabled-proof-token";
const reservePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const address = socket.address();
    const port = typeof address === "object" && address ? address.port : 0;
    socket.close(error => error ? reject(error) : resolve(port));
  });
});
const port = await reservePort();
fs.writeFileSync(configPath, JSON.stringify({ gateway: { mode: "local", bind: "loopback", port, auth: { mode: "token", token }, controlUi: { enabled: false } } }, null, 2) + "\n");
Object.assign(process.env, {
  OPENCLAW_HOME: root,
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
  OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: "1",
  OPENCLAW_SKIP_CANVAS_HOST: "1",
  OPENCLAW_SKIP_CHANNELS: "1",
  OPENCLAW_SKIP_GMAIL_WATCHER: "1",
  OPENCLAW_SKIP_PROVIDERS: "1",
  OPENCLAW_TEST_MINIMAL_GATEWAY: "1",
  NO_COLOR: "1",
});
const [{ saveCronStore }, { startGatewayServer }, { callGateway }] = await Promise.all([
  import(path.join(repo, "src/cron/store.ts")),
  import(path.join(repo, "src/gateway/server.ts")),
  import(path.join(repo, "src/gateway/call.ts")),
]);
const now = Date.now();
const base = {
  enabled: false,
  createdAtMs: now - 60_000,
  updatedAtMs: now,
  schedule: { kind: "every", everyMs: 3_600_000 },
  sessionTarget: "isolated",
  wakeMode: "next-heartbeat",
  payload: { kind: "agentTurn", message: "proof must not execute" },
  delivery: { mode: "none" },
};
const auto = { ...base, id: "proof-auto-disabled", name: "proof auto disabled", state: { autoDisabled: { reason: "consecutive-failures", atMs: now - 30_000, consecutiveErrors: 10 } } };
const manual = { ...base, id: "proof-manual-paused", name: "proof manual paused", state: {} };
const storePath = path.join(stateDir, "cron", "jobs.json");
await saveCronStore(storePath, { version: 1, jobs: [auto, manual] });
let server;
let payload;
try {
  server = await startGatewayServer(port, { auth: { mode: "token", token }, bind: "loopback", controlUiEnabled: false, sidecarStartup: "defer" });
  await server.startupSettled;
  payload = await callGateway({ url: `ws://127.0.0.1:${port}`, token, method: "cron.list", params: { includeDisabled: true, compact: true }, scopes: ["operator.read"], timeoutMs: 20_000 });
} finally {
  await server?.close({ reason: "cron autoDisabled exact-head proof complete" });
}
const jobs = payload?.jobs;
if (!Array.isArray(jobs)) throw new Error("cron.list did not return jobs");
const autoRow = jobs.find(job => job?.id === auto.id);
const manualRow = jobs.find(job => job?.id === manual.id);
if (autoRow?.autoDisabled !== true) throw new Error(`auto-disabled row missing true: ${JSON.stringify(autoRow)}`);
if (Object.hasOwn(manualRow ?? {}, "autoDisabled")) throw new Error(`manual pause leaked autoDisabled: ${JSON.stringify(manualRow)}`);
if (autoRow?.enabled !== false || manualRow?.enabled !== false) throw new Error("disabled controls changed state");
if (autoRow?.nextRunAtMs !== null || manualRow?.nextRunAtMs !== null) throw new Error("disabled controls became scheduled");
const findSqlite = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const candidate = path.join(dir, entry.name);
  return entry.isDirectory() ? findSqlite(candidate) : entry.name === "openclaw.sqlite" ? [candidate] : [];
});
const sqliteFiles = findSqlite(root);
if (sqliteFiles.length !== 1) throw new Error(`expected one canonical SQLite DB: ${JSON.stringify(sqliteFiles)}`);
const dbPath = sqliteFiles[0];
const sqliteSha256 = crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex");
const readback = { auto: autoRow, manual: manualRow };
const readbackSha256 = crypto.createHash("sha256").update(JSON.stringify(readback)).digest("hex");
fs.rmSync(root, { recursive: true, force: true });
const receipt = {
  productHead: sha,
  node: process.version,
  sqlite: process.versions.sqlite,
  productionEntry: "saveCronStore -> startGatewayServer -> callGateway(cron.list)",
  request: { includeDisabled: true, compact: true },
  readback,
  assertions: {
    autoDisabledTrue: true,
    manualPauseOmitsAutoDisabled: true,
    bothDisabled: true,
    bothNextRunAtMsNull: true,
  },
  sqliteSha256,
  readbackSha256,
  cleanup: { gatewayClosed: true, runtimeRootRemoved: !fs.existsSync(root) },
};
fs.writeFileSync(artifactPath, JSON.stringify(receipt, null, 2) + "\n");
process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
