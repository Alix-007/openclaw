// Detects safe executable names or paths without shell evaluation.
import path from "node:path";
import { runCommandWithTimeout } from "../process/exec.js";
import { resolveUserPath } from "../utils.js";
import { isSafeExecutableValue } from "./exec-safety.js";
import { resolveExecutablePath } from "./executable-path.js";
import { getWindowsSystem32ExePath } from "./windows-install-roots.js";

// Binary detection accepts safe executable names or explicit paths and avoids
// shell evaluation when probing PATH.
/** Return true when a safe executable name/path can be found on this host. */
export async function detectBinary(name: string): Promise<boolean> {
  if (!name?.trim()) {
    return false;
  }
  if (!isSafeExecutableValue(name)) {
    return false;
  }
  const resolved = name.startsWith("~") ? resolveUserPath(name) : name;
  if (
    path.isAbsolute(resolved) ||
    resolved.startsWith(".") ||
    resolved.includes("/") ||
    resolved.includes("\\")
  ) {
    // Explicit paths use the same file-type and execution checks as command resolution.
    // Resolve dot-prefixed names here so they remain cwd-relative rather than PATH lookups.
    return resolveExecutablePath(path.resolve(resolved), { useCache: false }) !== undefined;
  }

  const command =
    process.platform === "win32"
      ? [getWindowsSystem32ExePath("where.exe"), name]
      : ["/usr/bin/env", "which", name];
  try {
    const result = await runCommandWithTimeout(command, { timeoutMs: 2000 });
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}
