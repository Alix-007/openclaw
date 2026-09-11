// Failed quarantine must preserve malformed input and report the actual outcome.
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tempRoot, paths, insertContainer, insertBrowser } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const nodePath = await import("node:path");
  const createdTempRoot = await mkdtemp(nodePath.join(tmpdir(), "openclaw-quarantine-"));
  return {
    tempRoot: createdTempRoot,
    paths: {
      SANDBOX_REGISTRY_PATH: nodePath.join(createdTempRoot, "containers.json"),
      SANDBOX_BROWSER_REGISTRY_PATH: nodePath.join(createdTempRoot, "browsers.json"),
      SANDBOX_CONTAINERS_DIR: nodePath.join(createdTempRoot, "containers"),
      SANDBOX_BROWSERS_DIR: nodePath.join(createdTempRoot, "browsers"),
    },
    insertContainer: vi.fn(),
    insertBrowser: vi.fn(),
  };
});

vi.mock("../agents/sandbox/constants.js", () => paths);
vi.mock("../agents/sandbox/registry.js", () => ({
  insertSandboxRegistryEntryIfMissing: insertContainer,
  insertSandboxBrowserRegistryEntryIfMissing: insertBrowser,
}));

import { migrateLegacySandboxRegistryFiles } from "./doctor-sandbox-legacy-registry.js";

const targets = [
  { kind: "containers", registryPath: paths.SANDBOX_REGISTRY_PATH },
  { kind: "browsers", registryPath: paths.SANDBOX_BROWSER_REGISTRY_PATH },
] as const;
const malformed = "{malformed legacy input\n";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const name of await fs.readdir(tempRoot)) {
    await fs.rm(path.join(tempRoot, name), { recursive: true, force: true });
  }
});
afterAll(async () => await fs.rm(tempRoot, { recursive: true, force: true }));

describe("monolithic legacy registry quarantine", () => {
  it.each(targets)("keeps $kind bytes when the real rename fails", async ({ registryPath }) => {
    const now = 1_800_000_000_000;
    const quarantinePath = `${registryPath}.invalid-${now}`;
    await fs.writeFile(registryPath, malformed);
    // A file cannot replace this directory. This is a real filesystem failure,
    // independent of permission differences between root and ordinary users.
    await fs.mkdir(quarantinePath);
    await fs.writeFile(path.join(quarantinePath, "keep.txt"), "existing target");
    vi.spyOn(Date, "now").mockReturnValue(now);

    await expect(migrateLegacySandboxRegistryFiles()).rejects.toMatchObject({
      syscall: "rename",
      path: registryPath,
      dest: quarantinePath,
    });
    expect(await fs.readFile(registryPath, "utf8")).toBe(malformed);
    expect(await fs.readFile(path.join(quarantinePath, "keep.txt"), "utf8")).toBe(
      "existing target",
    );
    await expect(fs.stat(`${registryPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(insertContainer).not.toHaveBeenCalled();
    expect(insertBrowser).not.toHaveBeenCalled();
  });

  it.each(targets)(
    "reports $kind input removed before rename as missing",
    async ({ kind, registryPath }) => {
      await fs.writeFile(registryPath, malformed);
      const rename = fs.rename.bind(fs);
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (from === registryPath) {
          await fs.unlink(registryPath);
        }
        return await rename(from, to);
      });

      const results = await migrateLegacySandboxRegistryFiles();
      expect(results).toContainEqual({ kind, status: "missing" });
      expect((await fs.readdir(tempRoot)).filter((name) => name.includes(".invalid-"))).toEqual([]);
      await expect(fs.stat(`${registryPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
      expect(insertContainer).not.toHaveBeenCalled();
      expect(insertBrowser).not.toHaveBeenCalled();
    },
  );
  it("returns real quarantine files with identical contents for both kinds", async () => {
    for (const { registryPath } of targets) {
      await fs.writeFile(registryPath, malformed);
    }
    const results = await migrateLegacySandboxRegistryFiles();
    expect(results).toHaveLength(2);
    for (const { kind, registryPath } of targets) {
      const result = results.find((entry) => entry.kind === kind);
      expect(result?.status).toBe("quarantined-invalid");
      if (result?.status !== "quarantined-invalid") {
        throw new Error(`Missing successful quarantine for ${kind}.`);
      }
      expect(result.path).toBe(registryPath);
      expect(await fs.readFile(result.quarantinePath, "utf8")).toBe(malformed);
      await expect(fs.stat(registryPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.stat(`${registryPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(insertContainer).not.toHaveBeenCalled();
    expect(insertBrowser).not.toHaveBeenCalled();
  });

  it("leaves empty-file removal and initially missing input unchanged", async () => {
    await fs.writeFile(paths.SANDBOX_REGISTRY_PATH, JSON.stringify({ entries: [] }));
    expect(await migrateLegacySandboxRegistryFiles()).toEqual([
      { kind: "containers", status: "removed-empty" },
      { kind: "browsers", status: "missing" },
    ]);
    await expect(fs.stat(paths.SANDBOX_REGISTRY_PATH)).rejects.toMatchObject({ code: "ENOENT" });
    expect(insertContainer).not.toHaveBeenCalled();
    expect(insertBrowser).not.toHaveBeenCalled();
  });
});
