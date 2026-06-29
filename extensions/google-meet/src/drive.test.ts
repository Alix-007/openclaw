// Google Meet tests cover bounded Drive document export response reads.
import { describe, expect, it, vi } from "vitest";
import { exportGoogleDriveDocumentText } from "./drive.js";

vi.mock("openclaw/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: vi.fn(),
}));

// Wrap readProviderTextResponse in a vi.fn so we can spy or replace it in mutation tests.
// The default implementation delegates to the real bounded reader; other tests are unaffected.
vi.mock("openclaw/plugin-sdk/provider-http", async (importActual) => {
  const actual = await importActual<typeof import("openclaw/plugin-sdk/provider-http")>();
  return {
    ...actual,
    readProviderTextResponse: vi.fn(actual.readProviderTextResponse),
  };
});

import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { readProviderTextResponse } from "openclaw/plugin-sdk/provider-http";

const mockFetch = vi.mocked(fetchWithSsrFGuard);
const mockReadText = vi.mocked(readProviderTextResponse);

function makeStreamResponse(sizeBytes: number, status = 200): Response {
  const chunk = new Uint8Array(Math.min(sizeBytes, 65536)).fill(0x78); // 'x'
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= sizeBytes) {
        controller.close();
        return;
      }
      const remaining = sizeBytes - sent;
      const toSend = Math.min(chunk.length, remaining);
      controller.enqueue(chunk.subarray(0, toSend));
      sent += toSend;
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

describe("exportGoogleDriveDocumentText bound", () => {
  it("returns document text when response is within the 16 MiB cap", async () => {
    const UNDER_CAP = 256;
    const response = makeStreamResponse(UNDER_CAP);
    mockFetch.mockResolvedValueOnce({
      response,
      finalUrl: "https://www.googleapis.com/drive/v3/files/doc-id/export?mimeType=text%2Fplain",
      release: vi.fn(async () => undefined),
    });

    const result = await exportGoogleDriveDocumentText({
      accessToken: "tok",
      documentId: "doc-id",
    });

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("rejects with a size error when response exceeds 16 MiB cap (fail-closed)", async () => {
    const OVER_CAP = 17 * 1024 * 1024; // 17 MiB
    const response = makeStreamResponse(OVER_CAP);
    const release = vi.fn(async () => undefined);
    mockFetch.mockResolvedValueOnce({
      response,
      finalUrl: "https://www.googleapis.com/drive/v3/files/doc-id/export?mimeType=text%2Fplain",
      release,
    });

    await expect(
      exportGoogleDriveDocumentText({ accessToken: "tok", documentId: "doc-id" }),
    ).rejects.toThrow(/exceeds/i);

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("negative-control: bare response.text() buffers the full oversized body (no protection)", async () => {
    const OVER_CAP = 17 * 1024 * 1024; // 17 MiB
    const response = makeStreamResponse(OVER_CAP);
    // Calling response.text() directly buffers everything without throwing.
    const text = await response.text();
    expect(text.length).toBeGreaterThan(16 * 1024 * 1024);
  });

  it("mutation: reverted fix (bare response.text) does NOT reject over-cap body — fix is load-bearing", async () => {
    // Replace readProviderTextResponse with bare response.text() to simulate pre-fix behaviour.
    // With this mutation the "rejects with size error" test above would turn red,
    // proving that the real readProviderTextResponse is what enforces the cap.
    mockReadText.mockImplementationOnce(
      (res: Response, _label: string) => res.text(),
    );

    const OVER_CAP = 17 * 1024 * 1024; // 17 MiB
    const response = makeStreamResponse(OVER_CAP);
    const release = vi.fn(async () => undefined);
    mockFetch.mockResolvedValueOnce({
      response,
      finalUrl: "https://www.googleapis.com/drive/v3/files/doc-id/export?mimeType=text%2Fplain",
      release,
    });

    // Should NOT throw — bare text() buffers everything without a cap.
    const result = await exportGoogleDriveDocumentText({ accessToken: "tok", documentId: "doc-id" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(16 * 1024 * 1024);
  });
});
