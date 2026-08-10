import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { GatewayServer } from "../../../src/gateway/server.js";
import { getFreeGatewayPort } from "../../../src/gateway/test-helpers.e2e.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../../../src/test-utils/openclaw-test-state.js";
import {
  canRunPlaywrightChromium,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
} from "../test-helpers/control-ui-e2e.ts";

type HeldResponseEvidence = {
  capturedSha256: string | null;
  cronAddRequests: number;
  cronListRequests: number;
  cronStatusRequests: number;
  cronUpdateRequests: number;
  heldSnapshotJobs: number | null;
  heldScopeNextWakeAtMs: number | null;
  heldScopeNextWakeCapturedSha256: string | null;
  heldScopeNextWakeReleasedSha256: string | null;
  heldScopeTotal: number | null;
  heldScopeTotalCapturedSha256: string | null;
  heldScopeTotalReleasedSha256: string | null;
  modelListFixtureRequests: number;
  releasedSha256: string | null;
  scopedNextWakeRequests: number;
  scopedRequestsAfterLatestCronUpdate: number;
  scopedTotalRequests: number;
};

type HeldFrame = {
  data: Buffer;
  isBinary: boolean;
};

type CronScopeResponseKind = "next-wake" | "total";

type DelayProxy = {
  armCronScopeHold: () => void;
  armCronStatusHold: () => void;
  close: () => Promise<void>;
  evidence: HeldResponseEvidence;
  releaseHeldScopeResponses: () => void;
  releaseHeldResponse: () => void;
  waitForHeldScopeResponses: () => Promise<void>;
  waitForHeldResponse: () => Promise<void>;
  url: string;
};

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const describeRuntimeProof = chromiumAvailable ? describe : describe.skip;
const proofHeadSha = process.env.OPENCLAW_PROOF_HEAD_SHA?.trim() || "unknown";
const artifactDir = path.resolve(
  process.cwd(),
  process.env.OPENCLAW_PROOF_ARTIFACT_DIR?.trim() || "proof-artifacts",
);
const authValue = "cron-proof-token";

let browser: Browser;
let browserContext: BrowserContext;
let controlUi: ControlUiE2eServer;
let gateway: GatewayServer;
let proxy: DelayProxy;
let state: OpenClawTestState;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseFrame(data: RawData): Record<string, unknown> | null {
  try {
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Buffer.from(data);
    return asRecord(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 30_000);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function startProxyConnection(params: {
  activeSockets: Set<WebSocket>;
  browserSocket: WebSocket;
  evidence: HeldResponseEvidence;
  getArmed: () => boolean;
  getHeldRequestId: () => string | null;
  getHeldScopeRequestKind: (id: string) => CronScopeResponseKind | null;
  getScopeArmed: () => boolean;
  request: IncomingMessage;
  setHeldFrame: (frame: HeldFrame, jobs: number | null) => void;
  setHeldRequestId: (id: string) => void;
  setHeldScopeFrame: (
    kind: CronScopeResponseKind,
    frame: HeldFrame,
    payload: Record<string, unknown> | null,
  ) => void;
  setHeldScopeRequest: (id: string, kind: CronScopeResponseKind) => void;
  upstreamUrl: string;
}): void {
  const origin =
    typeof params.request.headers.origin === "string" ? params.request.headers.origin : undefined;
  const upstream = new WebSocket(params.upstreamUrl, { origin });
  params.activeSockets.add(params.browserSocket);
  params.activeSockets.add(upstream);
  const pendingBrowserFrames: Array<{ data: RawData; isBinary: boolean }> = [];

  params.browserSocket.on("message", (data, isBinary) => {
    const frame = parseFrame(data);
    if (frame?.type === "req" && typeof frame.method === "string") {
      if (frame.method === "cron.add") {
        params.evidence.cronAddRequests += 1;
      } else if (frame.method === "cron.update") {
        params.evidence.cronUpdateRequests += 1;
        params.evidence.scopedRequestsAfterLatestCronUpdate = 0;
      } else if (frame.method === "cron.status") {
        params.evidence.cronStatusRequests += 1;
        if (
          params.getArmed() &&
          params.getHeldRequestId() === null &&
          typeof frame.id === "string"
        ) {
          params.setHeldRequestId(frame.id);
        }
      } else if (frame.method === "cron.list") {
        params.evidence.cronListRequests += 1;
        const requestParams = asRecord(frame.params);
        const scopeKind: CronScopeResponseKind | null =
          requestParams?.agentId === "main" &&
          requestParams.limit === 1 &&
          requestParams.includeDisabled === true
            ? "total"
            : requestParams?.agentId === "main" &&
                requestParams.limit === 1 &&
                requestParams.sortBy === "nextRunAtMs"
              ? "next-wake"
              : null;
        if (scopeKind) {
          if (scopeKind === "total") {
            params.evidence.scopedTotalRequests += 1;
          } else {
            params.evidence.scopedNextWakeRequests += 1;
          }
          if (params.evidence.cronUpdateRequests > 0) {
            params.evidence.scopedRequestsAfterLatestCronUpdate += 1;
          }
          if (
            params.getScopeArmed() &&
            typeof frame.id === "string" &&
            params.getHeldScopeRequestKind(frame.id) === null
          ) {
            params.setHeldScopeRequest(frame.id, scopeKind);
          }
        }
      } else if (frame.method === "models.list" && typeof frame.id === "string") {
        // Model discovery is unrelated to the Cron ordering invariant and can
        // dominate constrained CI. Keep that peripheral dependency controlled.
        params.evidence.modelListFixtureRequests += 1;
        params.browserSocket.send(
          JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { models: [] } }),
        );
        return;
      }
    }
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else {
      pendingBrowserFrames.push({ data, isBinary });
    }
  });

  upstream.on("open", () => {
    for (const frame of pendingBrowserFrames.splice(0)) {
      upstream.send(frame.data, { binary: frame.isBinary });
    }
  });

  upstream.on("message", (data, isBinary) => {
    const frame = parseFrame(data);
    const scopeKind =
      frame?.type === "res" && typeof frame.id === "string"
        ? params.getHeldScopeRequestKind(frame.id)
        : null;
    if (scopeKind) {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.from(data);
      params.setHeldScopeFrame(
        scopeKind,
        bytes.length > 0 ? { data: bytes, isBinary } : { data: Buffer.alloc(0), isBinary },
        asRecord(frame?.payload),
      );
      return;
    }
    if (
      frame?.type === "res" &&
      typeof frame.id === "string" &&
      frame.id === params.getHeldRequestId()
    ) {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.from(data);
      const payload = asRecord(frame.payload);
      params.setHeldFrame(
        bytes.length > 0 ? { data: bytes, isBinary } : { data: Buffer.alloc(0), isBinary },
        typeof payload?.jobs === "number" ? payload.jobs : null,
      );
      return;
    }
    if (params.browserSocket.readyState === WebSocket.OPEN) {
      params.browserSocket.send(data, { binary: isBinary });
    }
  });

  const closePeer = () => {
    if (params.browserSocket.readyState === WebSocket.OPEN) {
      params.browserSocket.close();
    }
  };
  upstream.on("error", closePeer);
  upstream.on("close", (code, reason) => {
    params.activeSockets.delete(upstream);
    if (params.browserSocket.readyState === WebSocket.OPEN) {
      params.browserSocket.close(code, reason.toString().slice(0, 120));
    }
  });
  params.browserSocket.on("close", () => {
    params.activeSockets.delete(params.browserSocket);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  });
}

async function startCronStatusDelayProxy(upstreamUrl: string): Promise<DelayProxy> {
  const evidence: HeldResponseEvidence = {
    capturedSha256: null,
    cronAddRequests: 0,
    cronListRequests: 0,
    cronStatusRequests: 0,
    cronUpdateRequests: 0,
    heldSnapshotJobs: null,
    heldScopeNextWakeAtMs: null,
    heldScopeNextWakeCapturedSha256: null,
    heldScopeNextWakeReleasedSha256: null,
    heldScopeTotal: null,
    heldScopeTotalCapturedSha256: null,
    heldScopeTotalReleasedSha256: null,
    modelListFixtureRequests: 0,
    releasedSha256: null,
    scopedNextWakeRequests: 0,
    scopedRequestsAfterLatestCronUpdate: 0,
    scopedTotalRequests: 0,
  };
  const activeSockets = new Set<WebSocket>();
  const websocketServer = new WebSocketServer({ noServer: true });
  const server: Server = createServer((_request, response) => response.writeHead(404).end());
  let armed = false;
  let browserSocket: WebSocket | null = null;
  let heldFrame: HeldFrame | null = null;
  let heldRequestId: string | null = null;
  const heldScopeFrames = new Map<CronScopeResponseKind, HeldFrame>();
  const heldScopeRequestKinds = new Map<string, CronScopeResponseKind>();
  let resolveHeld: (() => void) | null = null;
  let resolveHeldScope: (() => void) | null = null;
  let heldPromise: Promise<void> | null = null;
  let heldScopePromise: Promise<void> | null = null;
  let scopeArmed = false;

  server.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (acceptedSocket) => {
      browserSocket = acceptedSocket;
      startProxyConnection({
        activeSockets,
        browserSocket: acceptedSocket,
        evidence,
        getArmed: () => armed,
        getHeldRequestId: () => heldRequestId,
        getHeldScopeRequestKind: (id) => heldScopeRequestKinds.get(id) ?? null,
        getScopeArmed: () => scopeArmed,
        request,
        setHeldFrame: (frame, jobs) => {
          heldFrame = frame;
          evidence.capturedSha256 = sha256(frame.data);
          evidence.heldSnapshotJobs = jobs;
          resolveHeld?.();
        },
        setHeldRequestId: (id) => {
          heldRequestId = id;
        },
        setHeldScopeFrame: (kind, frame, payload) => {
          heldScopeFrames.set(kind, frame);
          const digest = sha256(frame.data);
          if (kind === "total") {
            evidence.heldScopeTotalCapturedSha256 = digest;
            evidence.heldScopeTotal = typeof payload?.total === "number" ? payload.total : null;
          } else {
            evidence.heldScopeNextWakeCapturedSha256 = digest;
            const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
            const first = asRecord(jobs[0]);
            const jobState = asRecord(first?.state);
            evidence.heldScopeNextWakeAtMs =
              typeof jobState?.nextRunAtMs === "number" ? jobState.nextRunAtMs : null;
          }
          if (heldScopeFrames.size === 2) {
            resolveHeldScope?.();
          }
        },
        setHeldScopeRequest: (id, kind) => {
          if (![...heldScopeRequestKinds.values()].includes(kind)) {
            heldScopeRequestKinds.set(id, kind);
          }
        },
        upstreamUrl,
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("cron response delay proxy did not bind a TCP port");
  }

  return {
    armCronScopeHold() {
      if (scopeArmed || heldScopeFrames.size > 0) {
        throw new Error("cron scoped response hold already armed");
      }
      scopeArmed = true;
      heldScopePromise = new Promise<void>((resolve) => {
        resolveHeldScope = resolve;
      });
    },
    armCronStatusHold() {
      if (armed || heldFrame) {
        throw new Error("cron response hold already armed");
      }
      armed = true;
      heldPromise = new Promise<void>((resolve) => {
        resolveHeld = resolve;
      });
    },
    close: async () => {
      for (const socket of activeSockets) {
        socket.terminate();
      }
      activeSockets.clear();
      await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    evidence,
    releaseHeldScopeResponses() {
      if (!browserSocket || browserSocket.readyState !== WebSocket.OPEN) {
        throw new Error("browser socket is not ready for scoped response release");
      }
      for (const kind of ["total", "next-wake"] as const) {
        const frame = heldScopeFrames.get(kind);
        if (!frame) {
          throw new Error(`held cron ${kind} response is not ready for release`);
        }
        const digest = sha256(frame.data);
        if (kind === "total") {
          evidence.heldScopeTotalReleasedSha256 = digest;
        } else {
          evidence.heldScopeNextWakeReleasedSha256 = digest;
        }
        browserSocket.send(frame.data, { binary: frame.isBinary });
      }
      heldScopeFrames.clear();
      heldScopeRequestKinds.clear();
      scopeArmed = false;
    },
    releaseHeldResponse() {
      if (!heldFrame || !browserSocket || browserSocket.readyState !== WebSocket.OPEN) {
        throw new Error("held cron response is not ready for release");
      }
      evidence.releasedSha256 = sha256(heldFrame.data);
      browserSocket.send(heldFrame.data, { binary: heldFrame.isBinary });
      heldFrame = null;
      armed = false;
    },
    async waitForHeldResponse() {
      if (!heldPromise) {
        throw new Error("cron response hold is not armed");
      }
      await withTimeout(heldPromise, "real cron.status response");
    },
    async waitForHeldScopeResponses() {
      if (!heldScopePromise) {
        throw new Error("cron scoped response hold is not armed");
      }
      await withTimeout(heldScopePromise, "real agent-scoped cron.list responses");
    },
    url: `ws://127.0.0.1:${address.port}`,
  };
}

async function mountCronPage(page: Page, gatewayUrl: string): Promise<string> {
  await page.route(`${controlUi.baseUrl}cron-runtime-proof`, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><main id="mount"></main>
<script type="module">
import { GatewayBrowserClient } from "/src/api/gateway.ts";
import "/src/pages/cron/cron-page.ts";
window.CronProofGatewayBrowserClient = GatewayBrowserClient;
</script>`,
    });
  });
  await page.goto(`${controlUi.baseUrl}cron-runtime-proof`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Reflect.get(window, "CronProofGatewayBrowserClient") !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  return await page.evaluate(
    async ({ authValue: token, gatewayUrl: url }) => {
      const GatewayBrowserClient = Reflect.get(window, "CronProofGatewayBrowserClient");
      let helloValue = null;
      let resolveHello;
      let rejectHello;
      const connected = new Promise((resolve, reject) => {
        resolveHello = resolve;
        rejectHello = reject;
      });
      const client = new GatewayBrowserClient({
        url,
        token,
        onHello: (hello) => {
          helloValue = hello;
          resolveHello(hello);
        },
        onClose: (info) => {
          if (!info.willRetry) {
            rejectHello(new Error(`Gateway closed before proof: ${info.code} ${info.reason}`));
          }
        },
      });
      client.start();
      await Promise.race([
        connected,
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("Gateway connection timed out")), 30_000);
        }),
      ]);
      const first = await client.request("cron.add", {
        agentId: "main",
        name: "Proof job one",
        schedule: { kind: "every", everyMs: 86_400_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "Proof job one event" },
      });
      const firstRecord = first && typeof first === "object" ? first : {};
      const nestedJob =
        firstRecord.job && typeof firstRecord.job === "object" ? firstRecord.job : {};
      const firstId = nestedJob.id ?? firstRecord.id;
      if (typeof firstId !== "string" || !firstId) {
        throw new Error("cron.add did not return a job id");
      }

      const gatewayListeners = new Set();
      const snapshot = {
        client,
        phase: "connected",
        offlineStable: false,
        canvasPluginSurfaceUrl: null,
        hello: helloValue,
        assistantAgentId: null,
        sessionKey: "main",
        lastError: null,
        lastErrorCode: null,
      };
      const gateway = {
        snapshot,
        connection: { gatewayUrl: url, token: "", password: "" },
        subscribe(listener) {
          gatewayListeners.add(listener);
          return () => gatewayListeners.delete(listener);
        },
        subscribeEvents(listener) {
          return client.addEventListener(listener);
        },
      };
      const subscribe = () => () => undefined;
      let selectionState = { selectedId: "main", scopeId: "main" };
      const selectionListeners = new Set();
      const context = {
        basePath: "",
        gateway,
        agents: {
          state: {
            agentsList: { defaultId: "main", agents: [{ id: "main" }] },
            agentsLoading: false,
            agentsError: null,
          },
          ensureList: async () => undefined,
          subscribe,
        },
        channels: {
          state: { channelsSnapshot: null },
          refresh: async () => undefined,
          subscribe,
        },
        runtimeConfig: { state: { configSnapshot: null }, subscribe },
        agentSelection: {
          get state() {
            return selectionState;
          },
          set(agentId) {
            selectionState = { selectedId: agentId, scopeId: agentId };
            for (const listener of selectionListeners) {
              listener(selectionState);
            }
          },
          setScope(agentId) {
            selectionState = { ...selectionState, scopeId: agentId };
            for (const listener of selectionListeners) {
              listener(selectionState);
            }
          },
          subscribe(listener) {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          },
        },
        navigate: () => undefined,
        preload: async () => undefined,
      };
      const cronPage = document.createElement("openclaw-cron-page");
      Reflect.set(cronPage, "context", context);
      document.getElementById("mount")?.append(cronPage);
      Object.assign(window, { cronProofClient: client, cronProofPage: cronPage });
      return firstId;
    },
    { authValue, gatewayUrl },
  );
}

async function pageStatusJobs(page: Page): Promise<number | null> {
  return await page.evaluate(() => {
    const cronPage = Reflect.get(window, "cronProofPage");
    const cronState = cronPage ? Reflect.get(cronPage, "cron") : null;
    return typeof cronState?.cronStatus?.jobs === "number" ? cronState.cronStatus.jobs : null;
  });
}

async function pageScopedOverview(page: Page) {
  return await page.evaluate(() => {
    const cronPage = Reflect.get(window, "cronProofPage");
    const cronState = cronPage ? Reflect.get(cronPage, "cron") : null;
    const visibleValues = [...document.querySelectorAll(".cron-stat__value")].map((node) =>
      node.textContent?.trim(),
    );
    return {
      busy: cronState?.cronBusy === true,
      nextWakeAtMs:
        typeof cronState?.cronScopedNextWakeAtMs === "number"
          ? cronState.cronScopedNextWakeAtMs
          : null,
      total: typeof cronState?.cronScopedTotal === "number" ? cronState.cronScopedTotal : null,
      visibleValues,
    };
  });
}

describeRuntimeProof("Cron stale response production-boundary proof", () => {
  beforeAll(async () => {
    if (!chromiumAvailable) {
      throw new Error(`Playwright Chromium is unavailable at ${chromiumExecutablePath}`);
    }
    await fs.mkdir(artifactDir, { recursive: true });
    controlUi = await startControlUiE2eServer(undefined, { source: true });
    const gatewayPort = await getFreeGatewayPort();
    state = await createOpenClawTestState({
      label: "cron-stale-response-runtime-proof",
      layout: "home",
      env: {
        OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: "1",
        OPENCLAW_SKIP_CANVAS_HOST: "1",
        OPENCLAW_SKIP_CHANNELS: "1",
        OPENCLAW_SKIP_CRON: "0",
        OPENCLAW_SKIP_GMAIL_WATCHER: "1",
        OPENCLAW_SKIP_PROVIDERS: "1",
        OPENCLAW_TEST_MINIMAL_GATEWAY: "1",
        VITEST: "1",
      },
    });
    await state.writeConfig({
      cron: { enabled: true },
      gateway: {
        auth: { mode: "token", token: authValue },
        controlUi: {
          allowedOrigins: [new URL(controlUi.baseUrl).origin],
          enabled: false,
        },
        port: gatewayPort,
      },
    });
    state.applyEnv();
    const { startGatewayServer } = await import("../../../src/gateway/server.js");
    gateway = await startGatewayServer(gatewayPort, {
      auth: { mode: "token", token: authValue },
      bind: "loopback",
      controlUiEnabled: false,
      sidecarStartup: "defer",
    });
    proxy = await startCronStatusDelayProxy(`ws://127.0.0.1:${gatewayPort}`);
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
    browserContext = await browser.newContext({
      permissions: ["local-network-access"],
      serviceWorkers: "block",
      viewport: { height: 900, width: 1_280 },
    });
  }, 120_000);

  afterAll(async () => {
    await browserContext?.close();
    await browser?.close();
    await proxy?.close();
    await gateway?.close({ reason: "cron runtime proof complete" });
    await controlUi?.close();
    await state?.cleanup();
  }, 120_000);

  it("keeps a newer real Gateway refresh after an older response is released", async () => {
    const page = await browserContext.newPage();
    const firstJobId = await mountCronPage(page, proxy.url);
    await expect.poll(() => pageStatusJobs(page), { timeout: 30_000 }).toBe(1);
    await page.locator(`[data-test-id="cron-row-${firstJobId}"]`).waitFor({ timeout: 30_000 });
    expect(proxy.evidence.modelListFixtureRequests).toBe(1);

    proxy.armCronStatusHold();
    await page
      .locator(`[data-test-id="cron-row-toggle-${firstJobId}"] wa-switch`)
      .evaluate((node) => {
        const toggle = node as HTMLElement & { checked: boolean };
        toggle.checked = false;
        toggle.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await proxy.waitForHeldResponse();
    expect(proxy.evidence.heldSnapshotJobs).toBe(1);
    expect(proxy.evidence.cronUpdateRequests).toBe(1);

    await page.evaluate(async () => {
      const client = Reflect.get(window, "cronProofClient");
      await client.request("cron.add", {
        agentId: "main",
        name: "Proof job two",
        schedule: { kind: "every", everyMs: 86_400_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "Proof job two event" },
      });
      const cronPage = Reflect.get(window, "cronProofPage");
      await Reflect.get(cronPage, "refreshCron").call(cronPage, { tableFilters: true });
    });
    await expect.poll(() => pageStatusJobs(page), { timeout: 30_000 }).toBe(2);
    await expect
      .poll(() => page.locator(".cron-stat").first().locator(".cron-stat__value").textContent())
      .toBe("2");

    const activityBeforeRelease = await page.evaluate(
      () => Reflect.get(window, "cronProofClient").inboundActivitySeq,
    );
    proxy.releaseHeldResponse();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "cronProofClient").inboundActivitySeq), {
        timeout: 30_000,
      })
      .toBeGreaterThan(activityBeforeRelease);
    await expect.poll(() => pageStatusJobs(page), { timeout: 30_000 }).toBe(2);
    const statusAfterDelayedReleaseJobs = await pageStatusJobs(page);
    expect(proxy.evidence.releasedSha256).toBe(proxy.evidence.capturedSha256);
    expect(proxy.evidence.cronAddRequests).toBe(2);

    await expect
      .poll(() => pageScopedOverview(page), { timeout: 30_000 })
      .toMatchObject({
        busy: false,
        total: 2,
      });
    const scopedBeforeHold = await pageScopedOverview(page);
    expect(scopedBeforeHold.nextWakeAtMs).not.toBeNull();

    proxy.armCronScopeHold();
    await page.evaluate(() => {
      const cronPage = Reflect.get(window, "cronProofPage");
      const pending = Reflect.get(cronPage, "refreshCron").call(cronPage, { tableFilters: true });
      Reflect.set(window, "cronProofOlderScopedRefresh", pending);
    });
    await proxy.waitForHeldScopeResponses();
    const scopedHoldCapturedAtMs = Date.now();
    expect(proxy.evidence.heldScopeTotal).toBe(2);
    expect(proxy.evidence.heldScopeNextWakeAtMs).toBe(scopedBeforeHold.nextWakeAtMs);

    await page.evaluate(async () => {
      const client = Reflect.get(window, "cronProofClient");
      await client.request("cron.add", {
        agentId: "main",
        name: "Proof job three",
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "Proof job three event" },
      });
    });
    await page
      .locator(`[data-test-id="cron-row-toggle-${firstJobId}"] wa-switch`)
      .evaluate((node) => {
        const toggle = node as HTMLElement & { checked: boolean };
        toggle.checked = true;
        toggle.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await expect
      .poll(() => pageScopedOverview(page), { timeout: 30_000 })
      .toMatchObject({
        busy: false,
        total: 3,
      });
    const scopedAfterMutation = await pageScopedOverview(page);
    expect(scopedAfterMutation.nextWakeAtMs).not.toBeNull();
    expect(proxy.evidence.cronUpdateRequests).toBe(2);
    expect(proxy.evidence.scopedRequestsAfterLatestCronUpdate).toBeGreaterThanOrEqual(2);
    await page.screenshot({
      fullPage: true,
      path: path.join(artifactDir, "cron-scoped-mutation-before-stale-release.png"),
    });

    const activityBeforeScopeRelease = await page.evaluate(
      () => Reflect.get(window, "cronProofClient").inboundActivitySeq,
    );
    const scopedHoldReleasedAtMs = Date.now();
    proxy.releaseHeldScopeResponses();
    await page.evaluate(async () => {
      await Reflect.get(window, "cronProofOlderScopedRefresh");
    });
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "cronProofClient").inboundActivitySeq), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(activityBeforeScopeRelease + 2);
    const scopedAfterStaleRelease = await pageScopedOverview(page);
    expect(scopedAfterStaleRelease).toMatchObject({
      busy: false,
      nextWakeAtMs: scopedAfterMutation.nextWakeAtMs,
      total: 3,
    });
    expect(scopedAfterStaleRelease.visibleValues[0]).toBe("3");
    expect(proxy.evidence.heldScopeTotalReleasedSha256).toBe(
      proxy.evidence.heldScopeTotalCapturedSha256,
    );
    expect(proxy.evidence.heldScopeNextWakeReleasedSha256).toBe(
      proxy.evidence.heldScopeNextWakeCapturedSha256,
    );

    await page.screenshot({
      fullPage: true,
      path: path.join(artifactDir, "cron-scoped-mutation-stale-response.png"),
    });
    await fs.writeFile(
      path.join(artifactDir, "proof-cron-stale-response.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          targetHeadSha: proofHeadSha,
          verdict: "pass",
          boundary: {
            browser: "chromium",
            controlUi: "vite-source-mounted-production-cron-page",
            gateway: "production-startGatewayServer-cron-store",
            transport: "production-GatewayBrowserClient-real-websocket",
            orderingFixture:
              "one-unmodified-cron.status-response-and-two-agent-scoped-cron.list-responses-delayed",
            peripheralFixture: "models.list-empty-result",
          },
          assertions: {
            initialJobs: 1,
            delayedSnapshotJobs: proxy.evidence.heldSnapshotJobs,
            newerRefreshJobs: 2,
            afterDelayedReleaseJobs: statusAfterDelayedReleaseJobs,
            responseBytesUnchanged: proxy.evidence.releasedSha256 === proxy.evidence.capturedSha256,
            cronAddRequests: proxy.evidence.cronAddRequests,
            cronListRequests: proxy.evidence.cronListRequests,
            cronUpdateRequests: proxy.evidence.cronUpdateRequests,
            cronStatusRequests: proxy.evidence.cronStatusRequests,
            modelListFixtureRequests: proxy.evidence.modelListFixtureRequests,
            scopedMutation: {
              beforeHold: scopedBeforeHold,
              heldNextWakeAtMs: proxy.evidence.heldScopeNextWakeAtMs,
              heldTotal: proxy.evidence.heldScopeTotal,
              afterMutation: scopedAfterMutation,
              afterStaleRelease: scopedAfterStaleRelease,
              replacementRequestsAfterCronUpdate:
                proxy.evidence.scopedRequestsAfterLatestCronUpdate,
              scopedNextWakeRequests: proxy.evidence.scopedNextWakeRequests,
              scopedTotalRequests: proxy.evidence.scopedTotalRequests,
              timing: {
                capturedAt: new Date(scopedHoldCapturedAtMs).toISOString(),
                heldMs: scopedHoldReleasedAtMs - scopedHoldCapturedAtMs,
                releasedAt: new Date(scopedHoldReleasedAtMs).toISOString(),
              },
              responseBytesUnchanged:
                proxy.evidence.heldScopeTotalReleasedSha256 ===
                  proxy.evidence.heldScopeTotalCapturedSha256 &&
                proxy.evidence.heldScopeNextWakeReleasedSha256 ===
                  proxy.evidence.heldScopeNextWakeCapturedSha256,
            },
          },
          responseSha256: {
            cronStatus: proxy.evidence.capturedSha256,
            scopedNextWake: proxy.evidence.heldScopeNextWakeCapturedSha256,
            scopedTotal: proxy.evidence.heldScopeTotalCapturedSha256,
          },
          secretOutput: false,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.info(
      "[cron stale response proof] vite=true chromium=true real-gateway=true real-websocket=true agent-scoped-mutation=true replacement-scope-queries=true model-list-fixture=true unmodified-cron-responses=true stale-overwrite=false",
    );
    await page.evaluate(() => Reflect.get(window, "cronProofClient")?.stop());
    await page.close();
  }, 120_000);
});
