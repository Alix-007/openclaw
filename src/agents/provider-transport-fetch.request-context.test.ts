import type { Model } from "openclaw/plugin-sdk/llm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWithSsrFGuardMock } = vi.hoisted(() => ({
  fetchWithSsrFGuardMock: vi.fn(),
}));

vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard: fetchWithSsrFGuardMock,
  withTrustedEnvProxyGuardedFetchMode: (params: unknown) => params,
}));

vi.mock("./provider-local-service.js", () => ({
  ensureModelProviderLocalService: vi.fn(async () => undefined),
}));

vi.mock("./provider-request-config.js", () => ({
  buildProviderRequestDispatcherPolicy: vi.fn(() => undefined),
  getModelProviderMetadataOwners: vi.fn(() => undefined),
  getModelProviderRequestTransport: vi.fn(() => undefined),
  mergeModelProviderRequestOverrides: vi.fn((current, overrides) => ({
    ...current,
    ...overrides,
  })),
  resolveProviderRequestPolicyConfig: vi.fn(() => ({ allowPrivateNetwork: false })),
}));

import { recordGuardedResponseRequestContext } from "../infra/net/guarded-response-request-context.js";
import { createProviderHttpError } from "./provider-http-errors.js";
import { buildGuardedModelFetch } from "./provider-transport-fetch.js";

describe("guarded model fetch request context", () => {
  beforeEach(() => {
    fetchWithSsrFGuardMock.mockReset();
  });

  it("inherits final request context across its managed Response reconstruction", async () => {
    const secret = "frostedPine41hiddenValley";
    const source = recordGuardedResponseRequestContext(
      new Response(JSON.stringify({ error: { message: `reflected ${secret}` } }), {
        status: 401,
      }),
      {
        headers: { authorization: `Bearer ${secret}` },
        url: "https://api.openai.com/v1/responses",
      },
    );
    fetchWithSsrFGuardMock.mockResolvedValue({
      response: source,
      finalUrl: "https://api.openai.com/v1/responses",
      release: vi.fn(async () => undefined),
    });
    const model = {
      id: "gpt-5.5",
      provider: "openai",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
    } as unknown as Model<"openai-responses">;

    const response = await buildGuardedModelFetch(model, undefined, { sanitizeSse: false })(
      "https://api.openai.com/v1/responses",
    );
    const error = await createProviderHttpError(response, "OpenAI request failed");

    expect(response).not.toBe(source);
    expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(secret);
  });
});
