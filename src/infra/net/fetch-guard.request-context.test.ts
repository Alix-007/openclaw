import { describe, expect, it, vi } from "vitest";
import { fetchWithSsrFGuard } from "./fetch-guard.js";
import {
  extractSensitiveRequestUrlValues,
  getGuardedResponseRequestContext,
} from "./guarded-response-request-context.js";

type LookupFn = NonNullable<Parameters<typeof fetchWithSsrFGuard>[0]["lookupFn"]>;

const createPublicLookup = (): LookupFn =>
  vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as LookupFn;

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

describe("guarded response request context", () => {
  it("does not mask provider errors when a raw transport reports a non-absolute URL", () => {
    expect(extractSensitiveRequestUrlValues("/relative?token=secret")).toEqual([]);
    expect(extractSensitiveRequestUrlValues("not a URL")).toEqual([]);
  });

  it("records redirect-adjusted final headers and sensitive URL values", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("/next?access_token=final-query-secret"))
      .mockResolvedValueOnce(new Response("ok"));

    const result = await fetchWithSsrFGuard({
      url: "https://api.example.test/start",
      fetchImpl,
      lookupFn: createPublicLookup(),
      init: {
        headers: {
          authorization: "Bearer retained-header-secret",
          "X-Cloud-Access": "retained-custom-secret",
        },
      },
      capture: { sensitiveRequestHeaderNames: ["X-Cloud-Access"] },
    });
    const context = getGuardedResponseRequestContext(result.response);

    expect(context?.requestHeaderEntries).toContainEqual([
      "authorization",
      "Bearer retained-header-secret",
    ]);
    expect(context?.sensitiveUrlValues).toContain("final-query-secret");
    expect(context?.sensitiveRequestHeaderNames).toEqual(["x-cloud-access"]);
    await result.release();
  });

  it("does not record credentials stripped by a cross-origin redirect", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        redirectResponse("https://cdn.example.test/asset?token=delivery-query-secret"),
      )
      .mockResolvedValueOnce(new Response("ok"));

    const result = await fetchWithSsrFGuard({
      url: "https://api.example.test/start",
      fetchImpl,
      lookupFn: createPublicLookup(),
      init: {
        headers: {
          authorization: "Bearer stripped-header-secret",
          "X-Cloud-Access": "stripped-custom-secret",
          accept: "application/json",
        },
      },
      capture: { sensitiveRequestHeaderNames: ["X-Cloud-Access"] },
    });
    const context = getGuardedResponseRequestContext(result.response);

    expect(context?.requestHeaderEntries).not.toContainEqual([
      "authorization",
      "Bearer stripped-header-secret",
    ]);
    expect(context?.requestHeaderEntries).toContainEqual(["accept", "application/json"]);
    expect(context?.requestHeaderEntries).not.toContainEqual([
      "x-cloud-access",
      "stripped-custom-secret",
    ]);
    expect(context?.sensitiveRequestHeaderNames).toEqual([]);
    expect(context?.sensitiveUrlValues).toContain("delivery-query-secret");
    await result.release();
  });
});
