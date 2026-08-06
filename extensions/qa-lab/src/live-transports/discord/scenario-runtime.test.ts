// Qa Lab tests cover the Discord runtime-context live scenario contract.
import { describe, expect, it, vi } from "vitest";
import { runDiscordRuntimeContextRedactionProof } from "./scenario-runtime.js";

function createRuntimeContextHarness(options: { leakWrapperOnly?: boolean } = {}) {
  const sessionMessages: unknown[] = [];
  let messageSequence = 0;
  const deletedMessageIds: string[] = [];
  const deleteMessage = vi.fn(async (messageId: string) => {
    deletedMessageIds.push(messageId);
  });
  const nextMessage = () => ({ id: `message-${++messageSequence}` });
  return {
    deletedMessageIds,
    deleteMessage,
    dependencies: {
      createMarker: (prefix: string) => `${prefix}_SECRET_MARKER`,
      deleteMessage,
      readSessionMessages: async () => [...sessionMessages],
      sendImage: async () => {
        sessionMessages.push({ role: "user", content: "<media:image>" });
        return nextMessage();
      },
      sendText: async (content: string) => {
        if (content.startsWith("VISIBLE_TEXT_SECRET_MARKER")) {
          sessionMessages.push({ role: "user", content: "VISIBLE_TEXT_SECRET_MARKER" });
        } else if (options.leakWrapperOnly) {
          sessionMessages.push({ role: "user", content });
        }
        return nextMessage();
      },
      sleep: async () => undefined,
    },
  };
}

describe("Discord runtime-context redaction scenario", () => {
  it("proves all three session contracts without putting markers in evidence", async () => {
    const harness = createRuntimeContextHarness();

    const proof = await runDiscordRuntimeContextRedactionProof({
      dependencies: harness.dependencies,
      noTurnWindowMs: 0,
      turnTimeoutMs: 10,
    });

    expect(proof.pass).toBe(true);
    expect(proof.cases).toEqual([
      {
        id: "wrapper-only-text-dropped",
        checks: { userTurnCountUnchanged: true, wrapperMarkerAbsent: true },
        pass: true,
      },
      {
        id: "wrapper-only-image-keeps-native-fallback",
        checks: { nativeImageFallbackPresent: true, wrapperMarkerAbsent: true },
        pass: true,
      },
      {
        id: "mixed-visible-text-kept-wrapper-dropped",
        checks: { visibleTextPresent: true, wrapperMarkerAbsent: true },
        pass: true,
      },
    ]);
    expect(JSON.stringify(proof)).not.toContain("SECRET_MARKER");
    expect(harness.deletedMessageIds).toEqual(["message-3", "message-2", "message-1"]);
  });

  it("reports a wrapper-only session leak while still cleaning every message", async () => {
    const harness = createRuntimeContextHarness({ leakWrapperOnly: true });

    const proof = await runDiscordRuntimeContextRedactionProof({
      dependencies: harness.dependencies,
      noTurnWindowMs: 0,
      turnTimeoutMs: 10,
    });

    expect(proof.pass).toBe(false);
    expect(proof.cases[0]).toEqual({
      id: "wrapper-only-text-dropped",
      checks: { userTurnCountUnchanged: false, wrapperMarkerAbsent: false },
      pass: false,
    });
    expect(harness.deletedMessageIds).toEqual(["message-3", "message-2", "message-1"]);
  });

  it("fails closed when any Discord message cannot be deleted", async () => {
    const harness = createRuntimeContextHarness();
    harness.deleteMessage.mockRejectedValueOnce(new Error("sensitive upstream failure"));

    await expect(
      runDiscordRuntimeContextRedactionProof({
        dependencies: harness.dependencies,
        noTurnWindowMs: 0,
        turnTimeoutMs: 10,
      }),
    ).rejects.toThrow("Discord runtime-context proof message cleanup failed");
    expect(harness.deleteMessage).toHaveBeenCalledTimes(3);
  });
});
