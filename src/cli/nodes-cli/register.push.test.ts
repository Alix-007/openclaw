import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = await vi.hoisted(async () => {
  const { createCliRuntimeMock } = await import("../test-runtime-mock.js");
  return {
    ...createCliRuntimeMock(vi),
    resolveCliNodeId: vi.fn(),
    callNodesGatewayCli: vi.fn(),
  };
});

vi.mock("../../runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../runtime.js")>()),
  defaultRuntime: mocks.defaultRuntime,
}));
vi.mock("./rpc.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rpc.js")>()),
  resolveCliNodeId: mocks.resolveCliNodeId,
  callNodesGatewayCli: mocks.callNodesGatewayCli,
}));

import { formatCliJsonFailure } from "../failure-output.js";
import { registerNodesPushCommand } from "./register.push.js";

const invalidEnvironment = "invalid --environment (use sandbox|production)";
const success = { ok: true, status: 200, environment: "sandbox" };

describe("nodes push environment validation", () => {
  let previousArgv: string[];
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousArgv = process.argv;
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.clearAllMocks();
    mocks.runtimeLogs.length = 0;
    mocks.runtimeErrors.length = 0;
    mocks.resolveCliNodeId.mockResolvedValue("proof-node");
    mocks.callNodesGatewayCli.mockResolvedValue(success);
  });

  afterEach(() => {
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  });

  async function run(args: string[]) {
    const program = new Command().name("openclaw").exitOverride();
    registerNodesPushCommand(program.command("nodes"));
    process.argv = ["node", "openclaw", "nodes", "push", "--node", "proof-node", ...args];
    await program.parseAsync(process.argv);
  }

  it.each(["", " \t ", "staging"])(
    "rejects invalid environment %j before any RPC in JSON mode",
    async (environment) => {
      let thrown: unknown;
      try {
        await run(["--environment", environment, "--json"]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(formatCliJsonFailure(thrown)).toEqual({
        ok: false,
        error: { type: "cli_error", message: invalidEnvironment },
      });
      expect(mocks.resolveCliNodeId).not.toHaveBeenCalled();
      expect(mocks.callNodesGatewayCli).not.toHaveBeenCalled();
      expect(mocks.defaultRuntime.writeJson).not.toHaveBeenCalled();
      expect(mocks.runtimeLogs).toEqual([]);
      expect(mocks.runtimeErrors).toEqual([]);
    },
  );

  it.each(["", " \t ", "staging"])(
    "retains the human error and exit path for %j",
    async (environment) => {
      await expect(run(["--environment", environment])).rejects.toThrow("__exit__:1");
      expect(mocks.runtimeErrors).toHaveLength(1);
      expect(mocks.runtimeErrors[0]).toContain(`nodes push failed: ${invalidEnvironment}`);
      expect(mocks.defaultRuntime.exit).toHaveBeenCalledWith(1);
      expect(mocks.resolveCliNodeId).not.toHaveBeenCalled();
      expect(mocks.callNodesGatewayCli).not.toHaveBeenCalled();
      expect(mocks.runtimeLogs).toEqual([]);
    },
  );

  it.each([
    { raw: undefined, expected: undefined },
    { raw: "sandbox", expected: "sandbox" },
    { raw: "production", expected: "production" },
    { raw: " SANDBOX ", expected: "sandbox" },
    { raw: " Production ", expected: "production" },
  ])("preserves omission and normalized environment $raw", async ({ raw, expected }) => {
    await run([...(raw === undefined ? [] : ["--environment", raw]), "--json"]);
    expect(mocks.resolveCliNodeId).toHaveBeenCalledTimes(1);
    expect(mocks.callNodesGatewayCli).toHaveBeenCalledExactlyOnceWith(
      "push.test",
      expect.objectContaining({ node: "proof-node", timeout: "25000", json: true }),
      {
        nodeId: "proof-node",
        title: "OpenClaw",
        body: "Push test for node proof-node",
        ...(expected === undefined ? {} : { environment: expected }),
      },
    );
    expect(mocks.defaultRuntime.writeJson).toHaveBeenCalledExactlyOnceWith(success);
    expect(process.exitCode).toBeUndefined();
  });

  it("preserves explicit title/body and complete failed push JSON", async () => {
    const failure = {
      ok: false,
      status: 400,
      environment: "production",
      reason: "Synthetic rejection",
    };
    mocks.callNodesGatewayCli.mockResolvedValue(failure);
    await run([
      "--environment", "production", "--title", " Proof ", "--body", " Body ", "--json",
    ]);
    expect(mocks.callNodesGatewayCli).toHaveBeenCalledWith(
      "push.test",
      expect.anything(),
      { nodeId: "proof-node", title: "Proof", body: "Body", environment: "production" },
    );
    expect(mocks.defaultRuntime.writeJson).toHaveBeenCalledExactlyOnceWith(failure);
    expect(process.exitCode).toBe(1);
  });
});
