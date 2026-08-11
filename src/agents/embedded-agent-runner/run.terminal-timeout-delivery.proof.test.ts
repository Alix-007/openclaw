import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { settleReplyDispatcher } from "../../auto-reply/dispatch-dispatcher.js";
import type { ReplyDispatchRuntimeInfo } from "../../auto-reply/reply/reply-dispatcher.types.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  mockedBuildEmbeddedRunPayloads,
  mockedRunEmbeddedAttempt,
  overflowBaseRunParams,
  resetSharedRunIntegrationHarnessMocks,
  useOpenAIPlatformAuthFixture,
} from "./run.overflow-compaction.harness.js";
import { loadSharedRunIntegrationHarness } from "./run.shared-integration-harness.test-support.js";

const TARGET_HEAD = process.env.OPENCLAW_PROOF_HEAD_SHA ?? "unbound";
const GENERIC_TIMEOUT = "LLM request timed out.";
const DETAILED_TIMEOUT =
  "Provider timed out after the request started. Retry the turn, or increase `agents.defaults.timeoutSeconds` if this model routinely needs longer.";
const TOOL_MEDIA_URL = "https://example.test/redacted-tool-output.png";

let runEmbeddedAgent: Awaited<ReturnType<typeof loadSharedRunIntegrationHarness>>;
let getReplyPayloadMetadata: typeof import("../../auto-reply/reply-payload.js").getReplyPayloadMetadata;
let setReplyPayloadMetadata: typeof import("../../auto-reply/reply-payload.js").setReplyPayloadMetadata;
let createReplyDispatcher: typeof import("../../auto-reply/reply/reply-dispatcher.js").createReplyDispatcher;

beforeAll(async () => {
  runEmbeddedAgent = await loadSharedRunIntegrationHarness();
  ({ getReplyPayloadMetadata, setReplyPayloadMetadata } =
    await import("../../auto-reply/reply-payload.js"));
  ({ createReplyDispatcher } = await import("../../auto-reply/reply/reply-dispatcher.js"));
});

beforeEach(() => {
  resetSharedRunIntegrationHarnessMocks();
});

describe("PR #122036 after-fix terminal timeout delivery proof", () => {
  it("delivers one authoritative timeout and preserves independent same-text errors", async () => {
    const genericTimeoutPayload = setReplyPayloadMetadata(
      { text: GENERIC_TIMEOUT, isError: true },
      { synthesizedTimeoutError: true },
    );
    const independentSameTextError = { text: GENERIC_TIMEOUT, isError: true };
    mockedBuildEmbeddedRunPayloads.mockReturnValue([
      genericTimeoutPayload,
      independentSameTextError,
    ]);
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: [],
        terminal: {
          kind: "timeout",
          phase: "prompt",
          source: "runtime",
          aborted: true,
        },
        promptTimeoutOutcome: {
          message: DETAILED_TIMEOUT,
          replayInvalid: false,
          livenessState: "abandoned",
          timeoutPhase: "provider",
          providerStarted: true,
        },
        toolMediaUrls: [TOOL_MEDIA_URL],
      }),
    );
    useOpenAIPlatformAuthFixture();

    const result = await runEmbeddedAgent({
      ...overflowBaseRunParams,
      provider: "openai",
      model: "proof-model",
      runId: "proof-122036-terminal-timeout-delivery",
    });
    const terminalPayloads = result.payloads ?? [];

    expect(terminalPayloads).toHaveLength(2);
    expect(terminalPayloads[0]).toMatchObject({
      text: GENERIC_TIMEOUT,
      isError: true,
      mediaUrl: TOOL_MEDIA_URL,
      mediaUrls: [TOOL_MEDIA_URL],
    });
    expect(getReplyPayloadMetadata(terminalPayloads[0] ?? {})?.synthesizedTimeoutError).not.toBe(
      true,
    );
    expect(terminalPayloads[1]).toEqual({ text: DETAILED_TIMEOUT, isError: true });

    const physicalSends: Array<{
      payload: ReplyPayload;
      info: ReplyDispatchRuntimeInfo;
      metadata: ReturnType<typeof getReplyPayloadMetadata>;
    }> = [];
    const mockChannelApi = vi.fn(async (payload: ReplyPayload, info: ReplyDispatchRuntimeInfo) => {
      physicalSends.push({ payload, info, metadata: getReplyPayloadMetadata(payload) });
      return { visibleReplySent: true, messageId: `mock-send-${physicalSends.length}` };
    });
    const dispatcher = createReplyDispatcher({ deliver: mockChannelApi });
    for (const payload of terminalPayloads) {
      expect(dispatcher.sendFinalReply(payload)).toBe(true);
    }
    await settleReplyDispatcher({ dispatcher });

    const sameTextIndependentSends = physicalSends.filter(
      ({ payload }) => payload.text?.trim() === GENERIC_TIMEOUT,
    );
    const taggedSynthesizedTimeoutSends = physicalSends.filter(
      ({ payload }) => getReplyPayloadMetadata(payload)?.synthesizedTimeoutError === true,
    );
    const detailedTimeoutSends = physicalSends.filter(
      ({ payload }) => payload.text?.trim() === DETAILED_TIMEOUT,
    );
    const mediaSends = physicalSends.filter(({ payload }) =>
      payload.mediaUrls?.includes(TOOL_MEDIA_URL),
    );

    expect(mockChannelApi).toHaveBeenCalledTimes(2);
    expect(sameTextIndependentSends).toHaveLength(1);
    expect(taggedSynthesizedTimeoutSends).toHaveLength(0);
    expect(detailedTimeoutSends).toHaveLength(1);
    expect(mediaSends).toHaveLength(1);
    expect(mediaSends[0]).toMatchObject({
      payload: {
        text: GENERIC_TIMEOUT,
        isError: true,
        mediaUrl: TOOL_MEDIA_URL,
        mediaUrls: [TOOL_MEDIA_URL],
      },
      info: { kind: "final" },
    });
    expect(dispatcher.getFailedCounts()).toEqual({ tool: 0, block: 0, final: 0 });

    const verdictPath = process.env.OPENCLAW_PROOF_VERDICT_PATH;
    if (verdictPath) {
      const verdict = {
        schema: "openclaw.pr-real-behavior-proof/v1",
        result: "pass",
        target: {
          repository: "openclaw/openclaw",
          pullRequest: 122036,
          immutableHead: TARGET_HEAD,
        },
        proofHarnessCommit: process.env.OPENCLAW_PROOF_HARNESS_COMMIT ?? "working-tree",
        environment: {
          node: process.version,
          credentials: "none",
          provider: "mock",
          channelApi: "mock",
        },
        productionBoundary: [
          "mock provider attempt",
          "runEmbeddedAgent",
          "terminal preparation and timeout finalization",
          "tool-media payload merge",
          "shared reply dispatcher",
          "mock channel API",
        ],
        observed: {
          physicalSends: physicalSends.length,
          taggedSynthesizedTimeoutSends: taggedSynthesizedTimeoutSends.length,
          sameTextIndependentErrorSends: sameTextIndependentSends.length,
          authoritativeDetailedTimeoutSends: detailedTimeoutSends.length,
          toolMediaSends: mediaSends.length,
          mediaPreservedOutsideTaggedPayload: mediaSends.length === 1,
          failedSends: dispatcher.getFailedCounts(),
        },
        redaction: {
          containsCredentials: false,
          containsLocalPaths: false,
          containsSessionIdentifiers: false,
        },
      };
      await mkdir(dirname(verdictPath), { recursive: true });
      await writeFile(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
    }
  });
});
