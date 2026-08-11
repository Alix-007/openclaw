import { installPinnedHostnameTestHooks } from "openclaw/plugin-sdk/test-media-understanding";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGoogleSpeechProvider } from "./speech-provider.js";

describe("Google speech provider request context", () => {
  installPinnedHostnameTestHooks();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redacts the final Google API key from reflected provider diagnostics", async () => {
    const apiKey = "orchidRiver17glassMoth92cabin";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: apiKey, code: apiKey, type: apiKey } }), {
          status: 401,
          headers: { "x-request-id": apiKey },
        }),
      ),
    );
    const provider = buildGoogleSpeechProvider();

    let error: unknown;
    try {
      await provider.synthesize({
        text: "hello",
        cfg: {},
        providerConfig: { apiKey },
        target: "audio-file",
        timeoutMs: 5_000,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(`${(error as Error).message}\n${JSON.stringify(error)}`).not.toContain(apiKey);
  });
});
