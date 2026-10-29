import { beforeEach, expect, it, vi } from "vitest";
import { AsyncWorkScope } from "../shared/async-work-scope.js";
import { createDeferredCore } from "../shared/deferred.js";
import { readConfigPatchOperations, type ConfigSetOperation } from "./config-cli-input.js";
import { handleConfigMutationError, runConfigOperations } from "./config-cli-runner.js";
import { runConfigPatch } from "./config-cli.js";
import { createInertRuntime } from "./test-runtime-mock.js";

// Native stdin lifetime is tested in config-cli-input.test.ts; these deferred
// outcomes independently verify the boundary before admitted mutation custody.
vi.mock("./config-cli-input.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config-cli-input.js")>();
  return { ...actual, readConfigPatchOperations: vi.fn<typeof actual.readConfigPatchOperations>() };
});
vi.mock("./config-cli-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config-cli-runner.js")>();
  return {
    ...actual,
    handleConfigMutationError: vi.fn<typeof actual.handleConfigMutationError>(),
    runConfigOperations: vi.fn<typeof actual.runConfigOperations>(),
  };
});

const operations: ConfigSetOperation[] = [
  {
    inputMode: "json",
    requestedPath: ["gateway", "port"],
    setPath: ["gateway", "port"],
    value: 18889,
  },
];
const runtime = createInertRuntime(vi);
const options = { stdin: true, dryRun: true, json: true };

beforeEach(() => {
  vi.resetAllMocks();
});

it.each(["pre-aborted", "read rejects", "late valid input"])(
  "abandons stdin preparation quietly: %s",
  async (phase) => {
    const scope = new AsyncWorkScope();
    const reached = createDeferredCore();
    const input = createDeferredCore<ConfigSetOperation[]>();
    vi.mocked(readConfigPatchOperations).mockImplementation(() => {
      reached.resolve();
      return input.promise;
    });
    if (phase === "pre-aborted") {
      scope.beginClose();
    }
    const command = scope.track(() => runConfigPatch({ cliOptions: options, runtime }));
    try {
      if (phase !== "pre-aborted") {
        await reached.promise;
        scope.beginClose();
      }
      if (phase === "read rejects") {
        input.reject(new DOMException("Interrupted", "AbortError"));
      } else {
        input.resolve(operations);
      }
      await expect(command).resolves.toBeUndefined();
      expect(readConfigPatchOperations).toHaveBeenCalledTimes(phase === "pre-aborted" ? 0 : 1);
      expect(runConfigOperations).not.toHaveBeenCalled();
      expect(handleConfigMutationError).not.toHaveBeenCalled();
      for (const output of Object.values(runtime)) {
        expect(output).not.toHaveBeenCalled();
      }
    } finally {
      input.resolve(operations);
      await scope.drain();
      await Promise.allSettled([command]);
    }
  },
);

it("retains ordinary input errors", async () => {
  const error = new Error("Invalid JSON5");
  vi.mocked(readConfigPatchOperations).mockRejectedValue(error);
  await runConfigPatch({ cliOptions: options, runtime });
  expect(handleConfigMutationError).toHaveBeenCalledWith({
    err: error,
    runtime,
    options,
    jsonOutput: true,
  });
  expect(runConfigOperations).not.toHaveBeenCalled();
});

it("refuses cancellation between prepared input and mutation handoff", async () => {
  const scope = new AsyncWorkScope();
  vi.mocked(readConfigPatchOperations).mockImplementation(async () => {
    queueMicrotask(() => queueMicrotask(() => scope.beginClose()));
    return operations;
  });
  try {
    await scope.track(() => runConfigPatch({ cliOptions: options, runtime }));
    expect(scope.signal.aborted).toBe(true);
    expect(runConfigOperations).not.toHaveBeenCalled();
    expect(handleConfigMutationError).not.toHaveBeenCalled();
  } finally {
    await scope.drain();
  }
});

it("preserves settlement and errors after mutation admission", async () => {
  const scope = new AsyncWorkScope();
  const reached = createDeferredCore();
  const write = createDeferredCore();
  const error = new Error("Admitted write failed");
  const writeOptions = { stdin: true };
  vi.mocked(readConfigPatchOperations).mockResolvedValue(operations);
  vi.mocked(runConfigOperations).mockImplementation(() => {
    reached.resolve();
    return write.promise;
  });
  const command = scope.track(() => runConfigPatch({ cliOptions: writeOptions, runtime }));
  try {
    await reached.promise;
    scope.beginClose();
    expect(scope.hasPendingWork).toBe(true);
    write.reject(error);
    await command;
    expect(runConfigOperations).toHaveBeenCalledExactlyOnceWith({
      runtime,
      options: writeOptions,
      operations,
      successMode: "patch",
    });
    expect(handleConfigMutationError).toHaveBeenCalledWith({
      err: error,
      runtime,
      options: writeOptions,
      jsonOutput: false,
    });
  } finally {
    write.resolve();
    await scope.drain();
    await Promise.allSettled([command]);
  }
});
