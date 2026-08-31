import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
// Lobster tests cover lobster tool plugin behavior.
import { createRequireRecord } from "openclaw/plugin-sdk/test-fixtures";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "../runtime-api.js";
import type { LobsterContinuationOwner } from "./lobster-continuations.js";
import { LobsterRunnerError } from "./lobster-runner.js";
import { createLobsterTool } from "./lobster-tool.js";
import { createFakeTaskFlow } from "./taskflow-test-helpers.js";

function fakeApi(overrides: Partial<OpenClawPluginApi> = {}): OpenClawPluginApi {
  return createTestPluginApi({
    id: "lobster",
    name: "lobster",
    source: "test",
    runtime: { version: "test" } as OpenClawPluginApi["runtime"],
    resolvePath: (p) => p,
    ...overrides,
  });
}

function fakeCtx(overrides: Partial<OpenClawPluginToolContext> = {}): OpenClawPluginToolContext {
  return {
    config: {},
    workspaceDir: "/tmp",
    agentDir: "/tmp",
    agentId: "main",
    sessionKey: "main",
    sessionId: "session-a",
    messageChannel: undefined,
    agentAccountId: undefined,
    sandboxed: false,
    ...overrides,
  };
}

const requireRecord = createRequireRecord("record", "expected-label-record");

function createContinuationStore() {
  const values = new Map<string, unknown>();
  return {
    register: (key: string, value: unknown) => {
      values.set(key, value);
    },
    registerIfAbsent: (key: string, value: unknown) => {
      if (values.has(key)) {
        return false;
      }
      values.set(key, value);
      return true;
    },
    lookup: (key: string) => values.get(key),
    update: (key: string, updateValue: (current: unknown) => unknown) => {
      const next = updateValue(values.get(key));
      if (next === undefined) {
        return false;
      }
      values.set(key, next);
      return true;
    },
    consume: (key: string) => {
      const value = values.get(key);
      values.delete(key);
      return value;
    },
    delete: (key: string) => values.delete(key),
    deleteIf: (key: string, predicate: (current: unknown) => boolean) => {
      const current = values.get(key);
      return current !== undefined && predicate(current) ? values.delete(key) : false;
    },
    entries: () => [...values].map(([key, value]) => ({ key, value, createdAt: 0 })),
    clear: () => values.clear(),
  };
}

function continuationOwner(
  store = createContinuationStore(),
  sessionId = "session-a",
): LobsterContinuationOwner {
  return {
    sessionKey: "agent:main:main",
    sessionId,
    openStore: () => store,
  };
}

describe("lobster plugin tool", () => {
  it("returns the Lobster envelope in details", async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "ok",
        output: [{ hello: "world" }],
        requiresApproval: null,
      }),
    };

    const tool = createLobsterTool(fakeApi(), { runner, continuationOwner: continuationOwner() });
    const res = await tool.execute("call1", {
      action: "run",
      pipeline: "noop",
      timeoutMs: 1000,
    });

    expect(runner.run).toHaveBeenCalledWith({
      action: "run",
      pipeline: "noop",
      cwd: process.cwd(),
      timeoutMs: 1000,
      maxStdoutBytes: 512_000,
    });
    const details = requireRecord(res.details, "lobster tool details");
    expect(details.ok).toBe(true);
    expect(details.status).toBe("ok");
    expect(details.output).toEqual([{ hello: "world" }]);
    expect(details.requiresApproval).toBeNull();
  });

  it("supports approval envelopes without changing the tool contract", async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "needs_approval",
        output: [],
        requiresApproval: {
          type: "approval_request",
          prompt: "Send these alerts?",
          items: [{ id: "alert-1" }],
          resumeToken: "resume-token-1",
        },
      }),
    };

    const tool = createLobsterTool(fakeApi(), { runner, continuationOwner: continuationOwner() });
    const res = await tool.execute("call-injected-runner", {
      action: "run",
      pipeline: "noop",
      argsJson: '{"since_hours":1}',
      timeoutMs: 1500,
      maxStdoutBytes: 4096,
    });

    expect(runner.run).toHaveBeenCalledWith({
      action: "run",
      pipeline: "noop",
      argsJson: '{"since_hours":1}',
      cwd: process.cwd(),
      timeoutMs: 1500,
      maxStdoutBytes: 4096,
    });
    const details = requireRecord(res.details, "approval lobster tool details");
    expect(details.ok).toBe(true);
    expect(details.status).toBe("needs_approval");
    const approval = requireRecord(details.requiresApproval, "approval request");
    expect(approval.type).toBe("approval_request");
    expect(approval.prompt).toBe("Send these alerts?");
    expect(approval.resumeToken).toBe("resume-token-1");
  });

  it("returns structured input requests and parses their resume response", async () => {
    const runner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: "needs_input",
          output: [],
          requiresApproval: null,
          requiresInput: {
            type: "input_request",
            prompt: "Choose a destination",
            responseSchema: {
              type: "object",
              properties: { destination: { type: "string" } },
              required: ["destination"],
            },
            resumeToken: "input-token-1",
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: "ok",
          output: [{ destination: "archive" }],
          requiresApproval: null,
        }),
    };
    const tool = createLobsterTool(fakeApi(), { runner, continuationOwner: continuationOwner() });

    const first = await tool.execute("call-input-run", {
      action: "run",
      pipeline: "ask --prompt 'Choose a destination'",
    });
    const firstDetails = requireRecord(first.details, "input request details");
    expect(firstDetails.status).toBe("needs_input");
    expect(requireRecord(firstDetails.requiresInput, "input request")).toMatchObject({
      prompt: "Choose a destination",
      resumeToken: "input-token-1",
    });

    const resumed = await tool.execute("call-input-resume", {
      action: "resume",
      token: "input-token-1",
      responseJson: '{"destination":"archive"}',
    });
    expect(runner.run).toHaveBeenLastCalledWith({
      action: "resume",
      token: "input-token-1",
      response: { destination: "archive" },
      cwd: process.cwd(),
      timeoutMs: 20_000,
      maxStdoutBytes: 512_000,
    });
    expect(requireRecord(resumed.details, "input resume details").output).toEqual([
      { destination: "archive" },
    ]);
    await expect(
      tool.execute("call-input-replay", {
        action: "resume",
        token: "input-token-1",
        responseJson: '{"destination":"archive"}',
      }),
    ).rejects.toThrow(/unavailable, expired, or already used/);
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it("makes approval tokens and ids share one atomic continuation claim", async () => {
    const runner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: "needs_approval",
          output: [],
          requiresApproval: {
            type: "approval_request",
            prompt: "Continue?",
            items: [],
            resumeToken: "approval-token-shared-claim",
            approvalId: "approval-id-shared-claim",
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: "ok",
          output: ["approved"],
          requiresApproval: null,
        }),
    };
    const tool = createLobsterTool(fakeApi(), {
      runner,
      continuationOwner: continuationOwner(),
    });
    await tool.execute("call-approval-run", { action: "run", pipeline: "approve" });

    const tokenResume = tool.execute("call-approval-token-resume", {
      action: "resume",
      token: "approval-token-shared-claim",
      approve: true,
    });
    await expect(
      tool.execute("call-approval-id-concurrent-resume", {
        action: "resume",
        approvalId: "approval-id-shared-claim",
        approve: true,
      }),
    ).rejects.toThrow(/unavailable, expired, or already used/);
    await expect(tokenResume).resolves.toBeDefined();
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it("releases a structured-input claim when Lobster rejects the response before execution", async () => {
    const runner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: "needs_input",
          output: [],
          requiresApproval: null,
          requiresInput: {
            type: "input_request",
            prompt: "Choose a destination",
            responseSchema: { enum: ["archive"] },
            resumeToken: "input-token-retry",
          },
        })
        .mockRejectedValueOnce(
          new LobsterRunnerError("response failed schema validation", "parse_error"),
        )
        .mockResolvedValueOnce({
          ok: true,
          status: "ok",
          output: ["archive"],
          requiresApproval: null,
        }),
    };
    const tool = createLobsterTool(fakeApi(), {
      runner,
      continuationOwner: continuationOwner(),
    });
    await tool.execute("call-input-retry-run", { action: "run", pipeline: "ask" });

    await expect(
      tool.execute("call-input-invalid-response", {
        action: "resume",
        token: "input-token-retry",
        responseJson: '"inbox"',
      }),
    ).rejects.toThrow(/response failed schema validation/);
    await expect(
      tool.execute("call-input-valid-response", {
        action: "resume",
        token: "input-token-retry",
        responseJson: '"archive"',
      }),
    ).resolves.toBeDefined();
    expect(runner.run).toHaveBeenCalledTimes(3);
  });

  it("rejects a copied structured-input token before a foreign session reaches the runner", async () => {
    const runner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: "needs_input",
          output: [],
          requiresApproval: null,
          requiresInput: {
            type: "input_request",
            prompt: "Choose a destination",
            responseSchema: { type: "string" },
            resumeToken: "input-token-foreign-control",
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: "ok",
          output: ["unexpected"],
          requiresApproval: null,
        }),
    };
    const store = createContinuationStore();
    const creatingTool = createLobsterTool(fakeApi(), {
      runner,
      continuationOwner: continuationOwner(store, "session-a"),
    });
    await creatingTool.execute("call-input-run", {
      action: "run",
      pipeline: "ask --prompt 'Choose a destination'",
    });

    const foreignTool = createLobsterTool(fakeApi(), {
      runner,
      continuationOwner: continuationOwner(store, "session-b"),
    });
    await expect(
      foreignTool.execute("call-input-foreign-resume", {
        action: "resume",
        token: "input-token-foreign-control",
        responseJson: '"archive"',
      }),
    ).rejects.toThrow(/continuation belongs to another OpenClaw session/);
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it("does not return an unbound continuation from one-shot contexts", async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "needs_input",
        output: [],
        requiresApproval: null,
        requiresInput: {
          type: "input_request",
          prompt: "Choose a destination",
          responseSchema: { type: "string" },
          resumeToken: "unbound-input-token",
        },
      }),
    };
    const tool = createLobsterTool(fakeApi(), { runner });

    await expect(
      tool.execute("call-unbound-input-run", { action: "run", pipeline: "ask" }),
    ).rejects.toThrow(/requires a bound OpenClaw session/);
  });

  it("rejects invalid or ambiguous structured input responses", async () => {
    const runner = { run: vi.fn() };
    const tool = createLobsterTool(fakeApi(), { runner });

    await expect(
      tool.execute("call-invalid-input-response", {
        action: "resume",
        token: "input-token-1",
        responseJson: "{bad",
      }),
    ).rejects.toThrow("responseJson must be valid JSON");
    await expect(
      tool.execute("call-ambiguous-input-response", {
        action: "resume",
        token: "input-token-1",
        approve: true,
        responseJson: '{"destination":"archive"}',
      }),
    ).rejects.toThrow(/exactly one of approve or response required/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("keeps ordinary run on the runner for neutral flow defaults and ignores resume credentials", async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "needs_approval",
        output: [],
        requiresApproval: {
          type: "approval_request",
          prompt: "Continue?",
          items: [],
          resumeToken: "resume-token-1",
        },
      }),
    };
    const taskFlow = createFakeTaskFlow();

    const tool = createLobsterTool(fakeApi(), {
      runner,
      taskFlow,
      continuationOwner: continuationOwner(),
    });
    const res = await tool.execute("call-default-flow-run", {
      action: "run",
      pipeline: "noop",
      token: 42,
      approve: "yes",
      flowControllerId: " ",
      flowGoal: "",
      flowStateJson: "{}",
      flowId: " ",
      flowExpectedRevision: "0",
      flowCurrentStep: "",
      flowWaitingStep: " ",
    });

    expect(taskFlow.createManaged).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledWith({
      action: "run",
      pipeline: "noop",
      cwd: process.cwd(),
      timeoutMs: 20_000,
      maxStdoutBytes: 512_000,
    });
    const details = requireRecord(res.details, "ordinary run with flow defaults details");
    expect(details.status).toBe("needs_approval");
  });

  it.each([{ flowId: "flow-1" }, { flowExpectedRevision: 1 }])(
    "rejects resume-only fields on run before the ordinary fallback",
    async (resumeFields) => {
      const runner = { run: vi.fn() };
      const tool = createLobsterTool(fakeApi(), {
        runner,
        taskFlow: createFakeTaskFlow(),
      });

      await expect(
        tool.execute("call-run-with-resume-fields", {
          action: "run",
          pipeline: "noop",
          flowStateJson: "{}",
          flowExpectedRevision: 0,
          ...resumeFields,
        }),
      ).rejects.toThrow(/run action does not accept flowId or flowExpectedRevision/);
      expect(runner.run).not.toHaveBeenCalled();
    },
  );

  it("keeps ordinary resume on the runner for neutral flow defaults", async () => {
    const runner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: "needs_approval",
          output: [],
          requiresApproval: {
            type: "approval_request",
            prompt: "Continue?",
            items: [],
            resumeToken: "resume-token-1",
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: "ok",
          output: [{ approved: true }],
          requiresApproval: null,
        }),
    };
    const taskFlow = createFakeTaskFlow();

    const tool = createLobsterTool(fakeApi(), {
      runner,
      taskFlow,
      continuationOwner: continuationOwner(),
    });
    await tool.execute("call-default-flow-run", {
      action: "run",
      pipeline: "noop",
    });
    const res = await tool.execute("call-default-flow-resume", {
      action: "resume",
      token: "resume-token-1",
      approve: true,
      flowControllerId: " ",
      flowGoal: "",
      flowStateJson: "{}",
      flowId: " ",
      flowExpectedRevision: "0",
      flowCurrentStep: "",
      flowWaitingStep: " ",
    });

    expect(taskFlow.resume).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledWith({
      action: "resume",
      token: "resume-token-1",
      approve: true,
      cwd: process.cwd(),
      timeoutMs: 20_000,
      maxStdoutBytes: 512_000,
    });
    const details = requireRecord(res.details, "ordinary resume with flow defaults details");
    expect(details.ok).toBe(true);
    expect(details.status).toBe("ok");
  });

  it("rejects malformed resume credentials before ordinary fallback", async () => {
    const runner = { run: vi.fn() };
    const tool = createLobsterTool(fakeApi(), { runner });

    await expect(
      tool.execute("call-ordinary-resume-invalid-credentials", {
        action: "resume",
        token: 42,
        approve: "yes",
      }),
    ).rejects.toThrow("token must be a string");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it.each([
    { flowControllerId: "tests/lobster" },
    { flowGoal: "Run Lobster workflow" },
    { flowStateJson: '{"lane":"email"}' },
  ])("rejects run-only fields on resume before the ordinary fallback", async (runFields) => {
    const runner = { run: vi.fn() };
    const tool = createLobsterTool(fakeApi(), {
      runner,
      taskFlow: createFakeTaskFlow(),
    });

    await expect(
      tool.execute("call-resume-with-run-fields", {
        action: "resume",
        token: "resume-token-1",
        approve: true,
        flowExpectedRevision: 0,
        ...runFields,
      }),
    ).rejects.toThrow(/resume action does not accept flowControllerId, flowGoal, or flowStateJson/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it.each([
    [
      { action: "run", flowCurrentStep: "run_lobster" },
      "flowControllerId required when using managed TaskFlow run mode",
    ],
    [
      { action: "run", flowWaitingStep: "await_review" },
      "flowControllerId required when using managed TaskFlow run mode",
    ],
    [
      { action: "run", flowControllerId: "tests/lobster" },
      "flowGoal required when using managed TaskFlow run mode",
    ],
    [
      { action: "resume", token: "resume-token-1", approve: true, flowExpectedRevision: 1 },
      "flowId required when using managed TaskFlow resume mode",
    ],
    [
      { action: "resume", token: "resume-token-1", approve: true, flowId: "flow-1" },
      "flowExpectedRevision required when using managed TaskFlow resume mode",
    ],
    [
      {
        action: "resume",
        token: "resume-token-1",
        approve: true,
        flowCurrentStep: "resume_lobster",
      },
      "flowId required when using managed TaskFlow resume mode",
    ],
    [
      { action: "resume", token: "resume-token-1", approve: true, flowWaitingStep: "await_review" },
      "flowId required when using managed TaskFlow resume mode",
    ],
    [
      { action: "resume", approve: true, flowId: "flow-1", flowExpectedRevision: 1 },
      "token or approvalId required when using managed TaskFlow resume mode",
    ],
    [
      { action: "resume", token: "resume-token-1", flowId: "flow-1", flowExpectedRevision: 1 },
      "approve required when using managed TaskFlow resume mode",
    ],
  ])("requires managed TaskFlow fields", async (params, error) => {
    const runner = { run: vi.fn() };
    const tool = createLobsterTool(fakeApi(), {
      runner,
      taskFlow: createFakeTaskFlow(),
    });

    await expect(tool.execute("call-missing-managed-field", params)).rejects.toThrow(error);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it.each([
    [
      { action: "run", flowControllerId: 42, flowId: "flow-1" },
      "flowControllerId must be a string",
    ],
    [{ action: "resume", token: 42, flowControllerId: "tests/lobster" }, "token must be a string"],
  ])("preserves mixed-invalid field error precedence", async (params, error) => {
    const runner = { run: vi.fn() };
    const tool = createLobsterTool(fakeApi(), {
      runner,
      taskFlow: createFakeTaskFlow(),
    });

    await expect(tool.execute("call-mixed-invalid-fields", params)).rejects.toThrow(error);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("normalizes numeric string run limits before invoking the runner", async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "ok",
        output: [],
        requiresApproval: null,
      }),
    };

    const tool = createLobsterTool(fakeApi(), { runner });
    await tool.execute("call-string-limits", {
      action: "run",
      pipeline: "noop",
      timeoutMs: "1500",
      maxStdoutBytes: "4096",
    });

    expect(runner.run).toHaveBeenCalledWith({
      action: "run",
      pipeline: "noop",
      cwd: process.cwd(),
      timeoutMs: 1500,
      maxStdoutBytes: 4096,
    });
  });

  it("rejects malformed numeric run limits before invoking the runner", async () => {
    const runner = { run: vi.fn() };
    const tool = createLobsterTool(fakeApi(), { runner });

    await expect(
      tool.execute("call-bad-timeout", {
        action: "run",
        pipeline: "noop",
        timeoutMs: "1500.5",
      }),
    ).rejects.toThrow("timeoutMs must be a positive integer");
    await expect(
      tool.execute("call-bad-stdout", {
        action: "run",
        pipeline: "noop",
        maxStdoutBytes: 0,
      }),
    ).rejects.toThrow("maxStdoutBytes must be a positive integer");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("throws when the runner returns an error envelope", async () => {
    const tool = createLobsterTool(fakeApi(), {
      runner: {
        run: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            type: "runtime_error",
            message: "boom",
          },
        }),
      },
    });

    await expect(
      tool.execute("call-runner-error", {
        action: "run",
        pipeline: "noop",
      }),
    ).rejects.toThrow("boom");
  });

  it("can run through managed TaskFlow mode", async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "needs_approval",
        output: [],
        requiresApproval: {
          type: "approval_request",
          prompt: "Approve this?",
          items: [{ id: "item-1" }],
          resumeToken: "resume-1",
          approvalId: "approval-1",
        },
      }),
    };
    const taskFlow = createFakeTaskFlow();

    const tool = createLobsterTool(fakeApi(), { runner, taskFlow });
    const res = await tool.execute("call-managed-run", {
      action: "run",
      pipeline: "noop",
      flowControllerId: "tests/lobster",
      flowGoal: "Run Lobster workflow",
      flowStateJson: '{"lane":"email"}',
      flowExpectedRevision: 0,
      flowCurrentStep: "run_lobster",
      flowWaitingStep: "await_review",
    });

    expect(taskFlow.createManaged).toHaveBeenCalledWith({
      controllerId: "tests/lobster",
      goal: "Run Lobster workflow",
      currentStep: "run_lobster",
      stateJson: { lane: "email" },
    });
    expect(taskFlow.setWaiting).toHaveBeenCalledWith({
      flowId: "flow-1",
      expectedRevision: 1,
      currentStep: "await_review",
      waitJson: {
        kind: "lobster_approval",
        prompt: "Approve this?",
        items: [{ id: "item-1" }],
        resumeToken: "resume-1",
        approvalId: "approval-1",
      },
    });
    const details = requireRecord(res.details, "managed run lobster tool details");
    expect(details.ok).toBe(true);
    expect(details.status).toBe("needs_approval");
    const flow = requireRecord(details.flow, "managed run flow details");
    expect(flow.flowId).toBe("flow-1");
    const mutation = requireRecord(details.mutation, "managed run mutation details");
    expect(mutation.applied).toBe(true);
  });

  it("preserves explicit empty flow state in managed TaskFlow run mode", async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "ok",
        output: [],
        requiresApproval: null,
      }),
    };
    const taskFlow = createFakeTaskFlow();

    const tool = createLobsterTool(fakeApi(), { runner, taskFlow });
    await tool.execute("call-managed-run-empty-state", {
      action: "run",
      pipeline: "noop",
      flowControllerId: "tests/lobster",
      flowGoal: "Run Lobster workflow",
      flowStateJson: "{}",
    });

    expect(taskFlow.createManaged).toHaveBeenCalledWith({
      controllerId: "tests/lobster",
      goal: "Run Lobster workflow",
      currentStep: "run_lobster",
      stateJson: {},
    });
    expect(runner.run).toHaveBeenCalledWith({
      action: "run",
      pipeline: "noop",
      cwd: process.cwd(),
      timeoutMs: 20_000,
      maxStdoutBytes: 512_000,
    });
  });

  it("rejects managed TaskFlow params when no bound taskFlow runtime is available", async () => {
    const tool = createLobsterTool(fakeApi(), {
      runner: { run: vi.fn() },
    });

    await expect(
      tool.execute("call-missing-taskflow", {
        action: "run",
        pipeline: "noop",
        flowControllerId: "tests/lobster",
        flowGoal: "Run Lobster workflow",
      }),
    ).rejects.toThrow(/Managed TaskFlow run mode requires a bound taskFlow runtime/);
  });

  it("rejects invalid flowStateJson in managed TaskFlow mode", async () => {
    const tool = createLobsterTool(fakeApi(), {
      runner: { run: vi.fn() },
      taskFlow: createFakeTaskFlow(),
    });

    await expect(
      tool.execute("call-invalid-flow-json", {
        action: "run",
        pipeline: "noop",
        flowControllerId: "tests/lobster",
        flowGoal: "Run Lobster workflow",
        flowStateJson: "{bad",
      }),
    ).rejects.toThrow(/flowStateJson must be valid JSON/);
  });

  it("can resume managed TaskFlow revision zero with only approvalId", async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "ok",
        output: [],
        requiresApproval: null,
      }),
    };
    const taskFlow = createFakeTaskFlow();
    const tool = createLobsterTool(fakeApi(), { runner, taskFlow });

    const res = await tool.execute("call-managed-resume-approval-id", {
      action: "resume",
      approvalId: "approval-1",
      approve: true,
      flowId: "flow-1",
      flowExpectedRevision: 0,
      flowStateJson: "{}",
      flowCurrentStep: "resume_lobster",
    });

    expect(taskFlow.resume).toHaveBeenCalledWith({
      flowId: "flow-1",
      expectedRevision: 0,
      status: "running",
      currentStep: "resume_lobster",
    });
    expect(runner.run).toHaveBeenCalledWith({
      action: "resume",
      approvalId: "approval-1",
      approve: true,
      cwd: process.cwd(),
      timeoutMs: 20_000,
      maxStdoutBytes: 512_000,
    });
    const details = requireRecord(res.details, "managed resume lobster tool details");
    expect(details.ok).toBe(true);
    expect(details.status).toBe("ok");
    const mutation = requireRecord(details.mutation, "managed resume mutation details");
    expect(mutation.applied).toBe(true);
  });

  it("keeps managed TaskFlow resumes approval-only", async () => {
    const runner = { run: vi.fn() };
    const taskFlow = createFakeTaskFlow();
    const tool = createLobsterTool(fakeApi(), { runner, taskFlow });

    await expect(
      tool.execute("call-managed-input-resume", {
        action: "resume",
        token: "input-token-1",
        responseJson: '{"destination":"archive"}',
        flowId: "flow-1",
        flowExpectedRevision: 1,
      }),
    ).rejects.toThrow("managed TaskFlow resume mode only supports approval decisions");
    expect(taskFlow.resume).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("normalizes numeric string flowExpectedRevision before managed resume", async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "ok",
        output: [],
        requiresApproval: null,
      }),
    };
    const taskFlow = createFakeTaskFlow();
    const tool = createLobsterTool(fakeApi(), { runner, taskFlow });

    await tool.execute("call-managed-resume-string-revision", {
      action: "resume",
      token: " resume-token-1 ",
      approve: true,
      flowId: "flow-1",
      flowExpectedRevision: "1",
      flowCurrentStep: "resume_lobster",
    });

    expect(taskFlow.resume).toHaveBeenCalledWith({
      flowId: "flow-1",
      expectedRevision: 1,
      status: "running",
      currentStep: "resume_lobster",
    });
    expect(runner.run).toHaveBeenCalledWith({
      action: "resume",
      token: " resume-token-1 ",
      approve: true,
      cwd: process.cwd(),
      timeoutMs: 20_000,
      maxStdoutBytes: 512_000,
    });
  });

  it("requires action", async () => {
    const tool = createLobsterTool(fakeApi(), {
      runner: { run: vi.fn() },
    });
    await expect(tool.execute("call-action-missing", {})).rejects.toThrow(/action required/);
  });

  it("rejects unknown action", async () => {
    const tool = createLobsterTool(fakeApi(), {
      runner: { run: vi.fn() },
    });
    await expect(
      tool.execute("call-action-unknown", {
        action: "explode",
      }),
    ).rejects.toThrow(/Unknown action/);
  });

  it("rejects absolute cwd", async () => {
    const tool = createLobsterTool(fakeApi(), {
      runner: { run: vi.fn() },
    });
    await expect(
      tool.execute("call-absolute-cwd", {
        action: "run",
        pipeline: "noop",
        cwd: "/tmp",
      }),
    ).rejects.toThrow(/cwd must be a relative path/);
  });

  it("rejects cwd that escapes the gateway working directory", async () => {
    const tool = createLobsterTool(fakeApi(), {
      runner: { run: vi.fn() },
    });
    await expect(
      tool.execute("call-escape-cwd", {
        action: "run",
        pipeline: "noop",
        cwd: "../../etc",
      }),
    ).rejects.toThrow(/must stay within/);
  });

  it("can be gated off in sandboxed contexts", () => {
    const api = fakeApi();
    const factoryTool = (ctx: OpenClawPluginToolContext) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api, {
        runner: { run: vi.fn() },
      });
    };

    expect(factoryTool(fakeCtx({ sandboxed: true }))).toBeNull();
    expect(factoryTool(fakeCtx({ sandboxed: false }))?.name).toBe("lobster");
  });
});
