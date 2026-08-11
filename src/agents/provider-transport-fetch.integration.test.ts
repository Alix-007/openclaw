import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import type { Model } from "openclaw/plugin-sdk/llm";
import { afterEach, describe, expect, it } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../config/config.js";
import { NON_ENV_SECRETREF_MARKER } from "./model-auth-markers.js";
import { applyAuthHeaderOverride } from "./model-auth-model.js";
import { createProviderHttpError } from "./provider-http-errors.js";
import { resolveProviderRequestConfig } from "./provider-request-config.js";
import { unwrapModelHeaderSentinelsForProviderEgress } from "./provider-secret-egress.js";
import { buildGuardedModelFetch } from "./provider-transport-fetch.js";

async function withProviderServer<T>(
  handler: RequestListener,
  run: (baseUrl: string) => Promise<T>,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const port = (server.address() as AddressInfo).port;
    return await run(`http://127.0.0.1:${port}/v1`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

function modelWithHeaders(params: {
  id: string;
  provider: string;
  baseUrl: string;
  headers?: Record<string, string | null>;
}): Model<"openai-responses"> {
  return {
    id: params.id,
    provider: params.provider,
    api: "openai-responses",
    baseUrl: params.baseUrl,
    headers: params.headers,
  } as unknown as Model<"openai-responses">;
}

function errorDiagnostics(error: Error): string {
  return `${error.message}\n${JSON.stringify(error)}`;
}

describe("guarded model fetch request-secret context", () => {
  afterEach(() => clearRuntimeConfigSnapshot());

  it("redacts reflected configured header values with arbitrary names", async () => {
    const authSecret = "orchid-cloud-access-314159";
    const providerSecret = "willow-route-proof-271828";
    await withProviderServer(
      (_request, response) => {
        response.writeHead(401, {
          "content-type": "application/json",
          "x-request-id": authSecret,
        });
        response.end(
          JSON.stringify({
            error: {
              message: `safe=quota-exceeded ${authSecret} ${providerSecret}`,
              code: authSecret,
              type: providerSecret,
            },
          }),
        );
      },
      async (baseUrl) => {
        const request = resolveProviderRequestConfig({
          provider: "custom-header-provider",
          api: "openai-responses",
          baseUrl,
          providerHeaders: { "X-Route-Proof": providerSecret },
          request: {
            auth: { mode: "header", headerName: "X-Cloud-Access", value: authSecret },
          },
        });
        const model = modelWithHeaders({
          id: "custom-header-model",
          provider: "custom-header-provider",
          baseUrl,
          headers: request.headers,
        });
        const response = await buildGuardedModelFetch(model, undefined, { sanitizeSse: false })(
          `${baseUrl}/responses`,
          { method: "POST", headers: request.headers, body: "{}" },
        );
        const error = await createProviderHttpError(response, "Custom provider request failed");
        const diagnostics = errorDiagnostics(error);

        expect(diagnostics).toContain("safe=quota-exceeded");
        expect(diagnostics).not.toContain(authSecret);
        expect(diagnostics).not.toContain(providerSecret);
      },
    );
  });

  it("keeps header provenance through sentinel, auth, and egress projections", async () => {
    const providerSecret = "orchid-provider-proof-57721";
    const managedSecret = "willow-managed-proof-65537";
    const authSecret = "maple-auth-proof-99991";
    const received: Record<string, string | undefined> = {};
    await withProviderServer(
      (request, response) => {
        received.provider = request.headers["x-provider-proof"] as string | undefined;
        received.managed = request.headers["x-managed"] as string | undefined;
        received.authorization = request.headers.authorization;
        response.writeHead(401, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              message: `safe=denied ${providerSecret} ${managedSecret} ${authSecret}`,
              code: providerSecret,
              type: managedSecret,
            },
          }),
        );
      },
      async (baseUrl) => {
        const sourceProvider = {
          api: "openai-responses" as const,
          baseUrl,
          authHeader: true,
          headers: {
            "X-Provider-Proof": providerSecret,
            "X-Managed": NON_ENV_SECRETREF_MARKER,
          },
          models: [],
        };
        const sourceConfig = { models: { providers: { projection: sourceProvider } } };
        const runtimeProvider = {
          ...sourceProvider,
          headers: { "X-Provider-Proof": providerSecret, "X-Managed": managedSecret },
        };
        setRuntimeConfigSnapshot(
          { models: { providers: { projection: runtimeProvider } } },
          sourceConfig,
        );
        const request = resolveProviderRequestConfig({
          provider: "projection",
          api: "openai-responses",
          baseUrl,
          providerHeaders: runtimeProvider.headers,
        });
        const prepared = applyAuthHeaderOverride(
          modelWithHeaders({
            id: "projection-model",
            provider: "projection",
            baseUrl,
            headers: request.headers,
          }),
          { apiKey: authSecret, source: "test", mode: "api-key" },
          sourceConfig,
        );
        const model = unwrapModelHeaderSentinelsForProviderEgress(prepared, "integration egress");
        const response = await buildGuardedModelFetch(model, undefined, { sanitizeSse: false })(
          `${baseUrl}/responses`,
          { method: "POST", headers: model.headers, body: "{}" },
        );
        const error = await createProviderHttpError(response, "Projected provider request failed");
        const diagnostics = errorDiagnostics(error);

        expect(received).toEqual({
          provider: providerSecret,
          managed: managedSecret,
          authorization: `Bearer ${authSecret}`,
        });
        expect(diagnostics).toContain("safe=denied");
        for (const secret of [providerSecret, managedSecret, authSecret]) {
          expect(diagnostics).not.toContain(secret);
        }
      },
    );
  });

  it("redacts final request credentials from invalid streamed response bodies", async () => {
    const headerSecret = "maple-cloud-access-161803";
    const querySecret = "cedar-query-access-141421";
    await withProviderServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<html>safe=wrong-endpoint ${headerSecret} ${querySecret}</html>`);
      },
      async (baseUrl) => {
        const request = resolveProviderRequestConfig({
          provider: "custom-header-provider",
          api: "openai-responses",
          baseUrl,
          request: {
            auth: { mode: "header", headerName: "X-Cloud-Access", value: headerSecret },
          },
        });
        const model = modelWithHeaders({
          id: "invalid-content-model",
          provider: "custom-header-provider",
          baseUrl,
          headers: request.headers,
        });
        const error = await buildGuardedModelFetch(model)(
          `${baseUrl}/responses?access_token=${encodeURIComponent(querySecret)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", ...request.headers },
            body: JSON.stringify({ model: model.id, stream: true }),
          },
        ).catch((cause: unknown) => cause);
        const diagnostics = errorDiagnostics(error as Error);

        expect(error).toMatchObject({
          name: "ProviderHttpError",
          code: "invalid_provider_content_type",
        });
        expect(diagnostics).toContain("safe=wrong-endpoint");
        expect(diagnostics).not.toContain(headerSecret);
        expect(diagnostics).not.toContain(querySecret);
      },
    );
  });
});
