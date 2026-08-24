import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { CronService } from "../../../cron/service.js";
import { saveCronStore } from "../../../cron/store.js";
import { maybeRepairLegacyCronStore } from "./index.js";

const noteMock = vi.hoisted(() => vi.fn<(message: string, title?: string) => void>());

vi.mock("../../../../packages/terminal-core/src/note.js", () => ({ note: noteMock }));

test("proves the disabled in-flight Doctor inventory flow", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pr-128664-proof-"));
  const storePath = path.join(root, "cron", "jobs.json");
  const runningAtMs = Date.parse("2026-05-01T00:00:00.000Z");
  const job = {
    id: "disabled-running",
    name: "Disabled marker",
    enabled: false,
    createdAtMs: runningAtMs - 1_000,
    updatedAtMs: runningAtMs,
    schedule: { kind: "cron" as const, expr: "0 8 * * *", tz: "UTC" },
    sessionTarget: "isolated" as const,
    wakeMode: "now" as const,
    payload: { kind: "systemEvent" as const, text: "proof" },
    state: { runningAtMs },
  };

  try {
    await saveCronStore(storePath, { version: 1, jobs: [job] });
    await maybeRepairLegacyCronStore({
      cfg: { cron: { store: storePath } },
      options: {},
      prompter: { confirm: vi.fn().mockResolvedValue(true) },
    });
    const advisory = noteMock.mock.calls.find(
      ([message, title]) => title === "Cron" && message.includes("still marked in-flight"),
    )?.[0];

    const noop = () => undefined;
    const cron = new CronService({
      storePath,
      cronEnabled: false,
      log: { debug: noop, info: noop, warn: noop, error: noop },
      enqueueSystemEvent: noop,
      requestHeartbeat: noop,
      runIsolatedAgentJob: async () => ({ status: "ok" as const }),
    });
    const defaultRows = await cron.list();
    const allRows = await cron.list({ includeDisabled: true });
    cron.stop();

    const proof = {
      schemaVersion: 1,
      productHead: "354432ae1494c8b1d81c87e844657a9cd1c3aea5",
      doctor: {
        advisory,
        recommendsAll: advisory?.includes("openclaw automations list --all") ?? false,
        makesFalseRunningClaim: advisory?.includes("shows it as `running`") ?? false,
      },
      inventory: {
        defaultCount: defaultRows.length,
        allCount: allRows.length,
        allRows: allRows.map(({ id, enabled }) => ({ id, enabled })),
      },
    };
    console.log(`PR128664_PROOF=${JSON.stringify(proof)}`);

    expect(proof.doctor.recommendsAll).toBe(true);
    expect(proof.doctor.makesFalseRunningClaim).toBe(false);
    expect(proof.inventory.defaultCount).toBe(0);
    expect(proof.inventory.allRows).toEqual([{ id: "disabled-running", enabled: false }]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
