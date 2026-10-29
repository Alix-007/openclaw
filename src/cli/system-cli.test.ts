import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncWorkScope } from "../shared/async-work-scope.js";
import { createCliRuntimeCapture } from "./test-runtime-capture.js";

const callGatewayFromCli = vi.fn();

const { runtimeLogs, runtimeErrors, defaultRuntime, resetRuntimeCapture } =
  createCliRuntimeCapture();

// mock-isolation: Exercise command registration without opening a live Gateway connection.
vi.mock("./gateway-rpc.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gateway-rpc.js")>()),
  addGatewayClientOptions: (command: Command) => command,
  callGatewayFromCli,
}));

vi.mock("../runtime.js", async () => ({
  ...(await vi.importActual<typeof import("../runtime.js")>("../runtime.js")),
  defaultRuntime,
}));

const { registerSystemCli } = await import("./system-cli.js");

describe("system-cli", () => {
  async function runCli(args: string[]) {
    const program = new Command();
    registerSystemCli(program);
    await program.parseAsync(args, { from: "user" });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeCapture();
    callGatewayFromCli.mockResolvedValue({ ok: true });
  });

  it("reports a rejected system event instead of claiming it was enqueued", async () => {
    callGatewayFromCli.mockResolvedValueOnce({ ok: false, reason: "unwakeable-session-key" });

    await expect(runCli(["system", "event", "--text", "hello"])).rejects.toThrow("__exit__:1");

    expect(runtimeLogs).toEqual([]);
    expect(runtimeErrors[0]).toContain("unwakeable-session-key");
  });

  it("writes JSON when invalid wake mode fails", async () => {
    await expect(
      runCli(["system", "event", "--text", "hello", "--mode", "later", "--json"]),
    ).rejects.toThrow("__exit__:1");
    const failure = {
      ok: false,
      error: { type: "cli_error", message: "--mode must be now or next-heartbeat" },
    };
    expect(runtimeLogs).toEqual([JSON.stringify(failure, null, 2)]);
    expect(runtimeErrors).toEqual([]);
    expect(callGatewayFromCli).not.toHaveBeenCalled();
  });

  it("hands agent selection refusals to the CLI failure owner in human mode", async () => {
    const error = new Error("Multiple agents are configured, but this operation has no owner.");
    error.name = "AgentSelectionRequiredError";
    callGatewayFromCli.mockRejectedValueOnce(error);

    await expect(runCli(["system", "event", "--text", "hello"])).rejects.toBe(error);

    expect(runtimeLogs).toEqual([]);
    expect(runtimeErrors).toEqual([]);
    expect(defaultRuntime.exit).not.toHaveBeenCalled();
  });

  it.each([
    [
      ["event", "--text", "ping", "--session-key", "agent:main:telegram:dm:42"],
      "wake",
      { mode: "next-heartbeat", text: "ping", sessionKey: "agent:main:telegram:dm:42" },
      "ok",
    ],
    [["presence"], "system-presence", undefined, '{\n  "ok": true\n}'],
  ] as const)("routes system %j to gateway", async (args, method, params, output) => {
    await runCli(["system", ...args]);
    expect(callGatewayFromCli.mock.calls[0]?.slice(0, 3)).toEqual([
      method,
      expect.any(Object),
      params,
    ]);
    expect(runtimeLogs).toEqual([output]);
  });

  it("does not dispatch a read query after its invocation closes", async () => {
    const scope = new AsyncWorkScope();
    scope.beginClose();

    await scope.run(() => runCli(["system", "presence"]));

    expect(callGatewayFromCli).not.toHaveBeenCalled();
    expect(runtimeLogs).toEqual([]);
    expect(runtimeErrors).toEqual([]);
  });

  it.each([
    [["presence"], "resolve"],
    [["presence"], "reject"],
    [["heartbeat", "last"], "resolve"],
    [["heartbeat", "last"], "reject"],
  ] as const)("keeps cancelled %j quiet after a late %s", async (args, outcome) => {
    const scope = new AsyncWorkScope();
    const reply = Promise.withResolvers<unknown>();
    callGatewayFromCli.mockReturnValueOnce(reply.promise);
    const pending = scope.run(() => runCli(["system", ...args]));
    scope.beginClose(new DOMException("CLI stopping", "AbortError"));
    if (outcome === "resolve") {
      reply.resolve({ ok: true });
    } else {
      reply.reject(new Error("Gateway closed"));
    }

    await pending;

    expect(runtimeLogs).toEqual([]);
    expect(runtimeErrors).toEqual([]);
    expect(defaultRuntime.exit).not.toHaveBeenCalled();
  });

  it.each([
    [["event", "--text", "ping"], "ok"],
    [["heartbeat", "enable"], '{\n  "ok": true\n}'],
    [["heartbeat", "disable"], '{\n  "ok": true\n}'],
  ] as const)("retains the accepted mutation receipt for %j", async (args, output) => {
    const scope = new AsyncWorkScope();
    callGatewayFromCli.mockImplementationOnce(async (_method, _opts, _params, extra) => {
      expect(extra.signal).toBeUndefined();
      scope.beginClose();
      return { ok: true };
    });

    await scope.run(() => runCli(["system", ...args]));

    expect(runtimeLogs).toEqual([output]);
    expect(runtimeErrors).toEqual([]);
  });

  it("retains ordinary read query errors as JSON failures", async () => {
    callGatewayFromCli.mockRejectedValueOnce(new Error("Gateway unavailable"));

    await expect(runCli(["system", "presence"])).rejects.toThrow("__exit__:1");

    expect(runtimeLogs).toEqual([
      JSON.stringify(
        { ok: false, error: { type: "cli_error", message: "Gateway unavailable" } },
        null,
        2,
      ),
    ]);
    expect(runtimeErrors).toEqual([]);
  });
});
