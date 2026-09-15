import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  collectConfiguredAgentModelProviderIds,
  manifestOwnsConfiguredModelProvider,
} from "./gateway-startup-plugin-providers.js";
import type { PluginManifestRecord, PluginManifestRegistry } from "./manifest-registry.js";

function createManifestRecord(
  plugin: Pick<PluginManifestRecord, "id"> & Partial<PluginManifestRecord>,
): PluginManifestRecord {
  return {
    channels: [],
    providers: [],
    cliBackends: [],
    skills: [],
    hooks: [],
    origin: "bundled",
    rootDir: `/tmp/plugins/${plugin.id}`,
    source: `/tmp/plugins/${plugin.id}/index.ts`,
    manifestPath: `/tmp/plugins/${plugin.id}/openclaw.plugin.json`,
    ...plugin,
  };
}

function createManifestRegistry(
  plugins: Array<Pick<PluginManifestRecord, "id"> & Partial<PluginManifestRecord>>,
): PluginManifestRegistry {
  return { plugins: plugins.map(createManifestRecord), diagnostics: [] };
}

describe("configured Gateway model provider ownership", () => {
  it("does not inspect model catalogs when no agent model refs are configured", () => {
    const registry = createManifestRegistry([
      {
        id: "unused",
        providers: ["unused"],
        modelCatalog: {
          providers: {
            unused: {
              get models(): never {
                throw new Error("unconfigured catalog was inspected");
              },
            },
          },
        },
      },
    ]);

    expect(collectConfiguredAgentModelProviderIds({}, registry)).toEqual(new Set());
  });

  it("does not normalize unrelated rows in a large catalog", () => {
    let unrelatedNormalizationReads = 0;
    const unrelatedModels = Array.from({ length: 10_000 }, (_, index) => ({
      id: `unrelated-${index}`,
      get name() {
        unrelatedNormalizationReads += 1;
        return `Unrelated ${index}`;
      },
    }));
    const registry = createManifestRegistry([
      {
        id: "selected",
        providers: ["selected"],
        modelCatalog: {
          providers: {
            selected: {
              api: "bedrock-converse-stream",
              models: [{ id: "requested" }, ...unrelatedModels],
            },
          },
        },
      },
      {
        id: "unrelated",
        providers: ["unrelated"],
        modelCatalog: {
          providers: {
            unrelated: { models: unrelatedModels },
          },
        },
      },
    ]);
    const config = {
      agents: { defaults: { model: "selected/requested" } },
    } as OpenClawConfig;

    expect(collectConfiguredAgentModelProviderIds(config, registry)).toEqual(new Set(["selected"]));
    expect(unrelatedNormalizationReads).toBe(0);
  });
});

describe("selected CLI backend startup ownership", () => {
  it.each(["provider", "model"] as const)(
    "retains the CLI owner when the built-in API is configured on the %s",
    (source) => {
      const registry = createManifestRegistry([
        { id: "selected-plugin", providers: ["selected-cli"], cliBackends: ["selected-cli"] },
        { id: "unused-plugin", providers: ["unused-cli"], cliBackends: ["unused-cli"] },
      ]);
      const config: OpenClawConfig = {
        agents: { defaults: { model: { primary: "selected-cli/auto" } } },
        models: {
          providers: {
            "selected-cli": {
              baseUrl: "cli://selected",
              ...(source === "provider" ? { api: "openai-completions" as const } : {}),
              models: [
                {
                  id: "auto",
                  name: "Auto",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  maxTokens: 8192,
                  ...(source === "model" ? { api: "openai-completions" as const } : {}),
                },
              ],
            },
          },
        },
      };
      const configuredModelProviderIds = collectConfiguredAgentModelProviderIds(config, registry);
      expect(configuredModelProviderIds).toEqual(new Set(["selected-cli"]));
      expect(
        manifestOwnsConfiguredModelProvider({
          manifest: registry.plugins[0],
          configuredModelProviderIds,
        }),
      ).toBe(true);
      expect(
        manifestOwnsConfiguredModelProvider({
          manifest: registry.plugins[1],
          configuredModelProviderIds,
        }),
      ).toBe(false);
    },
  );

  it("honors backend-only manifest ownership without activating ordinary HTTP providers", () => {
    const registry = createManifestRegistry([
      { id: "cli-owner", cliBackends: ["selected-cli"] },
      { id: "http-owner", providers: ["ordinary-http"] },
    ]);
    const config: OpenClawConfig = {
      agents: {
        defaults: { model: { primary: "ordinary-http/model", fallbacks: ["selected-cli/model"] } },
      },
      models: {
        providers: {
          "ordinary-http": {
            baseUrl: "https://provider.invalid/v1",
            api: "openai-completions",
            models: [
              {
                id: "model",
                name: "Model",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                maxTokens: 8192,
              },
            ],
          },
          "selected-cli": {
            baseUrl: "cli://selected",
            api: "openai-completions",
            models: [
              {
                id: "model",
                name: "Model",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                maxTokens: 8192,
              },
            ],
          },
        },
      },
    };
    const configuredModelProviderIds = collectConfiguredAgentModelProviderIds(config, registry);
    expect(configuredModelProviderIds).toEqual(new Set(["selected-cli"]));
    expect(
      manifestOwnsConfiguredModelProvider({
        manifest: registry.plugins[0],
        configuredModelProviderIds,
      }),
    ).toBe(true);
    expect(
      manifestOwnsConfiguredModelProvider({
        manifest: registry.plugins[1],
        configuredModelProviderIds,
      }),
    ).toBe(false);
  });
});
