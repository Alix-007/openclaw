import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { createOpenClawTestInstance } from "./helpers/openclaw-test-instance.js";

const EXPECTED_HEAD = "3870829db9447feb84a4af34d415a29d719fdc30";
const RELAY_TOKEN = "ab".repeat(32);
const ARTIFACT_DIR = path.resolve(".local/pr125176-proof");
const OBSERVER_PATH = fileURLToPath(
  new URL("./fixtures/pr125176-browser-relay-observer.mjs", import.meta.url),
);

type ObserverEvent = {
  event: string;
  atNs: string;
  module?: string;
};

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to allocate proof port");
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function portIsOpen(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function waitForPort(port: number, expected: boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((await portIsOpen(port)) !== expected) {
    if (Date.now() >= deadline) {
      throw new Error(`port ${port} did not become ${expected ? "open" : "closed"}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

async function readObserverEvents(filePath: string): Promise<ObserverEvent[]> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ObserverEvent);
}

async function writeRelaySecret(stateDir: string): Promise<void> {
  const credentialsDir = path.join(stateDir, "credentials");
  await fs.mkdir(credentialsDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(credentialsDir, "browser-extension-relay.secret"),
    `${RELAY_TOKEN}\n`,
    {
      mode: 0o600,
    },
  );
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForSocketClose(
  socket: WebSocket,
): Promise<{ code: number; reason: string; atNs: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("direct relay WebSocket did not close")),
      10_000,
    );
    socket.once("close", (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString("utf8"), atNs: process.hrtime.bigint().toString() });
    });
  });
}

function browserConfig(relayPort: number): Record<string, unknown> {
  return {
    browser: {
      enabled: true,
      extensionRelay: { allowLegacyAuth: true },
      profiles: { proof: { driver: "extension", cdpPort: relayPort } },
    },
  };
}

function proofEnv(observerLog: string): Record<string, string | undefined> {
  return {
    NODE_OPTIONS: `--import=${OBSERVER_PATH}`,
    OPENCLAW_PR125176_OBSERVER_LOG: observerLog,
    OPENCLAW_EAGER_BROWSER_CONTROL_SERVER: undefined,
    OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: undefined,
    OPENCLAW_TEST_MINIMAL_GATEWAY: undefined,
  };
}

it(
  "proves real direct relay activity closes through canonical Gateway shutdown",
  { timeout: 600_000 },
  async () => {
    expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(
      EXPECTED_HEAD,
    );
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    const coldObserverLog = path.join(ARTIFACT_DIR, "cold-observer.jsonl");
    const directObserverLog = path.join(ARTIFACT_DIR, "direct-observer.jsonl");
    await Promise.all([
      fs.rm(coldObserverLog, { force: true }),
      fs.rm(directObserverLog, { force: true }),
    ]);

    const coldRelayPort = await getFreePort();
    const cold = await createOpenClawTestInstance({
      name: "pr125176-cold",
      config: browserConfig(coldRelayPort),
      env: proofEnv(coldObserverLog),
      startTimeoutMs: 180_000,
      stopTimeoutMs: 10_000,
    });
    try {
      await writeRelaySecret(cold.stateDir);
      await cold.startGateway();
      expect(await portIsOpen(coldRelayPort)).toBe(false);
      await cold.stopGateway();
      await waitForPort(cold.port, false);
      const coldEvents = await readObserverEvents(coldObserverLog);
      expect(coldEvents.filter((event) => event.event === "browser.runtime.resolve")).toHaveLength(
        0,
      );
      expect(coldEvents.filter((event) => event.event.startsWith("direct."))).toHaveLength(0);
    } finally {
      await cold.cleanup();
    }

    const directRelayPort = await getFreePort();
    const direct = await createOpenClawTestInstance({
      name: "pr125176-direct",
      config: browserConfig(directRelayPort),
      env: proofEnv(directObserverLog),
      startTimeoutMs: 180_000,
      stopTimeoutMs: 10_000,
    });
    let socket: WebSocket | undefined;
    let closeResult: { code: number; reason: string; atNs: string } | undefined;
    try {
      await writeRelaySecret(direct.stateDir);
      await direct.startGateway();
      expect(
        (await readObserverEvents(directObserverLog)).filter(
          (event) => event.event === "browser.runtime.resolve",
        ),
      ).toHaveLength(0);

      socket = new WebSocket(
        `ws://127.0.0.1:${direct.port}/browser/extension?profile=proof`,
        ["openclaw-extension-relay", `openclaw-extension-token.${RELAY_TOKEN}`],
        { origin: "chrome-extension://pr125176-proof" },
      );
      await waitForSocketOpen(socket);
      await waitForPort(directRelayPort, true);
      const closePromise = waitForSocketClose(socket);

      await direct.stopGateway();
      closeResult = await closePromise;
      await Promise.all([waitForPort(direct.port, false), waitForPort(directRelayPort, false)]);

      const events = await readObserverEvents(directObserverLog);
      const eventNames = events.map((event) => event.event);
      expect(eventNames).toContain("browser.runtime.resolve");
      expect(eventNames).toContain("direct.handleUpgrade");
      expect(eventNames).toContain("direct.socket.terminate");
      expect(eventNames).toContain("direct.server.close");
      expect(eventNames.indexOf("direct.socket.terminate")).toBeLessThan(
        eventNames.indexOf("direct.server.close"),
      );

      const result = {
        verdict: "PASS",
        head: EXPECTED_HEAD,
        node: process.version,
        cold: {
          browserRuntimeResolves: 0,
          directRelayEvents: 0,
          relayPortClosed: true,
          gatewayPortClosed: true,
        },
        direct: {
          observerEvents: eventNames,
          browserRuntimePrepared: true,
          websocketOpened: true,
          websocketClosedByCanonicalDispose: true,
          websocketCloseCode: closeResult.code,
          websocketCloseReason: closeResult.reason,
          relayPortClosed: true,
          gatewayPortClosed: true,
        },
      };
      const artifact = `${JSON.stringify(result, null, 2)}\n`;
      const artifactPath = path.join(ARTIFACT_DIR, "result.json");
      await fs.writeFile(artifactPath, artifact);
      const sha256 = createHash("sha256").update(artifact).digest("hex");
      process.stdout.write(
        `PR125176_REAL_BEHAVIOR_PROOF ${JSON.stringify({ ...result, artifactPath, sha256 })}\n`,
      );
    } finally {
      socket?.terminate();
      await direct.cleanup();
    }
  },
);
