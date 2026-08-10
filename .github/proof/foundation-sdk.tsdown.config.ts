import path from "node:path";
import type { UserConfig } from "tsdown";

const root = process.cwd();

const sdkConfig = {
  clean: false,
  dts: false,
  entry: {
    "plugin-sdk/logging-core": path.join(root, "src/plugin-sdk/logging-core.ts"),
    "plugin-sdk/provider-http": path.join(root, "src/plugin-sdk/provider-http.ts"),
  },
  env: { NODE_ENV: "production" },
  fixedExtension: false,
  format: "esm",
  outDir: path.join(root, "dist"),
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
    "foundation-sdk-runtime": path.join(root, ".proof-runtime/foundation-sdk-runtime.ts"),
  },
  env: { NODE_ENV: "production" },
  fixedExtension: false,
  format: "esm",
  outDir: path.join(root, ".proof-dist"),
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
