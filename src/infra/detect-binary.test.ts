// Covers host binary detection command selection.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withMockedWindowsPlatform } from "../test-utils/vitest-spies.js";

const runCommandWithTimeoutMock = vi.hoisted(() => vi.fn());

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: runCommandWithTimeoutMock,
}));

import { detectBinary } from "./detect-binary.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  runCommandWithTimeoutMock.mockReset();
});

describe("detectBinary", () => {
  it("uses the trusted Windows where.exe when probing PATH", async () => {
    const accessSync = fs.accessSync.bind(fs);
    vi.spyOn(fs, "accessSync").mockImplementation((filePath, mode) => {
      if (String(filePath).toLowerCase() === "c:\\windows\\system32\\reg.exe") {
        throw new Error("registry lookup disabled for test");
      }
      return accessSync(filePath, mode);
    });
    vi.stubEnv("SystemRoot", "D:\\Windows");
    runCommandWithTimeoutMock.mockResolvedValue({
      code: 0,
      stdout: "D:\\Tools\\openclaw.exe\n",
    });

    await withMockedWindowsPlatform(async () => {
      await expect(detectBinary("openclaw")).resolves.toBe(true);
    });

    expect(runCommandWithTimeoutMock).toHaveBeenCalledWith(
      [path.win32.join("D:\\Windows", "System32", "where.exe"), "openclaw"],
      { timeoutMs: 2000 },
    );
  });
});

describe("detectBinary explicit paths", () => {
  it("rejects a searchable directory without probing PATH", async () => {
    const { tmpdir } = await import("node:os");
    const root = fs.mkdtempSync(path.join(tmpdir(), "openclaw-binary-dir-"));
    try {
      await expect(detectBinary(root)).resolves.toBe(false);
      expect(runCommandWithTimeoutMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "observes execution-bit changes without a stale path cache",
    async () => {
      const { tmpdir } = await import("node:os");
      const root = fs.mkdtempSync(path.join(tmpdir(), "openclaw-binary-mode-"));
      const file = path.join(root, "tool");
      try {
        fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
        await expect(detectBinary(file)).resolves.toBe(false);
        fs.chmodSync(file, 0o755);
        await expect(detectBinary(file)).resolves.toBe(true);
        fs.chmodSync(file, 0o644);
        await expect(detectBinary(file)).resolves.toBe(false);
        expect(runCommandWithTimeoutMock).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "accepts a file symlink but rejects directory and dangling symlinks",
    async () => {
      const { tmpdir } = await import("node:os");
      const root = fs.mkdtempSync(path.join(tmpdir(), "openclaw-binary-links-"));
      try {
        const executable = path.join(root, "tool");
        const fileLink = path.join(root, "tool-link");
        const dirLink = path.join(root, "directory-link");
        const missingLink = path.join(root, "missing-link");
        fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        fs.symlinkSync(executable, fileLink);
        fs.symlinkSync(root, dirLink);
        fs.symlinkSync(path.join(root, "absent"), missingLink);
        await expect(detectBinary(fileLink)).resolves.toBe(true);
        await expect(detectBinary(dirLink)).resolves.toBe(false);
        await expect(detectBinary(missingLink)).resolves.toBe(false);
        expect(runCommandWithTimeoutMock).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("accepts the current native runtime and rejects a missing explicit path", async () => {
    await expect(detectBinary(process.execPath)).resolves.toBe(true);
    await expect(detectBinary(path.join(process.execPath, "absent"))).resolves.toBe(false);
    expect(runCommandWithTimeoutMock).not.toHaveBeenCalled();
  });
});
