import { execFile } from "node:child_process";
import { access, chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DoctorPrompter } from "../../src/commands/doctor-prompter.ts";
import type { RuntimeEnv } from "../../src/runtime.ts";

const execFileAsync = promisify(execFile);
const PRODUCT_SHA = process.env.DOCTOR_LAUNCHD_PROOF_SHA;
const PROOF_ROOT = path.join(
  process.env.RUNNER_TEMP || path.join(process.cwd(), ".artifacts"),
  "openclaw-doctor-launchd-proof",
);
const PROOF_HOME = path.join(PROOF_ROOT, "home");
const LAUNCH_AGENTS = path.join(PROOF_HOME, "Library", "LaunchAgents");
const TRASH = path.join(PROOF_HOME, ".Trash");
const STATE_DIR = path.join(PROOF_HOME, ".openclaw-proof-state");
const SHIM_DIR = path.join(PROOF_ROOT, "bin");
const ARTIFACT_DIR = path.join(process.cwd(), ".artifacts", "doctor-launchd-cleanup");
const ORIGINAL_PATH = process.env.PATH || "/usr/bin:/bin";
const UID = typeof process.getuid === "function" ? process.getuid() : undefined;
const DOMAIN = `gui/${UID ?? 501}`;
const MODES = ["timeout-loaded", "partial-timeout", "unknown", "success"] as const;
type Mode = (typeof MODES)[number];

if (!PRODUCT_SHA) {
  throw new Error("DOCTOR_LAUNCHD_PROOF_SHA is required");
}
if (process.platform !== "darwin") {
  throw new Error(`proof requires darwin, got ${process.platform}`);
}
if (!UID || UID < 1) {
  throw new Error(`proof requires a real user launchd uid, got ${String(UID)}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function command(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync(command, args, { encoding: "utf8" });
}

async function commandOk(commandName: string, args: string[]): Promise<boolean> {
  try {
    await command(commandName, args);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function serviceTarget(label: string): string {
  return `${DOMAIN}/${label}`;
}

async function isLoaded(label: string): Promise<boolean> {
  return await commandOk("/bin/launchctl", ["print", serviceTarget(label)]);
}

async function waitForLoaded(label: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await isLoaded(label)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`LaunchAgent did not become loaded: ${serviceTarget(label)}`);
}

async function waitForNotLoaded(label: string): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (!(await isLoaded(label))) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`LaunchAgent did not leave launchd: ${serviceTarget(label)}`);
}

async function removeLaunchAgent(label: string, plistPath: string): Promise<void> {
  await commandOk("/bin/launchctl", ["bootout", DOMAIN, plistPath]);
  await commandOk("/bin/launchctl", ["unload", plistPath]);
  await waitForNotLoaded(label).catch(() => undefined);
  await rm(plistPath, { force: true });
}

function plistFor(params: { label: string; scriptPath: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${params.label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/sh</string>
      <string>${params.scriptPath}</string>
      <string>gateway</string>
      <string>clawdbot</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
  </dict>
</plist>
`;
}

async function writeLaunchAgent(label: string): Promise<string> {
  const scriptPath = path.join(PROOF_ROOT, `${label}.sh`);
  const plistPath = path.join(LAUNCH_AGENTS, `${label}.plist`);
  await writeFile(scriptPath, "#!/bin/sh\nexec /bin/sleep 3600\n", { encoding: "utf8" });
  await chmod(scriptPath, 0o700);
  await writeFile(plistPath, plistFor({ label, scriptPath }), {
    encoding: "utf8",
    mode: 0o644,
  });
  return plistPath;
}

async function bootstrapLaunchAgent(label: string, plistPath: string): Promise<void> {
  const result = await command("/bin/launchctl", ["bootstrap", DOMAIN, plistPath]).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`launchctl bootstrap failed for ${label}: ${detail}`);
  });
  void result;
  await waitForLoaded(label);
}

async function writeLaunchctlShim(mode: Mode): Promise<void> {
  const shimPath = path.join(SHIM_DIR, "launchctl");
  const script = `#!/bin/sh
set -u
mode=${mode}
case "\${1:-}" in
  bootout|unload)
    case "$mode" in
      timeout-loaded|partial-timeout)
        sleep 7
        exit 124
        ;;
      unknown)
        exit 0
        ;;
      success)
        exec /bin/launchctl "$@"
        ;;
    esac
    ;;
  print)
    case "$mode" in
      partial-timeout)
        printf '%s\\n' 'Could not find service' >&2
        sleep 7
        exit 1
        ;;
      unknown)
        printf '%s\\n' 'Permission denied' >&2
        exit 1
        ;;
      timeout-loaded|success)
        exec /bin/launchctl "$@"
        ;;
    esac
    ;;
  *)
    exec /bin/launchctl "$@"
    ;;
esac
`;
  await writeFile(shimPath, script, { encoding: "utf8" });
  await chmod(shimPath, 0o700);
}

async function trashEntries(label: string): Promise<string[]> {
  return (await readdir(TRASH)).filter((entry) => entry.startsWith(`${label}-`) && entry.endsWith(".plist"));
}

function makeRuntime(events: string[]): RuntimeEnv {
  return {
    log: (...args) => events.push(`log: ${args.map(String).join(" ")}`),
    error: (...args) => events.push(`error: ${args.map(String).join(" ")}`),
    exit: (code) => {
      throw new Error(`doctor runtime exit ${code}`);
    },
  };
}

function makePrompter(): DoctorPrompter {
  const repairMode = {
    shouldRepair: true,
    shouldForce: true,
    nonInteractive: false,
    canPrompt: false,
    updateInProgress: false,
  };
  return {
    confirm: async () => true,
    confirmAutoFix: async () => true,
    confirmAggressiveAutoFix: async () => true,
    confirmRuntimeRepair: async () => true,
    select: async <T>(_params: never, fallback: T) => fallback,
    shouldRepair: true,
    shouldForce: true,
    repairMode,
  } as DoctorPrompter;
}

async function runScenario(
  mode: Mode,
  maybeScanExtraGatewayServices: typeof import("../../src/commands/doctor-gateway-services.ts").maybeScanExtraGatewayServices,
): Promise<Record<string, unknown>> {
  const label = `com.clawdbot.doctor-proof-${mode}`;
  const plistPath = await writeLaunchAgent(label);
  const events: string[] = [];
  const startedAt = Date.now();
  let moved: string[] = [];
  let loadedAfter = false;
  let plistAfter = false;
  let failure: string | undefined;
  try {
    await bootstrapLaunchAgent(label, plistPath);
    assert(await isLoaded(label), `${mode}: healthy LaunchAgent was not loaded`);
    await writeLaunchctlShim(mode);
    const before = await trashEntries(label);
    await maybeScanExtraGatewayServices(
      { deep: false },
      makeRuntime(events),
      makePrompter(),
    );
    const durationMs = Date.now() - startedAt;
    plistAfter = await fileExists(plistPath);
    moved = await trashEntries(label);
    loadedAfter = await isLoaded(label);

    const observation = {
      loadedAfter,
      mode,
      plistAfter,
      plistPath,
      trashEntries: moved,
    };
    console.log(`LAUNCHD_CLEANUP_OBSERVATION=${JSON.stringify(observation)}`);

    if (mode === "success") {
      assert(!plistAfter, "success: plist was not removed from LaunchAgents");
      assert(moved.length === before.length + 1, `success: expected one moved plist, got ${moved}`);
      assert(!loadedAfter, "success: LaunchAgent remained loaded after confirmed not-loaded probe");
    } else {
      assert(plistAfter, `${mode}: plist was removed despite unconfirmed cleanup`);
      assert(moved.length === before.length, `${mode}: plist unexpectedly moved to Trash`);
      assert(loadedAfter, `${mode}: real LaunchAgent was not retained for retry`);
      assert(durationMs < 22_000, `${mode}: doctor exceeded bounded cleanup window: ${durationMs}ms`);
    }

    return {
      durationMs,
      events,
      label,
      loadedAfter,
      plistPath,
      mode,
      plistAfter,
      trashEntries: moved,
    };
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await removeLaunchAgent(label, plistPath);
    for (const entry of await trashEntries(label)) {
      await rm(path.join(TRASH, entry), { force: true });
    }
    if (failure) {
      events.push(`failure: ${failure}`);
    }
  }
}

await rm(PROOF_ROOT, { recursive: true, force: true });
await mkdir(LAUNCH_AGENTS, { recursive: true, mode: 0o700 });
await mkdir(TRASH, { recursive: true, mode: 0o700 });
await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
await mkdir(SHIM_DIR, { recursive: true, mode: 0o700 });

const previousEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
  OPENCLAW_PROFILE: process.env.OPENCLAW_PROFILE,
  OPENCLAW_SERVICE_REPAIR_POLICY: process.env.OPENCLAW_SERVICE_REPAIR_POLICY,
  OPENCLAW_UPDATE_PARENT_ALLOWS_GATEWAY_SERVICE_REPAIR:
    process.env.OPENCLAW_UPDATE_PARENT_ALLOWS_GATEWAY_SERVICE_REPAIR,
  PATH: process.env.PATH,
};
process.env.HOME = PROOF_HOME;
process.env.USERPROFILE = PROOF_HOME;
process.env.OPENCLAW_STATE_DIR = STATE_DIR;
delete process.env.OPENCLAW_PROFILE;
delete process.env.OPENCLAW_SERVICE_REPAIR_POLICY;
delete process.env.OPENCLAW_UPDATE_PARENT_ALLOWS_GATEWAY_SERVICE_REPAIR;
process.env.PATH = `${SHIM_DIR}:${ORIGINAL_PATH}`;

const productSha = (await command("/usr/bin/git", ["rev-parse", "HEAD"])).stdout.trim();
assert(productSha === PRODUCT_SHA, `product SHA mismatch: ${productSha}`);
assert(os.homedir() === PROOF_HOME, `HOME was not isolated: ${os.homedir()}`);

const { maybeScanExtraGatewayServices } = await import("../../src/commands/doctor-gateway-services.ts");
const proof: Record<string, unknown> = {
  domain: DOMAIN,
  home: PROOF_HOME,
  productSha,
  runner: { arch: process.arch, platform: process.platform, version: process.version },
  scenarios: [],
};
let failure: unknown;
try {
  for (const mode of MODES) {
    const result = await runScenario(mode, maybeScanExtraGatewayServices);
    (proof.scenarios as unknown[]).push(result);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  failure = error;
  proof.failure = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
} finally {
  process.env.HOME = previousEnv.HOME;
  process.env.USERPROFILE = previousEnv.USERPROFILE;
  process.env.OPENCLAW_STATE_DIR = previousEnv.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_PROFILE = previousEnv.OPENCLAW_PROFILE;
  process.env.OPENCLAW_SERVICE_REPAIR_POLICY = previousEnv.OPENCLAW_SERVICE_REPAIR_POLICY;
  process.env.OPENCLAW_UPDATE_PARENT_ALLOWS_GATEWAY_SERVICE_REPAIR =
    previousEnv.OPENCLAW_UPDATE_PARENT_ALLOWS_GATEWAY_SERVICE_REPAIR;
  process.env.PATH = previousEnv.PATH;
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(path.join(ARTIFACT_DIR, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
  await rm(PROOF_ROOT, { recursive: true, force: true });
}

console.log(JSON.stringify(proof, null, 2));
if (failure) {
  throw failure;
}
