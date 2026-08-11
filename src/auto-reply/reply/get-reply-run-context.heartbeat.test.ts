import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareReplyRunContext } from "./get-reply-run-context.js";
import type { RunPreparedReplyParams } from "./get-reply-run.types.js";

const buildInboundUserContextPrefix = vi.hoisted(() => vi.fn());

vi.mock("./body.js", () => ({
  applySessionHints: vi.fn(async ({ baseBody }: { baseBody: string }) => baseBody),
}));

vi.mock("./inbound-meta.js", () => ({
  buildInboundMetaSystemPrompt: vi.fn().mockReturnValue(""),
  buildInboundUserContextPrefix,
  formatActiveGoalContext: vi.fn().mockReturnValue(undefined),
  resolveInboundUserContextPromptJoiner: vi.fn().mockReturnValue(undefined),
}));

function createParams(
  provider: "heartbeat" | "cron-event" | "exec-event" | "discord",
  isHeartbeat = true,
) {
  const prompt = "Read HEARTBEAT.md and run any due maintenance.";
  return {
    ctx: {
      Body: prompt,
      RawBody: prompt,
      CommandBody: prompt,
      commandText: prompt,
      agentText: prompt,
      rawText: prompt,
      Provider: provider,
      Surface: provider,
      ChatType: "direct",
      OriginatingChannel: "discord",
      OriginatingTo: "discord:channel-123",
      SessionKey: "session-key",
    },
    sessionCtx: {
      Body: prompt,
      BodyStripped: prompt,
      commandText: prompt,
      agentText: prompt,
      rawText: prompt,
      Provider: provider,
      Surface: provider,
      ChatType: "direct",
      OriginatingChannel: "discord",
      OriginatingTo: "discord:channel-123",
      SessionKey: "session-key",
    },
    cfg: { session: {}, channels: {}, agents: { defaults: {} } },
    agentId: "default",
    agentDir: "/tmp/agent",
    agentCfg: {},
    sessionCfg: {},
    commandAuthorized: true,
    command: {
      surface: provider,
      channel: provider,
      isAuthorizedSender: true,
      abortKey: "session-key",
      ownerList: [],
      senderIsOwner: false,
      rawBodyNormalized: prompt,
      commandBodyNormalized: prompt,
    } as RunPreparedReplyParams["command"],
    allowTextCommands: true,
    directives: { hasThinkDirective: false } as RunPreparedReplyParams["directives"],
    defaultActivation: "always",
    resolvedThinkLevel: "off",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: "off",
    elevatedEnabled: false,
    elevatedAllowed: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    modelState: {
      resolveDefaultThinkingLevel: async () => "off",
      resolveThinkingCatalog: async () => [],
    } as RunPreparedReplyParams["modelState"],
    provider: "anthropic",
    model: "claude-opus-4-1",
    typing: {
      onReplyStart: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn(),
    } as unknown as RunPreparedReplyParams["typing"],
    opts: isHeartbeat ? { isHeartbeat: true } : undefined,
    defaultModel: "claude-opus-4-1",
    timeoutMs: 30_000,
    isNewSession: false,
    resetTriggered: false,
    systemSent: true,
    sessionKey: "session-key",
    workspaceDir: "/tmp/workspace",
    abortedLastRun: false,
  } satisfies RunPreparedReplyParams;
}

describe("prepareReplyRunContext heartbeat metadata", () => {
  beforeEach(() => {
    buildInboundUserContextPrefix.mockReset();
  });

  it.each(["heartbeat", "cron-event", "exec-event"] as const)(
    "keeps %s route facts out of user-role context",
    async (provider) => {
      buildInboundUserContextPrefix.mockReturnValue(
        'Conversation info:\n```json\n{"chat_id":"discord:channel-123"}\n```',
      );

      const result = await prepareReplyRunContext(createParams(provider));

      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") {
        throw new Error("expected ready reply context");
      }
      expect(buildInboundUserContextPrefix).not.toHaveBeenCalled();
      expect(result.promptSessionCtx).toMatchObject({
        OriginatingChannel: "discord",
        OriginatingTo: "discord:channel-123",
      });
      expect(result.promptEnvelopeBase.currentInboundContext).toBeUndefined();
    },
  );

  it("preserves inbound metadata for ordinary user turns", async () => {
    const inboundContext = 'Conversation info:\n```json\n{"chat_id":"discord:channel-123"}\n```';
    buildInboundUserContextPrefix.mockReturnValue(inboundContext);

    const result = await prepareReplyRunContext(createParams("discord", false));

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") {
      throw new Error("expected ready reply context");
    }
    expect(buildInboundUserContextPrefix).toHaveBeenCalledOnce();
    expect(result.promptEnvelopeBase.currentInboundContext?.text).toBe(inboundContext);
  });
});
