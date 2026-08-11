import path from "node:path";
import type { UserConfig } from "tsdown";

const root = process.cwd();

export default {
  clean: false,
  dts: false,
  entry: {
    "electron-tool-search": path.join(root, ".proof-runtime/electron-tool-search.ts"),
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
      return id === "electron";
    },
  },
} satisfies UserConfig;
