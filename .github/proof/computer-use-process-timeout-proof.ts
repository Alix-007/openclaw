import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import {
  killStaleComputerUseMcpChildren,
  runCodexComputerUseLiveTest,
} from "../../extensions/codex/src/app-server/computer-use.ts";
import { resolveCodexComputerUseConfig } from "../../extensions/codex/src/app-server/config.ts";

const WATCHDOG_MS = 6_000;
const EXPECTED = process.env.COMPUTER_USE_PROOF_EXPECT;

if (EXPECTED !== "stalled" && EXPECTED !== "recovered") {
  throw new Error(`unexpected COMPUTER_USE_PROOF_EXPECT: ${String(EXPECTED)}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function directPsChildren(): number[] {
  try {
    const stdout = execFileSync("/usr/bin/pgrep", ["-P", String(process.pid), "-x", "ps"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout
      .trim()
      .split(/\s+/u)
      .map(Number)
      .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function stopNextProcessList(): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    for (const pid of directPsChildren()) {
      try {
        process.kill(pid, "SIGSTOP");
        const state = execFileSync("/bin/ps", ["-o", "state=", "-p", String(pid)], {
          encoding: "utf8",
        }).trim();
        if (state.startsWith("T")) {
          return pid;
        }
      } catch {
        // A normal /bin/ps can finish before the observer stops it. Keep looking.
      }
    }
    await delay(0);
  }
  throw new Error("did not observe a live /bin/ps child to stop");
}

function spawnComputerUseChild(): ChildProcess {
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", "SkyComputerUseClient", "mcp"],
    { stdio: "ignore" },
  );
  assert(typeof child.pid === "number", "Computer Use proof child did not start");
  return child;
}

function commandForPid(pid: number): string {
  return execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], {
    encoding: "utf8",
  }).trim();
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || !isAlive(child.pid)) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(1_000).then(() => {
      if (child.pid && isAlive(child.pid)) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

async function stopPid(pid: number | undefined): Promise<void> {
  if (!pid || !isAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGCONT");
  } catch {}
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

const normalStartedAt = Date.now();
const normal = await killStaleComputerUseMcpChildren({ ancestorPid: process.pid });
const normalDurationMs = Date.now() - normalStartedAt;
assert(normal.attempted, "normal process inspection was not attempted");
assert(normal.warnings.length === 0, `normal process inspection warned: ${normal.warnings.join("; ")}`);
assert(normal.killedPids.length === 0, "normal process inspection unexpectedly killed a process");

let stoppedPsPid: number | undefined;
let computerUseChild: ChildProcess | undefined;
let computerUseChildCommand = "";
let computerUseChildAliveAtRetry = false;
let watchdogIntervened = false;

try {
  let threadStarts = 0;
  let toolCalls = 0;
  const config = resolveCodexComputerUseConfig({
    env: {},
    overrides: {
      autoRepair: true,
      enabled: true,
      liveTestTimeoutMs: 1_000,
      toolCallTimeoutMs: 1_000,
    },
  });

  const stopPsPromise = stopNextProcessList();
  const startedAt = Date.now();
  const liveTestPromise = runCodexComputerUseLiveTest({
    config,
    repairComputerUseMcpChildren: () =>
      killStaleComputerUseMcpChildren({ ancestorPid: process.pid }),
    request: async <T>(method: string): Promise<T> => {
      if (method === "thread/start") {
        threadStarts += 1;
        if (threadStarts === 2 && computerUseChild?.pid) {
          computerUseChildAliveAtRetry = isAlive(computerUseChild.pid);
        }
        return { thread: { id: `proof-${threadStarts}` } } as T;
      }
      if (method === "mcpServer/tool/call") {
        toolCalls += 1;
        if (toolCalls === 1) {
          throw new Error("proof forces the first Computer Use tool call to fail");
        }
      }
      return undefined as T;
    },
  });

  stoppedPsPid = await stopPsPromise;
  computerUseChild = spawnComputerUseChild();
  assert(isAlive(computerUseChild.pid as number), "Computer Use proof child exited early");
  computerUseChildCommand = commandForPid(computerUseChild.pid as number);
  assert(
    computerUseChildCommand.includes("SkyComputerUseClient") &&
      /(?:^|\s)mcp(?:\s|$)/u.test(computerUseChildCommand),
    `proof child does not match the Computer Use repair predicate: ${computerUseChildCommand}`,
  );

  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<{ kind: "watchdog" }>((resolve) => {
    watchdogTimer = setTimeout(() => resolve({ kind: "watchdog" }), WATCHDOG_MS);
  });
  const firstOutcome = await Promise.race([
    liveTestPromise.then((result) => ({ kind: "result" as const, result })),
    watchdog,
  ]);
  if (firstOutcome.kind === "result" && watchdogTimer) {
    clearTimeout(watchdogTimer);
  }

  if (EXPECTED === "stalled") {
    assert(firstOutcome.kind === "watchdog", "baseline unexpectedly recovered without a deadline");
    watchdogIntervened = true;
    assert(isAlive(stoppedPsPid), "baseline /bin/ps did not remain stalled until watchdog");
    assert(
      isAlive(computerUseChild.pid as number),
      "baseline killed the Computer Use child while process inspection was stalled",
    );
    process.kill(stoppedPsPid, "SIGKILL");
  } else {
    assert(firstOutcome.kind === "result", "candidate did not recover before the outer watchdog");
  }

  const result =
    firstOutcome.kind === "result" ? firstOutcome.result : await liveTestPromise;
  const elapsedMs = Date.now() - startedAt;
  const repair = result.repair;

  assert(result.liveTest.ok, "Computer Use retry did not succeed");
  assert(result.liveTest.attempts === 2, `expected two attempts, got ${result.liveTest.attempts}`);
  assert(result.liveTest.retried, "Computer Use live test did not report a retry");
  assert(repair?.attempted, "Computer Use repair was not attempted");
  assert(repair.killedPids.length === 0, "timeout repair killed a Computer Use child");
  assert(
    repair.warnings.some((warning) => warning.includes("Could not list processes")),
    `missing process-list warning: ${repair.warnings.join("; ")}`,
  );
  assert(computerUseChildAliveAtRetry, "Computer Use child was not alive when retry began");
  assert(!isAlive(stoppedPsPid), "stopped /bin/ps remained after repair completed");
  assert(
    EXPECTED === "stalled" ? elapsedMs >= WATCHDOG_MS : elapsedMs < WATCHDOG_MS,
    `unexpected elapsed time for ${EXPECTED}: ${elapsedMs}ms`,
  );

  const proof = {
    expected: EXPECTED,
    normalInspection: {
      durationMs: normalDurationMs,
      killedPids: normal.killedPids,
      warnings: normal.warnings,
    },
    stalledInspection: {
      elapsedMs,
      stoppedPsPid,
      psReaped: !isAlive(stoppedPsPid),
      watchdogIntervened,
    },
    failureBoundary: {
      computerUseChildCommand,
      computerUseChildAliveAtRetry,
      killedPids: repair.killedPids,
      warning: repair.warnings[0],
    },
    retry: {
      attempts: result.liveTest.attempts,
      ok: result.liveTest.ok,
      retried: result.liveTest.retried,
      threadStarts,
      toolCalls,
    },
  };

  await mkdir(".artifacts/computer-use-process-timeout", { recursive: true });
  await writeFile(
    ".artifacts/computer-use-process-timeout/proof.json",
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await stopPid(stoppedPsPid);
  await stopChild(computerUseChild);
}
