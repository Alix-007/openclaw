import * as fs from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { clearConfigCache } from "openclaw/plugin-sdk/runtime-config-snapshot";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { awaitGateBeforeSettlement, createDeferred } from "../../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { registerPolicyCli } from "./cli.js";

const mocks = vi.hoisted(() => ({ beforeRead: vi.fn(async (_path: unknown) => {}) }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      await mocks.beforeRead(args[0]);
      return actual.readFile(...args);
    },
  };
});

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
let workspace: string;
let previousExitCode: typeof process.exitCode;

beforeEach(async () => {
  mocks.beforeRead.mockReset().mockResolvedValue(undefined);
  workspace = tempDirs.make("policy-watch-lifecycle-");
  const config = join(workspace, "openclaw.json");
  vi.stubEnv("OPENCLAW_WORKSPACE_DIR", workspace);
  vi.stubEnv("OPENCLAW_CONFIG_PATH", config);
  await fs.writeFile(config, JSON.stringify({ agents: { defaults: { workspace } } }));
  await fs.writeFile(join(workspace, "policy.jsonc"), "{}");
  clearConfigCache();
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = previousExitCode;
  clearConfigCache();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each([
  { firstSignal: "SIGINT", exitCode: 130 },
  { firstSignal: "SIGTERM", exitCode: 143 },
  { firstSignal: undefined, exitCode: 0 },
])(
  "settles an in-flight watch evaluation after $firstSignal",
  async ({ firstSignal, exitCode }) => {
    const reading = createDeferred();
    const release = createDeferred();
    mocks.beforeRead.mockImplementation(async (file) => {
      if (file === join(workspace, "policy.jsonc")) {
        reading.resolve();
        await release.promise;
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const listeners = {
      SIGINT: process.listeners("SIGINT"),
      SIGTERM: process.listeners("SIGTERM"),
    };
    const program = new Command().name("openclaw");
    registerPolicyCli(program);
    const running = program.parseAsync(["policy", "watch", "--json", "--once"], { from: "user" });
    try {
      await awaitGateBeforeSettlement(
        reading.promise,
        running,
        "watch did not read its policy file",
      );
      if (firstSignal) {
        process.emit(firstSignal);
        process.emit(firstSignal === "SIGINT" ? "SIGTERM" : "SIGINT");
      }
      release.resolve();
      await running;

      expect(process.exitCode).toBe(exitCode);
      expect(stderr).not.toHaveBeenCalled();
      if (firstSignal) {
        expect(stdout).not.toHaveBeenCalled();
      } else {
        expect(stdout).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
          status: "clean",
          ok: true,
        });
      }
      expect(process.listeners("SIGINT")).toEqual(listeners.SIGINT);
      expect(process.listeners("SIGTERM")).toEqual(listeners.SIGTERM);
    } finally {
      release.resolve();
      await running;
    }
  },
);
