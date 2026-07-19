import { execFileSync } from "node:child_process";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import logbookPlugin from "../../extensions/logbook/index.ts";
import { resolvePreferredOpenClawTmpDir } from "../../src/infra/tmp-openclaw-dir.ts";

const OUTER_WATCHDOG_MS = 28_000;
const EXPECTED = process.env.LOGBOOK_PROOF_EXPECT;
const EXPECTED_SHA = process.env.LOGBOOK_PROOF_SHA;

type SnapshotPayload = { format: "jpeg"; base64: string } | { error: string };
type ProcessDetails = { command: string; ppid: number; state: string };

if (EXPECTED !== "baseline" && EXPECTED !== "candidate") {
  throw new Error(`unexpected LOGBOOK_PROOF_EXPECT: ${String(EXPECTED)}`);
}
if (!EXPECTED_SHA) {
  throw new Error("missing LOGBOOK_PROOF_SHA");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function commandOutput(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function directChildPids(name: string): number[] {
  try {
    return commandOutput("/usr/bin/pgrep", ["-P", String(process.pid), "-x", name])
      .split(/\s+/u)
      .map(Number)
      .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function processDetails(pid: number): ProcessDetails {
  const output = commandOutput("/bin/ps", ["-o", "ppid=,state=,command=", "-p", String(pid)]);
  const match = output.match(/^(\d+)\s+(\S+)\s+(.+)$/u);
  assert(match, `could not parse process details for ${pid}: ${output}`);
  return { ppid: Number(match[1]), state: match[2], command: match[3] };
}

async function stopNextCapture(): Promise<{ details: ProcessDetails; pid: number }> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    for (const pid of directChildPids("screencapture")) {
      try {
        const details = processDetails(pid);
        if (
          details.ppid !== process.pid ||
          !details.command.includes("logbook-snapshot-") ||
          !details.command.includes("-t jpg")
        ) {
          continue;
        }
        process.kill(pid, "SIGSTOP");
        const stopped = processDetails(pid);
        if (stopped.state.startsWith("T")) {
          return { details: stopped, pid };
        }
      } catch {
        // A healthy capture can exit between observation and SIGSTOP.
      }
    }
    await delay(5);
  }
  throw new Error("did not observe and stop the direct Logbook screencapture child");
}

async function snapshotFiles(captureDir: string): Promise<string[]> {
  try {
    return (await readdir(captureDir))
      .filter((name) => name.startsWith("logbook-snapshot-") && name.endsWith(".jpg"))
      .toSorted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function sameFiles(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function killTrackedCapture(pid: number | undefined): Promise<void> {
  if (!isAlive(pid)) {
    return;
  }
  try {
    process.kill(pid as number, "SIGKILL");
  } catch {}
}

const command = logbookPlugin.nodeHostCommands?.find(
  (entry) => entry.command === "logbook.snapshot",
);
assert(command, "Logbook plugin did not register logbook.snapshot");

async function invokeSnapshot(): Promise<SnapshotPayload> {
  const raw = await command.handle(JSON.stringify({ maxWidth: 640, quality: 0.5, screenIndex: 0 }));
  const parsed: unknown = JSON.parse(raw);
  assert(typeof parsed === "object" && parsed !== null, `invalid logbook.snapshot payload: ${raw}`);
  const payload = parsed as SnapshotPayload;
  assert(
    ("format" in payload && payload.format === "jpeg" && typeof payload.base64 === "string") ||
      ("error" in payload && typeof payload.error === "string"),
    `invalid logbook.snapshot payload: ${raw}`,
  );
  return payload;
}

const artifactDir = path.join(process.cwd(), ".artifacts", "logbook-snapshot-timeout");
await mkdir(artifactDir, { recursive: true });
const captureDir = path.join(resolvePreferredOpenClawTmpDir(), "logbook");
const productSha = commandOutput("/usr/bin/git", ["rev-parse", "HEAD"]);
const captureExecutable = commandOutput("/usr/bin/which", ["screencapture"]);
const macosVersion = commandOutput("/usr/bin/sw_vers", ["-productVersion"]);
const initialFiles = await snapshotFiles(captureDir);

const proof: Record<string, unknown> = {
  captureDir,
  captureExecutable,
  expected: EXPECTED,
  macosVersion,
  outerWatchdogMs: OUTER_WATCHDOG_MS,
  productSha,
  runner: { arch: process.arch, hostname: os.hostname(), platform: process.platform },
};

let failure: unknown;
let stoppedPid: number | undefined;
let stalledFilePath: string | undefined;
let stalledPromise: Promise<SnapshotPayload> | undefined;
let stalledSettled = false;

try {
  assert(process.platform === "darwin", `proof requires darwin, got ${process.platform}`);
  assert(productSha === EXPECTED_SHA, `product SHA mismatch: ${productSha}`);
  assert(
    captureExecutable === "/usr/sbin/screencapture",
    `unexpected screencapture executable: ${captureExecutable}`,
  );
  assert(
    directChildPids("screencapture").length === 0,
    "proof process already owned a screencapture child",
  );

  const normalStartedAt = Date.now();
  const normal = await invokeSnapshot();
  const normalDurationMs = Date.now() - normalStartedAt;
  assert(
    "format" in normal,
    `normal logbook.snapshot failed: ${"error" in normal ? normal.error : ""}`,
  );
  const jpeg = Buffer.from(normal.base64, "base64");
  assert(jpeg.length > 1_000, `normal snapshot was unexpectedly small: ${jpeg.length}`);
  assert(jpeg[0] === 0xff && jpeg[1] === 0xd8, "normal snapshot was not a JPEG");
  const filesAfterNormal = await snapshotFiles(captureDir);
  assert(sameFiles(filesAfterNormal, initialFiles), "normal snapshot left a temp capture behind");
  proof.normal = { durationMs: normalDurationMs, jpegBytes: jpeg.length, tempClean: true };

  const beforeStall = await snapshotFiles(captureDir);
  const observer = stopNextCapture();
  const stalledStartedAt = Date.now();
  stalledPromise = invokeSnapshot().then(
    (payload) => {
      stalledSettled = true;
      return payload;
    },
    (error) => {
      stalledSettled = true;
      throw error;
    },
  );
  void stalledPromise.catch(() => undefined);
  const stopped = await observer;
  stoppedPid = stopped.pid;
  assert(stopped.details.ppid === process.pid, "stopped capture was not a direct proof child");
  const filesWhileStopped = await snapshotFiles(captureDir);
  const createdFiles = filesWhileStopped.filter((entry) => !beforeStall.includes(entry));
  assert(createdFiles.length === 1, `expected one stalled temp file, got ${createdFiles.length}`);
  stalledFilePath = path.join(captureDir, createdFiles[0]);
  assert(await fileExists(stalledFilePath), "stalled capture temp file was missing");

  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<{ kind: "watchdog" }>((resolve) => {
    watchdogTimer = setTimeout(() => resolve({ kind: "watchdog" }), OUTER_WATCHDOG_MS);
  });
  const firstOutcome = await Promise.race([
    stalledPromise.then((payload) => ({ kind: "result" as const, payload })),
    watchdog,
  ]);
  if (firstOutcome.kind === "result" && watchdogTimer) {
    clearTimeout(watchdogTimer);
  }

  let watchdogIntervened = false;
  let childAliveAtWatchdog: boolean | null = null;
  let tempExistsAtWatchdog: boolean | null = null;
  if (EXPECTED === "baseline") {
    assert(
      firstOutcome.kind === "watchdog",
      "baseline unexpectedly returned before outer watchdog",
    );
    watchdogIntervened = true;
    childAliveAtWatchdog = isAlive(stoppedPid);
    tempExistsAtWatchdog = await fileExists(stalledFilePath);
    assert(childAliveAtWatchdog, "baseline capture exited before outer watchdog");
    assert(tempExistsAtWatchdog, "baseline cleaned temp file before capture was reaped");
    await killTrackedCapture(stoppedPid);
  } else {
    assert(firstOutcome.kind === "result", "candidate missed the 28 second outer boundary");
  }

  const stalled = firstOutcome.kind === "result" ? firstOutcome.payload : await stalledPromise;
  const stalledDurationMs = Date.now() - stalledStartedAt;
  if (!("error" in stalled)) {
    throw new Error("stalled logbook.snapshot unexpectedly succeeded");
  }
  assert(!isAlive(stoppedPid), "stalled screencapture child was not reaped before handler return");
  assert(
    directChildPids("screencapture").length === 0,
    "handler return left a direct screencapture child",
  );
  assert(directChildPids("sips").length === 0, "stalled capture unexpectedly launched sips");
  const filesAfterStall = await snapshotFiles(captureDir);
  assert(sameFiles(filesAfterStall, beforeStall), "handler return left a temp capture behind");
  if (EXPECTED === "candidate") {
    assert(stalledDurationMs >= 24_000, `candidate returned too early: ${stalledDurationMs}ms`);
    assert(
      stalledDurationMs < OUTER_WATCHDOG_MS,
      `candidate returned too late: ${stalledDurationMs}ms`,
    );
  } else {
    assert(watchdogIntervened, "baseline did not require outer watchdog intervention");
    assert(stalledDurationMs >= OUTER_WATCHDOG_MS, "baseline did not remain stalled to watchdog");
  }

  proof.stalled = {
    childAliveAtWatchdog,
    childAliveAfterReturn: isAlive(stoppedPid),
    command: stopped.details.command,
    durationMs: stalledDurationMs,
    error: stalled.error,
    handlerReturnedBeforeWatchdog: firstOutcome.kind === "result",
    pid: stoppedPid,
    stateAfterStop: stopped.details.state,
    tempCleanAfterReturn: true,
    tempExistsAtWatchdog,
    tempFile: stalledFilePath,
    watchdogIntervened,
  };
} catch (error) {
  failure = error;
  proof.failure =
    error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
} finally {
  await killTrackedCapture(stoppedPid);
  if (stalledPromise && !stalledSettled) {
    await Promise.race([stalledPromise.catch(() => undefined), delay(2_000)]);
  }
  const filesBeforeEmergencyCleanup = await snapshotFiles(captureDir);
  const emergencyFiles = filesBeforeEmergencyCleanup.filter(
    (entry) => !initialFiles.includes(entry),
  );
  for (const file of emergencyFiles) {
    await rm(path.join(captureDir, file), { force: true });
  }
  proof.finalCleanup = {
    emergencyFiles,
    stoppedChildAlive: isAlive(stoppedPid),
    tempFiles: await snapshotFiles(captureDir),
  };
  await writeFile(path.join(artifactDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
}

console.log(JSON.stringify(proof, null, 2));
if (failure) {
  throw failure;
}
