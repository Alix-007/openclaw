import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const taskDir = path.dirname(new URL(import.meta.url).pathname);
const target = process.argv[2] ?? "baseline";
if (!["baseline", "draft-focus"].includes(target)) throw new Error("Unexpected task checkout");
const baseline = path.join(taskDir, target);
const importSource = (relative: string) => import(pathToFileURL(path.join(baseline, relative)).href);
const { withDistArtifactOwnership, distArtifactEntryArgs } = await importSource("scripts/lib/dist-artifact-ownership.mts");
const { copyBundledPluginMetadata } = await importSource("scripts/copy-bundled-plugin-metadata.mts");
const pluginIds = ["clawrouter", "knowledge", "mcp-relay", "workboard", "x"];
await withDistArtifactOwnership(baseline, async () => {
  for (const pluginId of pluginIds) {
    const packageDir = path.join(baseline, "extensions", pluginId);
    const script = path.join(baseline, "scripts/build-plugin-control-ui.mts");
    console.log(`Preparing ignored UI distribution: ${pluginId}`);
    for (const args of [[packageDir], [packageDir, "--copy"]]) {
      const result = await promisify(execFile)(process.execPath, distArtifactEntryArgs(script, args), {
        cwd: baseline, maxBuffer: 1024 * 1024, timeout: 90_000,
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
  }
  copyBundledPluginMetadata({ repoRoot: baseline, pluginIds: new Set(pluginIds) });
});
console.log("Selected ignored UI distributions prepared.");
