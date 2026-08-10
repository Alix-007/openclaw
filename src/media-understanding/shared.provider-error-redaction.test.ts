import { describe, expect, it, vi } from "vitest";

const { fetchWithSsrFGuardMock } = vi.hoisted(() => ({
  fetchWithSsrFGuardMock: vi.fn(),
}));

vi.mock("../infra/net/fetch-guard.js", async () => {
  const actual = await vi.importActual<typeof import("../infra/net/fetch-guard.js")>(
    "../infra/net/fetch-guard.js",
  );
  return { ...actual, fetchWithSsrFGuard: fetchWithSsrFGuardMock };
});

import { postJsonRequest } from "./shared.js";

describe("shared provider error redaction", () => {
  it("redacts reflected outbound credentials from transient JSON POST errors", async () => {
    const release = vi.fn(async () => undefined);
    const credential = "orchid-request-secret-123456";
    fetchWithSsrFGuardMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({
          error: {
            message: `upstream reflected ${credential}; safe=rate-limited`,
            code: credential,
            type: `quota-${credential}`,
          },
        }),
        { status: 429, headers: { "x-request-id": `request-${credential}` } },
      ),
      finalUrl: "https://api.example.com/v1/analyze",
      release,
    });

    const error = await postJsonRequest({
      url: "https://api.example.com/v1/analyze",
      headers: new Headers({ authorization: `Bearer ${credential}` }),
      body: { media: "base64" },
      fetchFn: fetch,
      retryStage: "read",
      retry: { attempts: 1 },
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    const providerError = error as Error & {
      errorBody?: string;
      errorCode?: string;
      errorType?: string;
      requestId?: string;
    };
    expect(providerError.message).toContain("safe=rate-limited");
    expect(
      JSON.stringify({
        message: providerError.message,
        body: providerError.errorBody,
        code: providerError.errorCode,
        type: providerError.errorType,
        requestId: providerError.requestId,
      }),
    ).not.toContain(credential);
    expect(release).toHaveBeenCalledOnce();
  });
});
