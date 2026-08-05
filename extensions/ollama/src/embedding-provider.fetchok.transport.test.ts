// Real-transport regression proof for Ollama embedding error redaction.
// Drives the production embedding path through the real SSRF guard and loopback
// sockets, without mocking global fetch, SSRF runtime, or logging redaction.
import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOllamaEmbeddingProvider } from "./embedding-provider.js";

type OllamaRequest = {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: string;
};

type OllamaServer = {
  baseUrl: string;
  requests: OllamaRequest[];
};

const servers: Array<{ close: () => Promise<void> }> = [];

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

function withRedactionDisabledConfig(): () => void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-redact-off-"));
  const configPath = path.join(dir, "openclaw.json");
  fs.writeFileSync(configPath, JSON.stringify({ logging: { redactSensitive: "off" } }));
  const previous = process.env.OPENCLAW_CONFIG_PATH;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  return () => {
    if (previous === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

async function captureEmbeddingError(params: {
  baseUrl: string;
  apiKey: string;
}): Promise<Error | undefined> {
  const { provider } = await createOllamaEmbeddingProvider(
    createOptions(params.baseUrl, params.apiKey),
  );
  try {
    await provider.embedQuery("hello");
  } catch (error) {
    return error as Error;
  }
  return undefined;
}

describe("Ollama embedding provider real transport", () => {
  afterEach(async () => {
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

    const error = await captureEmbeddingError({ baseUrl: server.baseUrl, apiKey });

    expect(server.requests).toEqual([
      {
        method: "POST",
        url: "/api/embed",
        authorization: `Bearer ${apiKey}`,
        body: JSON.stringify({ model: "test-embedding", input: "hello" }),
      },
    ]);
    expect(error?.message).toContain("Ollama embed HTTP 429");
    expect(error?.message).toContain("rate limit exceeded");
    expect(error?.message).not.toContain(apiKey);
    expect(error?.message).not.toContain("UNIQUEOLLAMASECRET");
  });

  it("still redacts reflected credentials when logging.redactSensitive is off", async () => {
    const restoreConfig = withRedactionDisabledConfig();
    try {
      const apiKey = "gho_BBBBUNIQUEOLLAMAOFFSECRETYYYY444455556666";
      const server = await startOllamaServer((request) => ({
        status: 403,
        body: JSON.stringify({ error: "forbidden", authorization: request.authorization }),
      }));

      const error = await captureEmbeddingError({ baseUrl: server.baseUrl, apiKey });

      expect(error?.message).toContain("Ollama embed HTTP 403");
      expect(error?.message).toContain("forbidden");
      expect(error?.message).not.toContain(apiKey);
      expect(error?.message).not.toContain("UNIQUEOLLAMAOFFSECRET");
    } finally {
      restoreConfig();
    }
  });

  it("returns normalized vectors on a successful response", async () => {
    const apiKey = "ollama_test_success_credential";
    const server = await startOllamaServer(() => ({
      status: 200,
      body: JSON.stringify({ embeddings: [[3, 4]] }),
    }));
    const { provider } = await createOllamaEmbeddingProvider(createOptions(server.baseUrl, apiKey));

    const vector = await provider.embedQuery("hello");

    expect(server.requests).toEqual([
      {
        method: "POST",
        url: "/api/embed",
        authorization: `Bearer ${apiKey}`,
        body: JSON.stringify({ model: "test-embedding", input: "hello" }),
      },
    ]);
    expect(vector[0]).toBeCloseTo(0.6, 5);
    expect(vector[1]).toBeCloseTo(0.8, 5);
  });
});
