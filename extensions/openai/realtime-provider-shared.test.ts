// Openai tests cover realtime session secret creation behavior.
import { installPinnedHostnameTestHooks } from "openclaw/plugin-sdk/test-media-understanding";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAIRealtimeClientSecret,
  createOpenAIRealtimeTranscriptionClientSecret,
} from "./realtime-provider-shared.js";

function makeStreamingResponse(params: { chunkCount: number; chunkSize: number }): {
  response: Response;
  getReadCount: () => number;
  wasCanceled: () => boolean;
} {
  let readCount = 0;
  let canceled = false;
  const chunk = new Uint8Array(params.chunkSize);
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (readCount >= params.chunkCount) {
          controller.close();
          return;
        }
        readCount += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        canceled = true;
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
  return { response, getReadCount: () => readCount, wasCanceled: () => canceled };
}

function guardedFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createOpenAIRealtimeClientSecret", () => {
  installPinnedHostnameTestHooks();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns client secret from a well-formed response", async () => {
    const fetchMock = guardedFetch(
      new Response(
        JSON.stringify({
          client_secret: { value: "eph-secret-abc" },
          expires_at: Math.floor(Date.now() / 1000) + 60,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await createOpenAIRealtimeClientSecret({
      authToken: "sk-test",
      auditContext: "test",
      session: { model: "gpt-4o-realtime-preview" },
    });

    expect(result.value).toBe("eph-secret-abc");
    expect(typeof result.expiresAt).toBe("number");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("bounds oversized success response and cancels the stream", async () => {
    // 20 MiB in 1 MiB chunks — well over the 16 MiB cap
    const streamed = makeStreamingResponse({ chunkCount: 20, chunkSize: 1024 * 1024 });
    guardedFetch(streamed.response);

    await expect(
      createOpenAIRealtimeClientSecret({
        authToken: "sk-test",
        auditContext: "test",
        session: { model: "gpt-4o-realtime-preview" },
      }),
    ).rejects.toThrow(/openai\.realtime-session/);

    expect(streamed.wasCanceled()).toBe(true);
    expect(streamed.getReadCount()).toBeLessThan(20);
  });

  it("throws the provider error label on oversized body", async () => {
    const streamed = makeStreamingResponse({ chunkCount: 20, chunkSize: 1024 * 1024 });
    guardedFetch(streamed.response);

    await expect(
      createOpenAIRealtimeTranscriptionClientSecret({
        authToken: "sk-test",
        auditContext: "test",
        session: { model: "gpt-4o-transcribe" },
      }),
    ).rejects.toThrow(/openai\.realtime-session/);

    expect(streamed.wasCanceled()).toBe(true);
  });

  it("creates transcription secrets through the current client-secrets endpoint", async () => {
    const fetchMock = guardedFetch(
      new Response(JSON.stringify({ value: "ek-transcription", expires_at: 1_800_000_000 }), {
        status: 200,
      }),
    );

    await createOpenAIRealtimeTranscriptionClientSecret({
      authToken: "sk-test",
      auditContext: "test",
      session: { type: "transcription" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/client_secrets",
      expect.objectContaining({
        body: JSON.stringify({ session: { type: "transcription" } }),
      }),
    );
  });

  it("replaces rejected transcription API-key details with bounded guidance", async () => {
    guardedFetch(
      new Response(JSON.stringify({ error: { message: "Incorrect API key provided: secret" } }), {
        status: 401,
      }),
    );

    await expect(
      createOpenAIRealtimeTranscriptionClientSecret({
        authToken: "sk-test",
        auditContext: "test",
        session: { type: "transcription" },
        authRejectedMessage: "Update the transcription API key",
      }),
    ).rejects.toThrow("Update the transcription API key");
  });

  it("redacts a reflected final auth token from realtime provider errors", async () => {
    const authToken = "orchid/River17glassMoth92cabin";
    guardedFetch(
      new Response(
        JSON.stringify({
          error: {
            message: `provider reflected ${authToken}`,
            code: authToken,
            type: authToken,
          },
        }),
        { status: 400, headers: { "x-request-id": authToken } },
      ),
    );

    const error = await createOpenAIRealtimeClientSecret({
      authToken,
      auditContext: "test",
      session: { model: "gpt-4o-realtime-preview" },
    }).catch((cause: unknown) => cause);
    const diagnostics = `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(error)}`;

    expect(diagnostics).not.toContain(authToken);
    expect(diagnostics).toContain("***");
  });
});
