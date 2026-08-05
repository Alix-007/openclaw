// Real-transport regression proof for Ollama embedding error redaction.
// Drives the production embedding path through the real SSRF guard and loopback
// sockets, without mocking global fetch, SSRF runtime, or logging redaction.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaEmbeddingProvider } from "./embedding-provider.js";

type OllamaRequest = {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  proxyAuth: string | undefined;
  body: string;
};

type OllamaServer = {
  baseUrl: string;
  requests: OllamaRequest[];
};

const servers: Array<{ close: () => Promise<void> }> = [];
const PROOF_MARKER = "[ollama credential redaction proof]";

function printProof(params: {
  status: number;
  safeMarkerPresent: boolean;
  customSecretAbsent: boolean;
  authorizationSecretAbsent: boolean;
  successVectorControl: boolean;
}): void {
  console.info(
    `${PROOF_MARKER} status=${params.status} safe-marker-present=${params.safeMarkerPresent} custom-secret-absent=${params.customSecretAbsent} authorization-secret-absent=${params.authorizationSecretAbsent} success-vector-control=${params.successVectorControl}`,
  );
}

async function startOllamaServer(
  respond: (request: OllamaRequest) => { status: number; body: string },
): Promise<OllamaServer> {
  const requests: OllamaRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const request: OllamaRequest = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        proxyAuth:
          typeof req.headers["x-proxy-auth"] === "string" ? req.headers["x-proxy-auth"] : undefined,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(request);
      const response = respond(request);
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(response.body);
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  servers.push({
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  });

  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests };
}

function createOptions(baseUrl: string, apiKey: string) {
  return {
    config: {},
    provider: "ollama",
    model: "test-embedding",
    fallback: "none",
    remote: { baseUrl, apiKey },
  } as Parameters<typeof createOllamaEmbeddingProvider>[0];
}

async function captureEmbeddingError(
  options: Parameters<typeof createOllamaEmbeddingProvider>[0],
): Promise<Error | undefined> {
  const { provider } = await createOllamaEmbeddingProvider(options);
  try {
    await provider.embedQuery("hello");
  } catch (error) {
    return error as Error;
  }
  return undefined;
}

describe("Ollama embedding provider real transport", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    const pending = servers.splice(0);
    await Promise.all(pending.map((server) => server.close()));
  });

  it("redacts reflected request credentials from embed errors", async () => {
    const apiKey = "gho_AAAAUNIQUEOLLAMASECRETXXXX111122223333";
    const server = await startOllamaServer((request) => ({
      status: 429,
      body: JSON.stringify({
        error: "rate limit exceeded",
        authorization: request.authorization,
      }),
    }));

    const error = await captureEmbeddingError(createOptions(server.baseUrl, apiKey));

    expect(server.requests).toEqual([
      {
        method: "POST",
        url: "/api/embed",
        authorization: `Bearer ${apiKey}`,
        proxyAuth: undefined,
        body: JSON.stringify({ model: "test-embedding", input: "hello" }),
      },
    ]);
    expect(error?.message).toContain("Ollama embed HTTP 429");
    expect(error?.message).toContain("rate limit exceeded");
    expect(error?.message).not.toContain(apiKey);
    expect(error?.message).not.toContain("UNIQUEOLLAMASECRET");
    printProof({
      status: 429,
      safeMarkerPresent: error?.message.includes("rate limit exceeded") === true,
      customSecretAbsent: true,
      authorizationSecretAbsent: error ? !error.message.includes(apiKey) : false,
      successVectorControl: false,
    });
  });

  it("redacts a reflected custom SecretRef header from embed errors", async () => {
    const proxyAuth = "proxy_AAAAUNIQUEOLLAMAPROXYSECRETXXXX11112222";
    vi.stubEnv("OLLAMA_PROXY_AUTH", proxyAuth);
    const server = await startOllamaServer((request) => ({
      status: 403,
      body: JSON.stringify({ error: "forbidden", upstreamEcho: request.proxyAuth }),
    }));

    const error = await captureEmbeddingError({
      config: {
        models: {
          providers: {
            ollama: {
              baseUrl: server.baseUrl,
              models: [],
              headers: {
                "X-Proxy-Auth": {
                  source: "env",
                  provider: "default",
                  id: "OLLAMA_PROXY_AUTH",
                },
              },
            },
          },
        },
      },
      provider: "ollama",
      model: "test-embedding",
      fallback: "none",
    } as Parameters<typeof createOllamaEmbeddingProvider>[0]);

    expect(server.requests).toEqual([
      {
        method: "POST",
        url: "/api/embed",
        authorization: undefined,
        proxyAuth,
        body: JSON.stringify({ model: "test-embedding", input: "hello" }),
      },
    ]);
    expect(error?.message).toContain("Ollama embed HTTP 403");
    expect(error?.message).toContain("forbidden");
    expect(error?.message).not.toContain(proxyAuth);
    expect(error?.message).not.toContain("UNIQUEOLLAMAPROXYSECRET");
    printProof({
      status: 403,
      safeMarkerPresent: error?.message.includes("forbidden") === true,
      customSecretAbsent: error ? !error.message.includes(proxyAuth) : false,
      authorizationSecretAbsent: true,
      successVectorControl: false,
    });
  });

  it("returns normalized vectors on a successful response", async () => {
    const apiKey = "ollama_test_success_credential";
    const proxyAuth = "ollama_test_success_proxy_credential";
    const server = await startOllamaServer(() => ({
      status: 200,
      body: JSON.stringify({ embeddings: [[3, 4]] }),
    }));
    const options = createOptions(server.baseUrl, apiKey);
    if (!options.remote) {
      throw new Error("expected remote embedding options");
    }
    options.remote.headers = { "X-Proxy-Auth": proxyAuth };
    const { provider } = await createOllamaEmbeddingProvider(options);

    const vector = await provider.embedQuery("hello");

    expect(server.requests).toEqual([
      {
        method: "POST",
        url: "/api/embed",
        authorization: `Bearer ${apiKey}`,
        proxyAuth,
        body: JSON.stringify({ model: "test-embedding", input: "hello" }),
      },
    ]);
    expect(vector[0]).toBeCloseTo(0.6, 5);
    expect(vector[1]).toBeCloseTo(0.8, 5);
    const renderedVector = JSON.stringify(vector);
    printProof({
      status: 200,
      safeMarkerPresent: false,
      customSecretAbsent: !renderedVector.includes(proxyAuth),
      authorizationSecretAbsent: !renderedVector.includes(apiKey),
      successVectorControl: vector.length === 2,
    });
  });
});
