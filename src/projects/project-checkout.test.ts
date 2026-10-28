import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { ProjectCheckoutError, resolveProjectCheckout } from "./project-checkout.js";

const execFileAsync = promisify(execFile);
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

async function initializeRepository(parent: string, name: string, commit = true) {
  const repo = path.join(parent, name);
  await fs.mkdir(repo, { recursive: true });
  await execFileAsync("git", ["init", "--quiet", repo]);
  if (commit) {
    await execFileAsync("git", [
      "-C",
      repo,
      "-c",
      "user.name=OpenClaw Tests",
      "-c",
      "user.email=tests@openclaw.invalid",
      "-c",
      `core.hooksPath=${os.devNull}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "--quiet",
      "-m",
      "fixture",
    ]);
  }
  return await fs.realpath(repo);
}

describe("project checkout resolution", () => {
  it("resolves an ordinary checkout from a nested directory", async () => {
    const root = tempDirs.make("openclaw-project-checkout-");
    const repo = await initializeRepository(root, "checkout");
    const nested = path.join(repo, "nested");
    await fs.mkdir(nested);

    expect(await resolveProjectCheckout(nested)).toEqual({ path: nested, repoRoot: repo });
  });

  it.skipIf(process.platform === "win32").each([
    ["trailing space", "checkout "],
    ["trailing tab", "checkout\t"],
    ["trailing LF", "checkout\n"],
    ["trailing CR", "checkout\r"],
    ["embedded LF", "checkout\nsegment"],
  ])("preserves %s in Git's reported checkout root", async (_label, name) => {
    const root = tempDirs.make("openclaw-project-checkout-");
    const trimmedName = name.trim();
    if (trimmedName !== name) {
      await initializeRepository(root, trimmedName);
    }
    const repo = await initializeRepository(root, name);
    const nested = path.join(repo, "nested");
    await fs.mkdir(nested);

    expect(await resolveProjectCheckout(nested)).toEqual({ path: nested, repoRoot: repo });
  });

  it("rejects an existing directory outside a Git checkout", async () => {
    const root = tempDirs.make("openclaw-project-checkout-");

    await expect(resolveProjectCheckout(root)).rejects.toMatchObject({
      name: "ProjectCheckoutError",
      message: `project path is not a git checkout: ${root}`,
    });
  });

  it("rejects a Git checkout without a committed HEAD", async () => {
    const root = tempDirs.make("openclaw-project-checkout-");
    const repo = await initializeRepository(root, "unborn", false);

    await expect(resolveProjectCheckout(repo)).rejects.toThrow(
      new ProjectCheckoutError(`project checkout has no commits: ${repo}`),
    );
  });
});
