import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctorSessionSqlite } from "./doctor-session-sqlite.js";

describe("doctor session sqlite explicit store owner", () => {
  it("uses the requested agent when an explicit store path is supplied", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-doctor-agent-"));
    try {
      const store = path.join(root, "sessions.json");
      const report = await runDoctorSessionSqlite({
        mode: "inspect",
        store,
        agent: "other",
        cfg: { agents: { entries: { main: { default: true }, other: {} } } },
        env: { ...process.env, OPENCLAW_STATE_DIR: root },
      });
      expect(report.targets).toHaveLength(1);
      expect(report.targets[0]?.agentId).toBe("other");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
