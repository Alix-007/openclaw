import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  getRuntimeConfig,
} from "../../../config/config.js";
import { prepareAgentRequestPreflight } from "../../../gateway/agent-turn/agent-request-preflight.js";
import { createAgentTurnIo } from "../../../gateway/agent-turn/io.js";
import type {
  GatewayRequestContext,
  GatewayRequestOptions,
} from "../../../gateway/server-methods/types.js";
import { createSyntheticPluginRuntimeClient } from "../../../gateway/server-plugin-runtime-client.js";
import type { dispatchGatewayMethodInProcess } from "../../../gateway/server-plugins.js";
import { withPluginRuntimeGatewayRequestScope } from "../../../plugins/runtime/gateway-request-scope.js";
import { resetGatewayWorkAdmission } from "../../../process/gateway-work-admission.js";
import { captureEnv, setTestEnvValue } from "../../../test-utils/env.js";
import { createSessionsSpawnTool } from "../../tools/sessions-spawn-tool.js";
import {
  resetSubagentRegistryForTests,
  testing as subagentRegistryTesting,
} from "../registry/subagent-registry.test-helpers.js";
import { testing as swarmSchedulerTesting } from "../swarm/swarm-scheduler.test-support.js";
import { testing as subagentSpawnTesting } from "./subagent-spawn.test-support.js";

const envSnapshot = captureEnv(["OPENCLAW_CONFIG_PATH", "OPENCLAW_STATE_DIR"]);
let stateDir = "";

function makeGatewayContext(): GatewayRequestContext {
  return {
    dedupe: new Map(),
    addChatRun: vi.fn(),
    removeChatRun: vi.fn(),
    chatAbortControllers: new Map(),
    chatQueuedTurns: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    chatDeltaLastBroadcastLen: new Map(),
    chatDeltaLastBroadcastText: new Map(),
    chatAbortedRuns: new Map(),
    clearChatRunState: vi.fn(),
    agentRunSeq: new Map(),
    agentDeltaSentAt: new Map(),
    broadcast: vi.fn(),
    nodeSendToSession: vi.fn(),
    logGateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcastToConnIds: vi.fn(),
    getSessionEventSubscriberConnIds: () => new Set(),
    getRuntimeConfig,
  };
}

function externalCliClient(): GatewayRequestOptions["client"] {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 1,
      client: {
        id: "cli",
        version: "proof",
        platform: "linux",
        mode: "cli",
      },
      scopes: ["operator.write"],
    },
  } as GatewayRequestOptions["client"];
}

describe("sessions_spawn blank category production boundary proof", () => {
  beforeEach(async () => {
    resetGatewayWorkAdmission();
    swarmSchedulerTesting.reset();
    resetSubagentRegistryForTests({ persist: false });
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    subagentRegistryTesting.setDepsForTest({
      loadAgentRuntimePluginRegistryHandle: () => undefined,
      persistSubagentRunsToDisk: () => {},
      persistSubagentRunsToDiskOrThrow: () => {},
      restoreSubagentRunsFromDisk: () => 0,
    });

    stateDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-spawn-category-proof-"));
    setTestEnvValue("OPENCLAW_STATE_DIR", stateDir);
    setTestEnvValue("OPENCLAW_CONFIG_PATH", path.join(stateDir, "openclaw.json"));
    await writeFile(
      path.join(stateDir, "openclaw.json"),
      `${JSON.stringify({
        session: { mainKey: "main", scope: "per-sender" },
        agents: {
          defaults: { workspace: stateDir },
          entries: { main: { workspace: stateDir } },
        },
      })}\n`,
    );
    clearConfigCache();
  });

  afterEach(async () => {
    resetGatewayWorkAdmission();
    swarmSchedulerTesting.reset();
    resetSubagentRegistryForTests({ persist: false });
    subagentRegistryTesting.setDepsForTest();
    subagentSpawnTesting.setDepsForTest();
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    envSnapshot.restore();
    if (stateDir) {
      await rm(stateDir, { recursive: true, force: true });
      stateDir = "";
    }
  });

  it("accepts omitted-equivalent categories and rejects a visible-only category before dispatch", async () => {
    const gatewayContext = makeGatewayContext();
    const dispatches: Array<{
      method: string;
      forceSyntheticClient: boolean;
      hostAccepted: boolean;
      hostResponded: boolean;
    }> = [];
    subagentSpawnTesting.setDepsForTest({
      dispatchGatewayMethodInProcess: async <T>(
        method: string,
        params: Record<string, unknown>,
        options?: NonNullable<Parameters<typeof dispatchGatewayMethodInProcess>[2]>,
      ) => {
        const respond = vi.fn();
        const client = options?.forceSyntheticClient
          ? createSyntheticPluginRuntimeClient({ scopes: options.syntheticScopes })
          : externalCliClient();
        const preflight = prepareAgentRequestPreflight({
          request: params,
          io: createAgentTurnIo(respond),
          context: gatewayContext,
          client,
        });
        dispatches.push({
          method,
          forceSyntheticClient: options?.forceSyntheticClient === true,
          hostAccepted: preflight !== undefined,
          hostResponded: respond.mock.calls.length > 0,
        });
        return {
          runId: params.idempotencyKey as string,
          status: "accepted",
        } as T;
      },
    });

    const tool = createSessionsSpawnTool({ agentSessionKey: "agent:main:main" });
    const execute = (toolCallId: string, category: string) =>
      withPluginRuntimeGatewayRequestScope(
        {
          context: gatewayContext,
          client: externalCliClient(),
          isWebchatConnect: () => false,
        },
        () =>
          tool.execute(toolCallId, {
            task: "prove blank category routing",
            runtime: "subagent",
            category,
            context: "isolated",
            lightContext: true,
          }),
      );

    const blank = await execute("blank-category", "");
    const whitespace = await execute("whitespace-category", " \t");
    await expect(execute("non-empty-category", "Projects")).rejects.toThrow(
      "Parameters require visible=true: category",
    );

    expect(blank.details).toMatchObject({ status: "accepted" });
    expect(whitespace.details).toMatchObject({ status: "accepted" });
    expect(dispatches).toEqual([
      {
        method: "agent",
        forceSyntheticClient: true,
        hostAccepted: true,
        hostResponded: false,
      },
      {
        method: "agent",
        forceSyntheticClient: true,
        hostAccepted: true,
        hostResponded: false,
      },
    ]);
    console.log(
      "[sessions_spawn blank-category proof] exact-head=true configured-agent=main gateway-preflight=in-process blank=accepted whitespace=accepted non-empty=rejected dispatches=2",
    );
  });
});
