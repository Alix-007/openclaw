import { describe, expect, it, vi } from "vitest";
import { fetchProviderOperationResponse, resolveProviderHttpRequestConfig } from "./shared.js";

describe("raw provider operation request context", () => {
  it("redacts request headers and initial/final signed URL values from reflected errors", async () => {
    const headerSecret = "orchidHeader71silverMeadow";
    const initialQuerySecret = "cobaltSignature83hiddenHarbor";
    const finalQuerySecret = "violetDelivery52quietRidge";
    const fetchFn = vi.fn(async () => {
      const response = new Response(
        JSON.stringify({
          error: {
            message: `${headerSecret} ${initialQuerySecret} ${finalQuerySecret}`,
            code: initialQuerySecret,
            type: headerSecret,
          },
        }),
        { status: 401, headers: { "x-request-id": finalQuerySecret } },
      );
      Object.defineProperty(response, "url", {
        value: `https://redirect.example.test/output?access_token=${finalQuerySecret}`,
      });
      return response;
    });

    let error: unknown;
    try {
      await fetchProviderOperationResponse({
        stage: "download",
        url: `https://cdn.example.test/output?signature=${initialQuerySecret}`,
        init: { headers: { authorization: `Bearer ${headerSecret}` } },
        fetchFn,
        requestFailedMessage: "download failed",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const diagnostics = `${(error as Error).message}\n${JSON.stringify(error)}`;
    expect(diagnostics).not.toContain(headerSecret);
    expect(diagnostics).not.toContain(initialQuerySecret);
    expect(diagnostics).not.toContain(finalQuerySecret);
  });

  it("redacts arbitrary configured headers on the raw download fallback", async () => {
    const headerSecret = "orchidCustomHeader71silverMeadow";
    const { headers } = resolveProviderHttpRequestConfig({
      baseUrl: "https://api.example.test/v1",
      defaultBaseUrl: "https://api.example.test/v1",
      request: {
        auth: { mode: "header", headerName: "X-Cloud-Access", value: headerSecret },
      },
      provider: "custom-video",
      capability: "video",
      transport: "http",
    });
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: headerSecret, code: headerSecret } }), {
          status: 401,
        }),
    );

    const error = await fetchProviderOperationResponse({
      stage: "download",
      url: "https://api.example.test/v1/video",
      init: { headers },
      fetchFn,
      requestFailedMessage: "download failed",
    }).catch((cause: unknown) => cause);
    const diagnostics = `${(error as Error).message}\n${JSON.stringify(error)}`;

    expect(error).toBeInstanceOf(Error);
    expect(diagnostics).not.toContain(headerSecret);
  });
});
