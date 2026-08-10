import type { UserConfig } from "tsdown";

const sdkConfig = {
  clean: false,
  dts: false,
  entry: {
    "plugin-sdk/logging-core": "src/plugin-sdk/logging-core.ts",
    "plugin-sdk/provider-http": "src/plugin-sdk/provider-http.ts",
  },
  env: { NODE_ENV: "production" },
  fixedExtension: false,
  format: "esm",
  outDir: "dist",
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  platform: "node",
  target: "node24",
  deps: {
    neverBundle(id: string) {
      return id === "@openclaw/ai" || id.startsWith("@openclaw/ai/");
    },
  },
} satisfies UserConfig;

const consumerConfig = {
  clean: false,
  dts: false,
  entry: {
    "foundation-sdk-runtime": ".proof-runtime/foundation-sdk-runtime.ts",
  },
  env: { NODE_ENV: "production" },
  fixedExtension: false,
  format: "esm",
  outDir: ".proof-dist",
  outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
  platform: "node",
  target: "node24",
  deps: {
    neverBundle(id: string) {
      return id === "openclaw" || id.startsWith("openclaw/");
    },
  },
} satisfies UserConfig;

export default [sdkConfig, consumerConfig];
