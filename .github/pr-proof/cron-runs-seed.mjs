import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.argv[2];
const readbackOnly = process.argv[3] === "readback";
const source = (file) => import(pathToFileURL(path.join(root, "src", file)).href);
const { upsertTaskWithDeliveryStateToSqlite, listTaskRegistryRecordsByRuntimeSourceIdFromSqlite } =
  await source("tasks/task-registry.store.sqlite.ts");
const { cronRunLogEntryToTaskDetail, cronRunStatusToTaskStatus } =
  await source("cron/task-run-detail.ts");
const { resolveCronJobsStorePath } = await source("cron/store.ts");
const { cronStoreKey } = await source("cron/store/key.ts");
const jobId = "cron-runs-proof-job";
const storeKey = cronStoreKey(resolveCronJobsStorePath());
// Use the canonical task writer/codec, exactly as the existing history tests do.
// No JSONL history, raw SQL, replacement RPC handler, or fake Gateway is involved.
const rows = [
  ["error", "not-delivered", "proof-needle oldest failure"],
  ["error", "not-delivered", "proof-needle newer failure"],
  ["ok", "not-delivered", "successful but undelivered"],
  ["ok", "delivered", "newest success"],
].map(([status, deliveryStatus, summary], index) => {
  const ts = Date.UTC(2026, 8, 8) + index * 1000;
  const entry = { ts, jobId, action: "finished", status, deliveryStatus, summary,
    runAtMs: ts - 100, durationMs: 100,
    ...(status === "error" ? { error: summary } : {}) };
  return { taskId: `cron-proof-${index}`, runtime: "cron", sourceId: jobId,
    requesterSessionKey: "", ownerKey: "", scopeKind: "system", agentId: "main",
    runId: `cron:${jobId}:${entry.runAtMs}`, task: jobId,
    status: cronRunStatusToTaskStatus(entry), deliveryStatus: "not_applicable",
    notifyPolicy: "silent", createdAt: entry.runAtMs, startedAt: entry.runAtMs,
    endedAt: ts, lastEventAt: ts, error: entry.error, terminalSummary: summary,
    detail: cronRunLogEntryToTaskDetail(entry, { storeKey }) };
});
if (!readbackOnly) {
  for (const task of rows) upsertTaskWithDeliveryStateToSqlite({ task });
}
const stored = listTaskRegistryRecordsByRuntimeSourceIdFromSqlite({ runtime: "cron", sourceId: jobId });
assert.equal(stored.length, 4);
assert.deepEqual(stored.map((row) => row.taskId).sort(), rows.map((row) => row.taskId).sort());
const projection = stored.map(({ taskId, status, terminalSummary, detail }) =>
  ({ taskId, status, terminalSummary, detail })).sort((a, b) => a.taskId.localeCompare(b.taskId));
console.log(JSON.stringify(projection, null, 2));
