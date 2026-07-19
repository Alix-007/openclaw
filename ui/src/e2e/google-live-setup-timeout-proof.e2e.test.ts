// Proof-only Control UI coverage for a Google Live socket stalled before setupComplete.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
} from "../test-helpers/control-ui-e2e.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const expectedOutcome = process.env.GOOGLE_LIVE_PROOF_EXPECT;
const productSha = process.env.GOOGLE_LIVE_PRODUCT_SHA;
const artifactDir = path.resolve(
  process.cwd(),
  ".artifacts/control-ui-e2e/google-live-setup-timeout",
);

if (expectedOutcome !== "stalled" && expectedOutcome !== "recovered") {
  throw new Error("GOOGLE_LIVE_PROOF_EXPECT must be stalled or recovered");
}
if (!productSha) {
  throw new Error("GOOGLE_LIVE_PRODUCT_SHA is required");
}

let browser: Browser;
let server: ControlUiE2eServer;

type ResourceSnapshot = {
  constraints: unknown[];
  tracks: Array<{ kind: string; readyState: MediaStreamTrackState }>;
  trackStopCalls: number;
  audioContexts: Array<{ closeCalls: number; sampleRate: number }>;
  audioNodes: Array<{
    connectCalls: number;
    disconnectCalls: number;
    kind: "analyser" | "gain" | "processor" | "source";
    processorAttached?: boolean;
  }>;
  meterIntervals: Array<{ cleared: boolean; delay: number }>;
};

async function installResourceProbe(page: Page) {
  await page.addInitScript(() => {
    type ProbeNode = {
      connectCalls: number;
      disconnectCalls: number;
      kind: "analyser" | "gain" | "processor" | "source";
      onaudioprocess?: ((event: AudioProcessingEvent) => void) | null;
    };
    type ProbeState = {
      constraints: unknown[];
      tracks: MediaStreamTrack[];
      trackStopCalls: number;
      audioContexts: Array<{ closeCalls: number; sampleRate: number }>;
      audioNodes: ProbeNode[];
      meterIntervals: Array<{ cleared: boolean; delay: number }>;
    };

    const state: ProbeState = {
      constraints: [],
      tracks: [],
      trackStopCalls: 0,
      audioContexts: [],
      audioNodes: [],
      meterIntervals: [],
    };
    Object.assign(window, { __googleLiveTimeoutProof: state });

    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        state.constraints.push(constraints);
        const stream = await nativeGetUserMedia(constraints);
        for (const track of stream.getTracks()) {
          const nativeStop = track.stop.bind(track);
          Object.defineProperty(track, "stop", {
            configurable: true,
            value: () => {
              state.trackStopCalls += 1;
              nativeStop();
            },
          });
          state.tracks.push(track);
        }
        return stream;
      },
    });

    function createNode(kind: ProbeNode["kind"]): ProbeNode & {
      connect: () => void;
      disconnect: () => void;
    } {
      const node = {
        kind,
        connectCalls: 0,
        disconnectCalls: 0,
        connect() {
          node.connectCalls += 1;
        },
        disconnect() {
          node.disconnectCalls += 1;
        },
      };
      state.audioNodes.push(node);
      return node;
    }

    class ProbeAudioContext {
      readonly currentTime = 0;
      readonly destination = {};
      readonly sampleRate: number;
      private readonly record: { closeCalls: number; sampleRate: number };

      constructor(options?: { sampleRate?: number }) {
        this.sampleRate = options?.sampleRate ?? 24_000;
        this.record = { closeCalls: 0, sampleRate: this.sampleRate };
        state.audioContexts.push(this.record);
      }

      createMediaStreamSource() {
        return createNode("source");
      }

      createScriptProcessor() {
        const processor = Object.assign(createNode("processor"), {
          onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null,
        });
        return processor;
      }

      createGain() {
        return Object.assign(createNode("gain"), { gain: { value: 1 } });
      }

      createAnalyser() {
        return Object.assign(createNode("analyser"), {
          fftSize: 0,
          smoothingTimeConstant: 0,
          getFloatTimeDomainData(samples: Float32Array) {
            samples.fill(0.2);
          },
        });
      }

      async close() {
        this.record.closeCalls += 1;
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: ProbeAudioContext,
    });
  });
}

async function installMeterTimerProbe(page: Page) {
  await page.evaluate(() => {
    const state = (
      window as unknown as {
        __googleLiveTimeoutProof: {
          meterIntervals: Array<{ cleared: boolean; delay: number }>;
        };
      }
    ).__googleLiveTimeoutProof;
    const intervalRecords = new Map<number, { cleared: boolean; delay: number }>();
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);

    window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = nativeSetInterval(handler, delay, ...args);
      if (delay === 100) {
        const record = { cleared: false, delay };
        state.meterIntervals.push(record);
        intervalRecords.set(id, record);
      }
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      const record = id === undefined ? undefined : intervalRecords.get(id);
      if (record) {
        record.cleared = true;
      }
      nativeClearInterval(id);
    }) as typeof window.clearInterval;
  });
}

async function readResourceSnapshot(page: Page): Promise<ResourceSnapshot> {
  return await page.evaluate(() => {
    const state = (
      window as unknown as {
        __googleLiveTimeoutProof: {
          constraints: unknown[];
          tracks: MediaStreamTrack[];
          trackStopCalls: number;
          audioContexts: Array<{ closeCalls: number; sampleRate: number }>;
          audioNodes: Array<{
            connectCalls: number;
            disconnectCalls: number;
            kind: "analyser" | "gain" | "processor" | "source";
            onaudioprocess?: ((event: AudioProcessingEvent) => void) | null;
          }>;
          meterIntervals: Array<{ cleared: boolean; delay: number }>;
        };
      }
    ).__googleLiveTimeoutProof;
    return {
      constraints: state.constraints,
      tracks: state.tracks.map((track) => ({ kind: track.kind, readyState: track.readyState })),
      trackStopCalls: state.trackStopCalls,
      audioContexts: state.audioContexts.map((context) => ({ ...context })),
      audioNodes: state.audioNodes.map((node) => ({
        connectCalls: node.connectCalls,
        disconnectCalls: node.disconnectCalls,
        kind: node.kind,
        ...(node.kind === "processor"
          ? { processorAttached: typeof node.onaudioprocess === "function" }
          : {}),
      })),
      meterIntervals: state.meterIntervals.map((interval) => ({ ...interval })),
    };
  });
}

async function captureScreenshot(page: Page, name: string) {
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(artifactDir, name),
  });
}

describe("Google Live setup timeout browser proof", () => {
  beforeAll(async () => {
    if (!canRunPlaywrightChromium(chromiumExecutablePath)) {
      throw new Error(`Playwright Chromium is unavailable at ${chromiumExecutablePath}`);
    }
    server = await startControlUiE2eServer();
    browser = await chromium.launch({
      executablePath: chromiumExecutablePath,
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("compares a setup-stalled browser session after 30 seconds", async () => {
    const context = await browser.newContext({
      colorScheme: "dark",
      locale: "en-US",
      permissions: ["microphone"],
      serviceWorkers: "block",
      viewport: { height: 1000, width: 1440 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      deferredMethods: ["talk.client.create"],
      methodResponses: {
        "talk.catalog": {
          realtime: {
            activeProvider: "google",
            providers: [{ id: "google", label: "Google", supportsVideoFrames: true }],
          },
        },
      },
    });
    const socketMessages: unknown[] = [];
    let socketClosed = false;
    let socketUrl = "";
    await installResourceProbe(page);
    await page.routeWebSocket("wss://generativelanguage.googleapis.com/**", (ws) => {
      socketUrl = ws.url();
      ws.onMessage((message) => {
        socketMessages.push(
          JSON.parse(typeof message === "string" ? message : message.toString()) as unknown,
        );
      });
      ws.onClose(() => {
        socketClosed = true;
      });
    });

    try {
      const response = await page.goto(`${server.baseUrl}chat`);
      expect(response?.status()).toBe(200);
      await page.getByRole("button", { name: "Start voice input" }).click();
      const createRequest = await gateway.waitForRequest("talk.client.create");
      expect(createRequest.params).toMatchObject({ sessionKey: "main" });
      await expect
        .poll(() => page.locator('.agent-chat__voice-activity[data-status="connecting"]').count())
        .toBe(1);

      // Install the deterministic clock only after the mock Gateway is ready;
      // the deferred session response makes the 30s product timer start at zero.
      await page.clock.install({ time: new Date("2026-07-19T00:00:00.000Z") });
      await installMeterTimerProbe(page);
      await gateway.resolveDeferred("talk.client.create", {
        provider: "google",
        transport: "provider-websocket",
        protocol: "google-live-bidi",
        clientSecret: ["auth_tokens", "google-live-timeout-proof"].join("/"),
        websocketUrl:
          "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained",
        audio: {
          inputEncoding: "pcm16",
          inputSampleRateHz: 16_000,
          outputEncoding: "pcm16",
          outputSampleRateHz: 24_000,
        },
      });

      await expect
        .poll(() => socketMessages.some((message) => JSON.stringify(message).includes('"setup"')))
        .toBe(true);
      await expect.poll(async () => (await readResourceSnapshot(page)).tracks.length).toBe(1);
      await expect.poll(async () => (await readResourceSnapshot(page)).audioContexts.length).toBe(2);
      const before = await readResourceSnapshot(page);
      expect(before.tracks).toEqual([{ kind: "audio", readyState: "live" }]);
      expect(before.audioNodes.map((node) => node.kind).sort()).toEqual([
        "analyser",
        "gain",
        "processor",
        "source",
        "source",
      ]);
      expect(before.meterIntervals).toEqual([{ cleared: false, delay: 100 }]);
      await captureScreenshot(page, `${expectedOutcome}-01-connecting.png`);

      await page.clock.runFor(30_000);
      await page.evaluate(() => Promise.resolve());

      if (expectedOutcome === "stalled") {
        await expect
          .poll(() => page.locator('.agent-chat__voice-activity[data-status="connecting"]').count())
          .toBe(1);
        await expect
          .poll(() => page.getByText("Realtime connection timed out after 30000ms").count())
          .toBe(0);
      } else {
        await expect
          .poll(() => page.getByRole("alert").textContent())
          .toContain("Realtime connection timed out after 30000ms");
        await expect.poll(async () => (await readResourceSnapshot(page)).trackStopCalls).toBe(1);
        await expect.poll(() => socketClosed).toBe(true);
      }

      const after = await readResourceSnapshot(page);
      if (expectedOutcome === "stalled") {
        expect(after.tracks).toEqual([{ kind: "audio", readyState: "live" }]);
        expect(after.trackStopCalls).toBe(0);
        expect(after.audioContexts.map((context) => context.closeCalls)).toEqual([0, 0]);
        expect(after.audioNodes.every((node) => node.disconnectCalls === 0)).toBe(true);
        expect(after.audioNodes.find((node) => node.kind === "processor")?.processorAttached).toBe(
          true,
        );
        expect(after.meterIntervals).toEqual([{ cleared: false, delay: 100 }]);
        expect(socketClosed).toBe(false);
      } else {
        expect(after.tracks).toEqual([{ kind: "audio", readyState: "ended" }]);
        expect(after.audioContexts.map((context) => context.closeCalls)).toEqual([1, 1]);
        expect(after.audioNodes.every((node) => node.disconnectCalls === 1)).toBe(true);
        expect(after.audioNodes.find((node) => node.kind === "processor")?.processorAttached).toBe(
          false,
        );
        expect(after.meterIntervals).toEqual([{ cleared: true, delay: 100 }]);
      }

      await captureScreenshot(page, `${expectedOutcome}-02-after-30000ms.png`);
      await writeFile(
        path.join(artifactDir, `${expectedOutcome}-resources.json`),
        `${JSON.stringify(
          {
            expectedOutcome,
            productSha,
            elapsedBrowserClockMs: 30_000,
            socket: { closed: socketClosed, messageCount: socketMessages.length, url: socketUrl },
            before,
            after,
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await context.close();
    }
  });
});
