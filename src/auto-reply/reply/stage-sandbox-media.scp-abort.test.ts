import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isPidAlive } from "../../shared/pid-alive.js";
import { withEnvAsync } from "../../test-utils/env.js";
import { killPidIfAlive, waitForPidFile, waitForPidToExit } from "../../test-utils/process-tree.js";
import {
  createSandboxMediaContexts,
  createSandboxMediaStageConfig,
  withSandboxMediaTempHome,
} from "../stage-sandbox-media.test-harness.js";

const mediaRootMocks = vi.hoisted(() => ({
  resolveChannelRemoteInboundAttachmentRoots: vi.fn(),
}));

vi.mock("../../media/channel-inbound-roots.js", () => mediaRootMocks);

import { stageSandboxMedia } from "./stage-sandbox-media.js";

async function rejectAfter<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let watchdog: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(
          () => reject(new Error("scp cancellation watchdog expired")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (watchdog) {
      clearTimeout(watchdog);
    }
  }
}

describe("stageSandboxMedia SCP cancellation", () => {
  it.runIf(process.platform !== "win32")(
    "aborts the real scp process tree without retrying or downgrading cancellation",
    { timeout: 10_000 },
    async () =>
      withSandboxMediaTempHome("openclaw-scp-abort-", async (home) => {
        const binDir = path.join(home, "bin");
        const scpPath = path.join(binDir, "scp");
        const parentPidPath = path.join(home, "parent.pid");
        const descendantPidPath = path.join(home, "descendant.pid");
        const attemptCountPath = path.join(home, "attempt-count.txt");
        const destinationPath = path.join(home, "destination.txt");
        await fs.mkdir(binDir);
        await fs.writeFile(
          scpPath,
          [
            "#!/usr/bin/env node",
            'const { spawn } = require("node:child_process");',
            'const { readFileSync, writeFileSync } = require("node:fs");',
            "let attempts = 0;",
            "try { attempts = Number(readFileSync(process.env.ATTEMPT_COUNT_FILE, 'utf8')); } catch {}",
            "writeFileSync(process.env.ATTEMPT_COUNT_FILE, String(attempts + 1));",
            "writeFileSync(process.env.DESTINATION_FILE, process.argv.at(-1));",
            "process.on('SIGTERM', () => {});",
            "const descendantSource = \"process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)\";",
            "const child = spawn(process.execPath, ['-e', descendantSource], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });",
            "child.once('message', () => {",
            "  writeFileSync(process.env.DESCENDANT_PID_FILE, String(child.pid));",
            "  writeFileSync(process.env.PARENT_PID_FILE, String(process.pid));",
            "});",
            "setInterval(() => {}, 1000);",
          ].join("\n"),
          "utf8",
        );
        await fs.chmod(scpPath, 0o700);

        const remotePath = "/Users/demo/Library/Messages/Attachments/ab/cd/photo.jpg";
        const { ctx, sessionCtx } = createSandboxMediaContexts(remotePath);
        ctx.Provider = "imessage";
        ctx.MediaRemoteHost = "gateway-host";
        sessionCtx.Provider = "imessage";
        sessionCtx.MediaRemoteHost = "gateway-host";
        mediaRootMocks.resolveChannelRemoteInboundAttachmentRoots.mockReturnValue([
          "/Users/demo/Library/Messages/Attachments",
        ]);

        let parentPid: number | undefined;
        let descendantPid: number | undefined;
        let stagingPromise: ReturnType<typeof stageSandboxMedia> | undefined;
        await withEnvAsync(
          {
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
            PARENT_PID_FILE: parentPidPath,
            DESCENDANT_PID_FILE: descendantPidPath,
            ATTEMPT_COUNT_FILE: attemptCountPath,
            DESTINATION_FILE: destinationPath,
          },
          async () => {
            const controller = new AbortController();
            const abortReason = new Error("remote media staging cancelled");
            try {
              stagingPromise = stageSandboxMedia({
                ctx,
                sessionCtx,
                cfg: createSandboxMediaStageConfig(home),
                sessionKey: "agent:main:scp-abort",
                workspaceDir: path.join(home, "workspace"),
                remoteMediaMode: "cache",
                abortSignal: controller.signal,
              });
              [parentPid, descendantPid] = await Promise.all([
                waitForPidFile(parentPidPath),
                waitForPidFile(descendantPidPath),
              ]);
              expect(isPidAlive(parentPid)).toBe(true);
              expect(isPidAlive(descendantPid)).toBe(true);

              controller.abort(abortReason);

              await expect(rejectAfter(stagingPromise, 2_000)).rejects.toBe(abortReason);
              expect(await waitForPidToExit(parentPid)).toBe(true);
              expect(await waitForPidToExit(descendantPid)).toBe(true);
              expect(await fs.readFile(attemptCountPath, "utf8")).toBe("1");
              const temporaryDownload = await fs.readFile(destinationPath, "utf8");
              await expect(fs.stat(path.dirname(temporaryDownload))).rejects.toMatchObject({
                code: "ENOENT",
              });
              expect(ctx.media?.[0]?.path).toBe(remotePath);
              expect(sessionCtx.media?.[0]?.path).toBe(remotePath);
            } finally {
              killPidIfAlive(descendantPid);
              killPidIfAlive(parentPid);
              await stagingPromise?.catch(() => {});
            }
          },
        );
      }),
  );
});
