import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROOF_MARKER = "[ollama configured reverse-proxy proof]";

function randomCredential(): string {
  return randomBytes(24).toString("base64url");
}

const baseUrl = process.env.OLLAMA_PROOF_BASE_URL?.trim();
if (!baseUrl) {
  throw new Error("OLLAMA_PROOF_BASE_URL is required");
}

const proofRoot = await mkdtemp(join(tmpdir(), "openclaw-ollama-configured-proof-"));
const configPath = join(proofRoot, "openclaw.json");
const authorizationCredential = randomCredential();
const proxyAuthorizationCredential = randomCredential();
const customCredential = randomCredential();

process.env.OLLAMA_PROOF_AUTHORIZATION = `Bearer ${authorizationCredential}`;
process.env.OLLAMA_PROOF_PROXY_AUTHORIZATION = `Basic ${proxyAuthorizationCredential}`;
process.env.OLLAMA_PROOF_CUSTOM_AUTH = customCredential;
process.env.OPENCLAW_CONFIG_PATH = configPath;

try {
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        models: {
          providers: {
            ollama: {
              baseUrl,
              models: [],
              headers: {
                Authorization: {
                  source: "env",
                  provider: "default",
                  id: "OLLAMA_PROOF_AUTHORIZATION",
                },
                "Proxy-Authorization": {
                  source: "env",
                  provider: "default",
                  id: "OLLAMA_PROOF_PROXY_AUTHORIZATION",
                },
                "X-Proxy-Auth": {
                  source: "env",
                  provider: "default",
                  id: "OLLAMA_PROOF_CUSTOM_AUTH",
                },
                "X-Proof-Control": "failure",
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const [{ loadConfig }, { createOllamaEmbeddingProvider }] = await Promise.all([
    import("../../../src/config/config.js"),
    import("../../../extensions/ollama/src/embedding-provider.js"),
  ]);
  const config = loadConfig({
    skipPluginValidation: true,
    pin: false,
    skipShellEnvFallback: true,
  });

  const createProvider = async (headers?: Record<string, string>) =>
    (
      await createOllamaEmbeddingProvider({
        config,
        provider: "ollama",
        model: "test-embedding",
        fallback: "none",
        ...(headers ? { remote: { headers } } : {}),
      })
    ).provider;

  const failureProvider = await createProvider();
  let failureMessage = "";
  try {
    await failureProvider.embedQuery("configured reverse proxy failure proof");
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
  }

  const successProvider = await createProvider({ "X-Proof-Control": "success" });
  const vector = await successProvider.embedQuery("configured reverse proxy success proof");

  const result = {
    status429: failureMessage.includes("Ollama embed HTTP 429"),
    safeMarkerPresent: failureMessage.includes("rate limit exceeded"),
    authorizationSecretAbsent: !failureMessage.includes(authorizationCredential),
    proxyAuthorizationSecretAbsent: !failureMessage.includes(proxyAuthorizationCredential),
    customSecretAbsent: !failureMessage.includes(customCredential),
    successVectorControl:
      vector.length === 2 &&
      Math.abs((vector[0] ?? 0) - 0.6) < 0.00001 &&
      Math.abs((vector[1] ?? 0) - 0.8) < 0.00001,
  };

  console.info(
    `${PROOF_MARKER} status-429=${result.status429} safe-marker-present=${result.safeMarkerPresent} authorization-secret-absent=${result.authorizationSecretAbsent} proxy-authorization-secret-absent=${result.proxyAuthorizationSecretAbsent} custom-secret-absent=${result.customSecretAbsent} success-vector-control=${result.successVectorControl}`,
  );

  if (Object.values(result).some((value) => !value)) {
    throw new Error("configured reverse-proxy proof assertions failed");
  }
} finally {
  delete process.env.OLLAMA_PROOF_AUTHORIZATION;
  delete process.env.OLLAMA_PROOF_PROXY_AUTHORIZATION;
  delete process.env.OLLAMA_PROOF_CUSTOM_AUTH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  await rm(proofRoot, { recursive: true, force: true });
}
