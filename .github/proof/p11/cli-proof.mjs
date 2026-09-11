import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const [expectedSha, phase, artifactPath] = process.argv.slice(2);
assert.ok(phase === "baseline" || phase === "product");
const repo = process.cwd();
const productSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(productSha, expectedSha);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p11-fleet-status-"));
const stateDir = path.join(temporaryRoot, "state");
const emptyPath = path.join(temporaryRoot, "empty-path");
fs.mkdirSync(emptyPath);
Object.assign(process.env, {
  OPENCLAW_HOME: temporaryRoot,
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: path.join(temporaryRoot, "openclaw.json"),
  NO_COLOR: "1",
});
const { reserveFleetCell, getFleetCell } = await import(
  pathToFileURL(path.join(repo, "src/fleet/registry.ts")).href
);
const { closeOpenClawStateDatabase } = await import(
  pathToFileURL(path.join(repo, "src/state/openclaw-state-db.ts")).href
);
const childPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli-child.mjs");
const cases = [];
try {
  for (const runtime of ["docker", "podman"]) {
    const tenant = `proof-${runtime}`;
    reserveFleetCell(process.env, {
      tenantId: tenant,
      runtime,
      createdAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
      image: "proof-image",
      containerName: `openclaw-cell-${tenant}`,
      dataDir: path.join(stateDir, "fleet", "cells", tenant),
    });
    const stored = getFleetCell(process.env, tenant);
    assert.equal(stored.runtime, runtime);
    const run = (json) => {
      const args = ["--import", "./scripts/tsx.mjs", childPath, tenant, ...(json ? ["--json"] : [])];
      const result = spawnSync(process.execPath, args, {
        cwd: repo,
        env: { ...process.env, PATH: emptyPath, NODE_OPTIONS: "" },
        encoding: "utf8",
        timeout: 60000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    const human = run(false);
    const json = JSON.parse(run(true));
    const lines = human.trimEnd().split("\n");
    assert.equal(lines.filter((line) => line === `Runtime: ${runtime}`).length, phase === "product" ? 1 : 0);
    assert.ok(lines.includes(`Container: ${stored.containerName}`));
    assert.ok(lines.includes("State: unknown"));
    assert.ok(lines.includes("Health: skipped (container runtime unavailable)"));
    assert.equal(json.runtime, stored.runtime);
    assert.equal(json.container.state, "unknown");
    assert.equal(json.health.status, "skipped");
    assert.match(json.container.error, /ENOENT/);
    assert.deepEqual(getFleetCell(process.env, tenant), stored);
    cases.push({ runtime, human, jsonRuntime: json.runtime, state: json.container.state, health: json.health.status, registryUnchanged: true });
  }
} finally {
  closeOpenClawStateDatabase();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
const receipt = {
  productSha,
  phase,
  node: process.version,
  sqlite: process.versions.sqlite,
  productionEntry: "Commander registerFleetCli -> runFleetStatusCommand -> createFleetService.status -> getFleetCell SQLite read -> defaultRuntime stdout",
  stimulus: "Two canonical registry reservations, Docker and Podman, then separate registered CLI status text/JSON child processes; empty PATH makes runtime binaries unavailable.",
  cases,
  readbackSha256: crypto.createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
  cleanup: { temporaryRootRemoved: !fs.existsSync(temporaryRoot) },
  limitations: "Source registered Fleet CLI, not packaged root bootstrap; no container daemon, running container, or network health endpoint exercised. No mocked handler, service, registry, or runtime output.",
};
fs.writeFileSync(artifactPath, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
