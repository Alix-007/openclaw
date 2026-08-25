import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deliverSubagentAnnouncement } from "../../src/agents/subagents/announce/subagent-announce-delivery.test-support.js";
import { testing as deliveryTesting } from "../../src/agents/subagents/announce/subagent-announce-delivery.test-support.js";
import { callGateway as realCallGateway } from "../../src/gateway/call.js";
import {
  agentCommandMock,
  getGatewayTestPort,
  installGatewayTestHooks,
  startTestGatewayServer,
  testState,
} from "../../src/gateway/test-helpers.js";
import { defaultRuntime } from "../../src/runtime.js";
import { captureEnv } from "../../src/test-utils/env.js";

installGatewayTestHooks({ scope: "suite" });

const gatewayToken = "test-gateway-token-1234567890";
const artifactDir = path.resolve(".artifacts/qa-e2e/pr-125130-subagent-announcement");
let envSnapshot: ReturnType<typeof captureEnv>;

async function approveLocalCliDevice() {
  const { approveDevicePairing } = await import("../../src/infra/device-pairing-approval.js");
  const { requestDevicePairing } = await import("../../src/infra/device-pairing.js");
  const { loadOrCreateDeviceIdentity, publicKeyRawBase64UrlFromPem } =
    await import("../../src/infra/device-identity.js");
  const identity = loadOrCreateDeviceIdentity();
  const pending = await requestDevicePairing({
    deviceId: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    clientId: "openclaw-cli",
    clientMode: "cli",
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals"],
    silent: false,
  });
  await approveDevicePairing(pending.request.requestId, {
    callerScopes: pending.request.scopes ?? ["operator.admin"],
  });
}

beforeAll(() => {
  envSnapshot = captureEnv(["OPENCLAW_GATEWAY_PORT", "OPENCLAW_GATEWAY_TOKEN"]);
});

afterEach(() => {
  deliveryTesting.setDepsForTest();
});

afterAll(() => {
  envSnapshot.restore();
});

describe("subagent completion recovery through a real Gateway boundary", () => {
  it("records one warning when a failed direct RPC recovers through steer fallback", async () => {
    const port = await getGatewayTestPort();
    testState.gatewayAuth = { mode: "token", token: gatewayToken };
    process.env.OPENCLAW_GATEWAY_PORT = String(port);
    process.env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
    await approveLocalCliDevice();

    vi.mocked(agentCommandMock).mockResolvedValue({
      payloads: [{ text: "requester handoff attempted" }],
      meta: {},
      deliverySucceeded: false,
      deliveryStatus: {
        requested: true,
        attempted: true,
        status: "failed",
        succeeded: false,
        error: true,
        reason: "proof_direct_delivery_failed",
        errorMessage: "proof direct delivery failed",
      },
    });

    let activityChecks = 0;
    const queueCalls: Array<{ sessionId: string; text: string }> = [];
    deliveryTesting.setDepsForTest({
      callGateway: realCallGateway,
      getRequesterSessionActivity: () => ({
        sessionId: "requester-session-proof",
        isActive: activityChecks++ > 0,
      }),
      getRuntimeConfig: () => ({}),
      queueEmbeddedAgentMessageWithOutcome: (sessionId, text) => {
        queueCalls.push({ sessionId, text });
        return {
          queued: true,
          sessionId,
          target: "embedded_run",
          gatewayHealth: "live",
          enqueuedAtMs: 4_100,
          deliveredAtMs: 4_200,
        };
      },
    });

    const warnings: string[] = [];
    const logSpy = vi.spyOn(defaultRuntime, "log").mockImplementation((message) => {
      const text = String(message);
      if (text.includes("Subagent completion direct announce failed")) {
        warnings.push(text);
      }
    });
    const server = await startTestGatewayServer(port);

    try {
      const result = await deliverSubagentAnnouncement({
        requesterSessionKey: "agent:main:main",
        targetRequesterSessionKey: "agent:main:main",
        triggerMessage: "child done",
        steerMessage: "child done",
        requesterIsSubagent: false,
        expectsCompletionMessage: true,
        bestEffortDeliver: true,
        directIdempotencyKey: "proof-steer-recovery",
        sourceSessionKey: "codex-native:proof-child",
        sourceTool: "agent_harness_task",
      });
      const expectedWarning =
        "[warn] Subagent completion direct announce failed for session codex-native:proof-child: proof direct delivery failed; recovered via steered";

      expect(result).toMatchObject({
        delivered: true,
        path: "steered",
        phases: [
          {
            phase: "direct-primary",
            delivered: false,
            path: "direct",
            error: "proof direct delivery failed",
          },
          { phase: "steer-fallback", delivered: true, path: "steered" },
        ],
      });
      expect(agentCommandMock).toHaveBeenCalledTimes(1);
      expect(queueCalls).toEqual([{ sessionId: "requester-session-proof", text: "child done" }]);
      expect(warnings).toEqual([expectedWarning]);

      const artifact = {
        schemaVersion: 1,
        productSha: process.env.OPENCLAW_PROOF_HEAD_SHA,
        boundary: {
          gatewayServer: "real-loopback-websocket",
          authentication: "token-plus-approved-cli-device",
          method: "agent",
          controlledBehindGateway: "agentCommand fixture returns failed deliveryStatus",
        },
        observed: {
          gatewayAgentRpcCalls: vi.mocked(agentCommandMock).mock.calls.length,
          requesterActivityChecks: activityChecks,
          queueCalls,
          result,
          warnings,
        },
        assertions: {
          exactProductShaBound: Boolean(process.env.OPENCLAW_PROOF_HEAD_SHA),
          directPrimaryFailed: true,
          steerFallbackSucceeded: true,
          recoveredViaSteeredWarningCount: warnings.length,
        },
      };
      await mkdir(artifactDir, { recursive: true });
      await writeFile(
        path.join(artifactDir, "gateway-steer-recovery.json"),
        `${JSON.stringify(artifact, null, 2)}\n`,
        "utf8",
      );
      console.log(
        "[subagent announcement proof] exact-head=true real-gateway=true direct-primary=failed steer-fallback=delivered recovered-warning-count=1",
      );
    } finally {
      logSpy.mockRestore();
      await server.close();
    }
  });
});
