// Google provider module implements model/runtime integration.
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
import {
  createWebSearchProviderContractFields,
  mergeScopedSearchConfig,
  resolveProviderWebSearchPluginConfig,
  type WebSearchProviderPlugin,
  type WebSearchProviderToolDefinition,
} from "openclaw/plugin-sdk/provider-web-search-config-contract";
import { coerceSecretRef } from "openclaw/plugin-sdk/secret-input-runtime";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";

const GEMINI_CREDENTIAL_PATH = "plugins.entries.google.config.webSearch.apiKey";
const GOOGLE_PROVIDER_CREDENTIAL_PATH = "models.providers.google.apiKey";

const loadGeminiWebSearchRuntime = createLazyRuntimeModule(
  () => import("./gemini-web-search-provider.runtime.js"),
);

const GEMINI_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query string." },
    count: {
      type: "integer",
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: 10,
    },
    country: { type: "string", description: "Not supported by Gemini." },
    language: { type: "string", description: "Not supported by Gemini." },
    freshness: {
      type: "string",
      description:
        "Filter Gemini search freshness: week, month, and year use hard Google Search time ranges; day prioritizes the last 24 hours as a recency hint.",
    },
    date_after: {
      type: "string",
      description: "Only ground with results published after this date (YYYY-MM-DD).",
    },
    date_before: {
      type: "string",
      description: "Only ground with results published before this date (YYYY-MM-DD).",
    },
  },
  required: ["query"],
} satisfies Record<string, unknown>;

function createGeminiToolDefinition(
  searchConfig?: Record<string, unknown>,
  secretRefHeaderNames?: readonly string[],
): WebSearchProviderToolDefinition {
  return {
    description:
      "Search the web using Gemini with Google Search grounding. Returns AI-synthesized answers with citations from Google Search.",
    parameters: GEMINI_TOOL_PARAMETERS,
    execute: async (args, context) => {
      const { executeGeminiSearch } = await loadGeminiWebSearchRuntime();
      return await executeGeminiSearch(args, searchConfig, {
        signal: context?.signal,
        secretRefHeaderNames,
      });
    },
  };
}

function resolveGeminiSearchConfig(
  searchConfig: Record<string, unknown> | undefined,
  config?: OpenClawConfig,
): Record<string, unknown> | undefined {
  return withGoogleModelProviderFallbacks(
    mergeScopedSearchConfig(
      searchConfig,
      "gemini",
      resolveProviderWebSearchPluginConfig(config, "google"),
    ),
    config,
  );
}

function resolveGeminiSecretRefHeaderNames(
  searchConfig: Record<string, unknown> | undefined,
  config?: OpenClawConfig,
): string[] {
  const scoped = resolveGeminiSearchConfig(searchConfig, config)?.gemini;
  const headers = isRecord(scoped) && isRecord(scoped.headers) ? scoped.headers : undefined;
  if (!headers) {
    return [];
  }
  const secretNames = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    let normalizedName: string;
    try {
      normalizedName = new Headers([[name, "provenance"]]).keys().next().value ?? "";
    } catch {
      continue;
    }
    if (!normalizedName) {
      continue;
    }
    // Runtime resolution replaces SecretRefs with strings. Preserve the source
    // provenance by normalized name so only their resolved values are redacted.
    if (coerceSecretRef(value, config?.secrets?.defaults)) {
      secretNames.add(normalizedName);
    } else {
      secretNames.delete(normalizedName);
    }
  }
  return [...secretNames].toSorted();
}

function resolveGoogleModelProviderConfig(
  config?: OpenClawConfig,
): Record<string, unknown> | undefined {
  const provider = config?.models?.providers?.google;
  return isRecord(provider) ? provider : undefined;
}

function getGoogleModelProviderCredentialFallback(
  config?: OpenClawConfig,
): { path: string; value: unknown } | undefined {
  const provider = resolveGoogleModelProviderConfig(config);
  return provider && provider.apiKey !== undefined
    ? { path: GOOGLE_PROVIDER_CREDENTIAL_PATH, value: provider.apiKey }
    : undefined;
}

function withGoogleModelProviderFallbacks(
  searchConfig: Record<string, unknown> | undefined,
  config?: OpenClawConfig,
): Record<string, unknown> | undefined {
  const provider = resolveGoogleModelProviderConfig(config);
  if (!provider || (provider.apiKey === undefined && provider.baseUrl === undefined)) {
    return searchConfig;
  }
  const gemini = isRecord(searchConfig?.gemini) ? { ...searchConfig.gemini } : {};
  const mergedSearchConfig: Record<string, unknown> = searchConfig
    ? Object.defineProperties({}, Object.getOwnPropertyDescriptors(searchConfig))
    : {};
  const geminiDescriptor = searchConfig
    ? Object.getOwnPropertyDescriptor(searchConfig, "gemini")
    : undefined;
  if (provider.apiKey !== undefined) {
    gemini.providerApiKey = provider.apiKey;
  }
  if (provider.baseUrl !== undefined) {
    gemini.providerBaseUrl = provider.baseUrl;
  }
  // Provider headers stay scoped to the provider base URL. Web-search headers
  // are configured explicitly under the Google plugin for its own endpoint.
  Object.defineProperty(mergedSearchConfig, "gemini", {
    value: gemini,
    enumerable: geminiDescriptor?.enumerable ?? false,
    configurable: true,
    writable: true,
  });
  return mergedSearchConfig;
}

export function createGeminiWebSearchProvider(): WebSearchProviderPlugin {
  const contractFields = createWebSearchProviderContractFields({
    credentialPath: GEMINI_CREDENTIAL_PATH,
    searchCredential: { type: "scoped", scopeId: "gemini" },
    configuredCredential: { pluginId: "google" },
  });

  return {
    id: "gemini",
    label: "Gemini (Google Search)",
    hint: "Requires Google Gemini API key · Google Search grounding",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Google Gemini API key",
    envVars: ["GEMINI_API_KEY"],
    placeholder: "AIza...",
    signupUrl: "https://aistudio.google.com/apikey",
    docsUrl: "https://docs.openclaw.ai/tools/web",
    autoDetectOrder: 20,
    credentialPath: GEMINI_CREDENTIAL_PATH,
    ...contractFields,
    getConfiguredCredentialFallback: getGoogleModelProviderCredentialFallback,
    resolveRuntimeMetadata: (ctx) => ({
      secretRefHeaderNames: resolveGeminiSecretRefHeaderNames(ctx.searchConfig, ctx.config),
    }),
    createTool: (ctx) =>
      createGeminiToolDefinition(
        resolveGeminiSearchConfig(ctx.searchConfig, ctx.config),
        ctx.runtimeMetadata?.secretRefHeaderNames,
      ),
  };
}
