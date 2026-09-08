import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createWriteStream } from "node:fs";

const [root, sha, receipts, mode = "parent"] = process.argv.slice(2);
assert(root && /^[0-9a-f]{40}$/.test(sha ?? "") && receipts, "usage: node run-cron-runs-proof.mjs <built-source-root> <sha> <receipt-dir> [parent|product]");
assert(["parent", "product"].includes(mode));
const fixture = await mkdtemp(path.join(tmpdir(), "cron-runs-proof-"));
await mkdir(receipts, { recursive: true });
const env = { PATH: process.env.PATH, HOME: fixture, CI: "true", NO_COLOR: "1",
  OPENCLAW_STATE_DIR: path.join(fixture, "state"),
  OPENCLAW_CONFIG_PATH: path.join(fixture, "openclaw.json") };
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
// This public, ephemeral test value is not an account credential.
const token = "isolated-cron-runs-proof-only";
await writeFile(env.OPENCLAW_CONFIG_PATH, JSON.stringify({
  gateway: { mode: "local", bind: "loopback", port, auth: { mode: "token", token } },
  cron: { enabled: false }, plugins: { enabled: false },
}));
const cli = [path.join(root, "openclaw.mjs")];
const seed = path.join(path.dirname(fileURLToPath(import.meta.url)), "cron-runs-seed.mjs");
const transport = ["--url", `ws://127.0.0.1:${port}`, "--token", token];
const observations = [];
let gateway;
async function run(label, args, options = {}) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("error", reject);
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  if (!options.quiet) {
    await writeFile(path.join(receipts, `${label}.json`), JSON.stringify({
      argv: args.map((arg) => arg === token ? "<ephemeral-proof-token>" : arg), ...result,
    }, null, 2));
  }
  return result;
}
function json(result) { assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout); }
function page(result, summaries, total, offset) {
  const value = json(result);
  assert.deepEqual(value.entries.map((entry) => entry.summary), summaries);
  assert.equal(value.total, total); assert.equal(value.offset, offset);
  assert.equal(value.limit, 1);
  assert.equal(value.hasMore, offset + 1 < total);
  assert.equal(value.nextOffset, offset + 1 < total ? offset + 1 : null);
  return value;
}
async function rpc(label, params) {
  return run(label, [...cli, "gateway", "call", "cron.runs", "--params",
    JSON.stringify({ id: "cron-runs-proof-job", ...params }), "--json", ...transport]);
}
try {
  // Resolve the product checkout's tsx loader, not the proof directory's dependencies.
  const loader = path.join(root, "node_modules", "tsx", "dist", "loader.mjs");
  const before = json(await run("sqlite-before", ["--import", loader, seed, root]));
  gateway = spawn(process.execPath, [...cli, "gateway", "run", "--allow-unconfigured"],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  gateway.stdout.pipe(createWriteStream(path.join(receipts, "gateway.stdout")));
  gateway.stderr.pipe(createWriteStream(path.join(receipts, "gateway.stderr")));
  gateway.on("error", () => {});
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = await run("ready", [...cli, "gateway", "call", "health", "--json", ...transport], { quiet: true });
    if (probe.code === 0) { ready = true; break; }
    if (gateway.exitCode !== null) throw new Error("isolated Gateway exited before readiness");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(ready, "isolated Gateway never became ready");
  const base = [...cli, "cron", "runs", "cron-runs-proof-job", "--limit", "1", ...transport];
  page(await run("normal-control", base), ["newest success"], 4, 0);
  // Raw supported RPC proves the capability and filter-before-page independently
  // of the proposed CLI additions, including a nonempty second matching page.
  page(await rpc("rpc-filter-page-0", { status: "error", query: "proof-needle", limit: 1, offset: 0, sortDir: "asc" }), ["proof-needle oldest failure"], 2, 0);
  page(await rpc("rpc-filter-page-1", { status: "error", query: "proof-needle", limit: 1, offset: 1, sortDir: "asc" }), ["proof-needle newer failure"], 2, 1);
  page(await rpc("rpc-delivery", { deliveryStatus: "not-delivered", limit: 1 }), ["successful but undelivered"], 3, 0);
  const cases = [
    ["status", ["--status", "error"], ["proof-needle newer failure"], 2, 0],
    ["delivery", ["--delivery-status", "not-delivered"], ["successful but undelivered"], 3, 0],
    ["query", ["--query", "proof-needle"], ["proof-needle newer failure"], 2, 0],
    ["offset", ["--offset", "1"], ["successful but undelivered"], 4, 1],
    ["sort", ["--sort", "asc"], ["proof-needle oldest failure"], 4, 0],
    ["combined-page-1", ["--status", "error", "--query", "proof-needle", "--sort", "asc", "--offset", "1"], ["proof-needle newer failure"], 2, 1],
  ];
  for (const [label, flags, summaries, total, offset] of cases) {
    const result = await run(`cli-${label}`, [...base, ...flags]);
    if (mode === "parent") {
      assert.notEqual(result.code, 0);
      const rejection = JSON.parse(result.stdout);
      assert.equal(rejection.ok, false);
      assert.equal(rejection.error.type, "cli_error");
      assert.equal(rejection.error.message,
        `OpenClaw does not recognize option "${flags[0]}".\nTry: openclaw cron runs --help`);
      observations.push(`${label}: parent CLI rejects a Gateway-supported query`);
    } else { page(result, summaries, total, offset); }
  }
  const after = json(await run("sqlite-after", ["--import", loader, seed, root, "readback"]));
  assert.deepEqual(after, before, "read-only query proof changed canonical task records");
  await writeFile(path.join(receipts, "SUMMARY.json"), JSON.stringify({ sha, mode,
    realGateway: true, canonicalRows: 4, controlsPassed: true, observations }, null, 2));
  console.log(`[cron-runs-proof] ${mode} expectations passed`);
} catch (error) {
  console.error(error);
  console.error("[cron-runs-proof] FAILED (exit 1)");
  process.exitCode = 1;
} finally {
  if (gateway && gateway.exitCode === null) {
    gateway.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => gateway.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (gateway.exitCode === null) gateway.kill("SIGKILL");
  }
  // The fresh runner discards fixture/config/DB; only the explicit receipts upload.
}
