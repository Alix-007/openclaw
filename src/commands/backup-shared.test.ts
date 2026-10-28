import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBackupArchivePath, resolveRequiredBackupPath } from "./backup-shared.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveRequiredBackupPath", () => {
  it.each([
    [undefined, "--repository"],
    ["   ", "<snapshot>"],
  ] as const)("rejects %j for %s", (value, label) => {
    expect(() => resolveRequiredBackupPath(value, label)).toThrow(
      `Missing required ${label} value.`,
    );
  });

  it("trims and resolves relative paths from cwd", () => {
    expect(resolveRequiredBackupPath("  backups/archive  ", "--target")).toBe(
      path.resolve("backups/archive"),
    );
  });

  it("expands tilde from the effective home", () => {
    const home = path.resolve("effective-home");
    vi.stubEnv("OPENCLAW_HOME", home);
    expect(resolveRequiredBackupPath("~/backups", "--repository")).toBe(path.join(home, "backups"));
  });

  it("preserves absolute paths", () => {
    const absolute = path.resolve("absolute-backup");
    expect(resolveRequiredBackupPath(`  ${absolute}  `, "--scratch")).toBe(absolute);
  });
});

describe("resolveBackupArchivePath", () => {
  it.each([undefined, "", " \t "])("rejects a blank archive path: %j", (value) => {
    expect(() => resolveBackupArchivePath(value, "<archive>")).toThrow(
      "Missing required <archive> value.",
    );
  });

  it("preserves literal relative, absolute, and home-relative archive paths", () => {
    const home = path.resolve("effective-home");
    vi.stubEnv("OPENCLAW_HOME", home);
    expect(resolveBackupArchivePath("  archive.tar.gz ", "<archive>")).toBe(
      path.resolve("  archive.tar.gz "),
    );
    const absolute = path.resolve("archive output ");
    expect(resolveBackupArchivePath(absolute, "--output")).toBe(absolute);
    expect(resolveBackupArchivePath("~/restore target ", "--target")).toBe(
      path.join(home, "restore target "),
    );
  });
});
