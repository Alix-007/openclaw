import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  persistSessionTranscriptTurn,
  upsertSessionEntryCore,
} from "../src/config/sessions/session-accessor.js";
import type { SessionsPreviewResult } from "../src/gateway/session-utils.types.js";
import { connectGatewayClient, disconnectGatewayClient } from "../src/gateway/test-helpers.e2e.js";
import { resolveOpenClawAgentSqlitePath } from "../src/state/openclaw-agent-db.paths.js";
import {
  createOpenClawTestInstance,
  type OpenClawTestInstance,
} from "./helpers/openclaw-test-instance.js";

const EXPECTED_HEAD = "bd69181013ac983d934da5945825cf0b9335be3e";
const ARTIFACT_DIR = path.resolve(".local/pr125201-proof");
const ASCII_SESSION_KEY = "agent:main:proof:preview-ascii";
const UTF16_SESSION_KEY = "agent:main:proof:preview-utf16";

const instances: OpenClawTestInstance[] = [];

afterEach(async () => {
  await Promise.allSettled(instances.splice(0).map((instance) => instance.cleanup()));
});

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return true;
    }
  }
  return false;
}

async function seedSession(params: {
  instance: OpenClawTestInstance;
  sessionId: string;
  sessionKey: string;
  assistantText: string;
}): Promise<void> {
  const agentId = "main";
  const storePath = path.join(params.instance.state.sessionsDir(agentId), "sessions.json");
  const scope = {
    agentId,
    env: params.instance.state.env,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    storePath,
  };
  await upsertSessionEntryCore(scope, {
    sessionId: params.sessionId,
    status: "done",
    updatedAt: Date.parse("2026-08-17T00:00:00.000Z"),
  });
  const turn = await persistSessionTranscriptTurn(scope, {
    expectedSessionId: params.sessionId,
    messages: [
      {
        now: Date.parse("2026-08-17T00:00:01.000Z"),
        message: { role: "toolResult", content: "not visible in session preview" },
      },
      {
        now: Date.parse("2026-08-17T00:00:02.000Z"),
        message: { role: "assistant", content: params.assistantText },
      },
    ],
    touchSessionEntry: false,
    updateMode: "none",
  });
  expect(turn.appendedCount).toBe(2);
}

function previewText(result: SessionsPreviewResult): string {
  expect(result.previews).toHaveLength(1);
  expect(result.previews[0]?.status).toBe("ok");
  expect(result.previews[0]?.items).toHaveLength(1);
  expect(result.previews[0]?.items[0]?.role).toBe("assistant");
  const text = result.previews[0]?.items[0]?.text;
  expect(typeof text).toBe("string");
  return text ?? "";
}

it(
  "proves exact preview budgets through real SQLite and Gateway RPC",
  { timeout: 600_000 },
  async () => {
    expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(
      EXPECTED_HEAD,
    );
    const instance = await createOpenClawTestInstance({
      name: "pr125201-session-preview",
      config: {
        agents: { defaults: { heartbeat: { every: "0m" }, skills: [] } },
        plugins: { enabled: false },
      },
      env: { OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1" },
      startTimeoutMs: 180_000,
      stopTimeoutMs: 10_000,
    });
    instances.push(instance);

    await seedSession({
      instance,
      sessionId: "pr125201-preview-ascii",
      sessionKey: ASCII_SESSION_KEY,
      assistantText: "a".repeat(1_000),
    });
    await seedSession({
      instance,
      sessionId: "pr125201-preview-utf16",
      sessionKey: UTF16_SESSION_KEY,
      assistantText: `${"a".repeat(236)}🙂tail`,
    });

    const databasePath = resolveOpenClawAgentSqlitePath({
      agentId: "main",
      env: instance.state.env,
    });
    expect((await fs.stat(databasePath)).isFile()).toBe(true);

    await instance.startGateway();
    const client = await connectGatewayClient({
      url: instance.url,
      token: instance.gatewayToken,
      role: "operator",
      scopes: ["operator.read"],
      requestTimeoutMs: 30_000,
      timeoutMs: 30_000,
    });
    try {
      const explicit = await client.request<SessionsPreviewResult>("sessions.preview", {
        keys: [ASCII_SESSION_KEY],
        limit: 4,
        maxChars: 800,
      });
      const defaultBudget = await client.request<SessionsPreviewResult>("sessions.preview", {
        keys: [ASCII_SESSION_KEY],
        limit: 4,
      });
      const utf16Boundary = await client.request<SessionsPreviewResult>("sessions.preview", {
        keys: [UTF16_SESSION_KEY],
        limit: 4,
      });

      const explicitText = previewText(explicit);
      const defaultText = previewText(defaultBudget);
      const utf16Text = previewText(utf16Boundary);
      expect(explicitText).toBe(`${"a".repeat(797)}...`);
      expect(explicitText).toHaveLength(800);
      expect(defaultText).toBe(`${"a".repeat(237)}...`);
      expect(defaultText).toHaveLength(240);
      expect(utf16Text).toBe(`${"a".repeat(236)}...`);
      expect(hasUnpairedSurrogate(explicitText)).toBe(false);
      expect(hasUnpairedSurrogate(defaultText)).toBe(false);
      expect(hasUnpairedSurrogate(utf16Text)).toBe(false);

      await fs.mkdir(ARTIFACT_DIR, { recursive: true });
      const rpcResponses = `${JSON.stringify({ explicit, defaultBudget, utf16Boundary }, null, 2)}\n`;
      await fs.writeFile(path.join(ARTIFACT_DIR, "rpc-responses.json"), rpcResponses);
      const result = {
        verdict: "PASS",
        head: EXPECTED_HEAD,
        node: process.version,
        sqlite: { databaseCreated: true, seededSessions: 2, seededTranscriptRows: 4 },
        gateway: { authenticatedWebSocketRpc: true, method: "sessions.preview" },
        explicit: {
          requestedMaxChars: 800,
          returnedCodeUnits: explicitText.length,
          visibleItems: explicit.previews[0]?.items.length,
          utf16Safe: !hasUnpairedSurrogate(explicitText),
        },
        defaultBudget: {
          maxCharsOmitted: true,
          returnedCodeUnits: defaultText.length,
          utf16Safe: !hasUnpairedSurrogate(defaultText),
        },
        utf16Boundary: {
          splitAvoided: true,
          returnedCodeUnits: utf16Text.length,
          utf16Safe: !hasUnpairedSurrogate(utf16Text),
        },
        rpcResponsesSha256: createHash("sha256").update(rpcResponses).digest("hex"),
      };
      const artifact = `${JSON.stringify(result, null, 2)}\n`;
      await fs.writeFile(path.join(ARTIFACT_DIR, "result.json"), artifact);
      const sha256 = createHash("sha256").update(artifact).digest("hex");
      process.stdout.write(
        `PR125201_REAL_GATEWAY_PROOF ${JSON.stringify({ ...result, sha256 })}\n`,
      );
    } finally {
      await disconnectGatewayClient(client);
    }
  },
);
