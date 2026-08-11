import { describe, expect, it, vi } from "vitest";
import { installPinnedHostnameTestHooks } from "./audio.test-helpers.js";
import { postJsonRequest, resolveProviderHttpRequestConfig } from "./shared.js";

describe("shared provider error redaction", () => {
  installPinnedHostnameTestHooks();

  it("redacts reflected outbound credentials from transient JSON POST errors", async () => {
    const credential = "orchid-request-secret-123456";
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: `upstream reflected ${credential}; safe=rate-limited`,
              code: credential,
              type: `quota-${credential}`,
            },
          }),
          { status: 429, headers: { "x-request-id": `request-${credential}` } },
        ),
    );

    const error = await postJsonRequest({
      url: "https://api.example.com/v1/analyze",
      headers: new Headers({ authorization: `Bearer ${credential}` }),
      body: { media: "base64" },
      fetchFn,
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
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("carries configured arbitrary header provenance through the guarded HTTP owner", async () => {
    const authSecret = "orchid-cloud-access-314159";
    const configuredHeaderSecret = "willow-route-proof-271828";
    const ordinaryDefault = "client-build-42";
    const { headers } = resolveProviderHttpRequestConfig({
      baseUrl: "https://api.example.com/v1",
      defaultBaseUrl: "https://api.example.com/v1",
      headers: { "X-Route-Proof": configuredHeaderSecret },
      defaultHeaders: { "X-Client-Version": ordinaryDefault },
      request: {
        auth: { mode: "header", headerName: "X-Cloud-Access", value: authSecret },
      },
      provider: "custom-media",
      capability: "image",
      transport: "http",
    });
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: `${ordinaryDefault} ${authSecret} ${configuredHeaderSecret}`,
              code: authSecret,
              type: configuredHeaderSecret,
            },
          }),
          { status: 429 },
        ),
    );

    const error = await postJsonRequest({
      url: "https://api.example.com/v1/images",
      headers,
      body: { prompt: "safe" },
      fetchFn,
      retryStage: "read",
      retry: { attempts: 1 },
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    const diagnostics = `${(error as Error).message}\n${JSON.stringify(error)}`;

    expect(diagnostics).toContain(ordinaryDefault);
    expect(diagnostics).not.toContain(authSecret);
    expect(diagnostics).not.toContain(configuredHeaderSecret);
  });
});
