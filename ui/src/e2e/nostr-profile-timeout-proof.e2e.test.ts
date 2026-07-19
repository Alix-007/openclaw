// Proof-only Control UI coverage for stalled Nostr profile publish/import requests.
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
const expectedOutcome = process.env.NOSTR_PROOF_EXPECT;
const artifactDir = path.resolve(process.cwd(), ".artifacts/control-ui-e2e/nostr-profile-timeout");

if (expectedOutcome !== "stalled" && expectedOutcome !== "recovered") {
  throw new Error("NOSTR_PROOF_EXPECT must be stalled or recovered");
}

let browser: Browser;
let server: ControlUiE2eServer;

const channelsStatus = {
  ts: 1,
  channelOrder: ["nostr"],
  channelLabels: { nostr: "Nostr" },
  channels: {
    nostr: {
      configured: true,
      running: true,
      publicKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      profile: { name: "before-proof" },
    },
  },
  channelAccounts: {
    nostr: [
      {
        accountId: "default",
        configured: true,
        running: true,
        profile: { name: "before-proof" },
      },
    ],
  },
  channelDefaultAccountId: { nostr: "default" },
};

async function installStalledNostrFetch(page: Page) {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    const requests: Array<{ method: string; hasSignal: boolean; aborted: boolean }> = [];
    Object.assign(window, { __nostrProofRequests: requests });

    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/api/channels/nostr/")) {
        return await nativeFetch(input, init);
      }

      const method = init?.method?.toUpperCase() ?? "GET";
      const signal = init?.signal ?? undefined;
      const record = { method, hasSignal: Boolean(signal), aborted: false };
      requests.push(record);
      signal?.addEventListener("abort", () => {
        record.aborted = true;
      });

      if (method === "PUT") {
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("Nostr profile request timed out after 30 seconds");
              error.name = "TimeoutError";
              reject(error);
            },
            { once: true },
          );
        });
      }

      if (method === "POST") {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"ok":'));
            signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("Nostr profile request timed out after 30 seconds");
                error.name = "TimeoutError";
                controller.error(error);
              },
              { once: true },
            );
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return await nativeFetch(input, init);
    };
  });
}

async function openNostrProfile(page: Page) {
  await installMockGateway(page, {
    methodResponses: {
      "channels.status": channelsStatus,
      "config.get": { config: {}, hash: "nostr-proof", issues: [], raw: "{}", valid: true },
      "config.schema": {
        generatedAt: "2026-07-19T00:00:00.000Z",
        schema: { type: "object", properties: {} },
        uiHints: {},
        version: "proof",
      },
    },
  });
  await installStalledNostrFetch(page);
  const response = await page.goto(`${server.baseUrl}settings/channels`);
  expect(response?.status()).toBe(200);
  await page.locator("button.channels-item").filter({ hasText: "Nostr" }).click();
  await page.getByRole("button", { name: "Edit Profile" }).click();
  await page.locator("#nostr-profile-name").waitFor();
}

async function captureOperation(operation: "publish" | "import") {
  const context = await browser.newContext({
    colorScheme: "dark",
    locale: "en-US",
    serviceWorkers: "block",
    viewport: { height: 1000, width: 1440 },
  });
  const page = await context.newPage();
  try {
    await openNostrProfile(page);
    await page.clock.install({ time: new Date("2026-07-19T00:00:00.000Z") });

    const button =
      operation === "publish"
        ? page.getByRole("button", { name: /^(Save & Publish|Saving…)$/ })
        : page.getByRole("button", { name: /^(Import from Relays|Importing…)$/ });
    if (operation === "publish") {
      await page.locator("#nostr-profile-name").fill("after-proof");
    }
    await button.click();

    const busyLabel = operation === "publish" ? "Saving…" : "Importing…";
    await expect.poll(() => button.textContent()).toContain(busyLabel);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __nostrProofRequests?: unknown[] }).__nostrProofRequests
              ?.length,
        ),
      )
      .toBe(1);

    await page.clock.runFor(30_000);
    await page.evaluate(() => Promise.resolve());

    if (expectedOutcome === "stalled") {
      await expect.poll(() => button.textContent()).toContain(busyLabel);
      await expect
        .poll(() => page.getByText("Nostr profile request timed out after 30 seconds").count())
        .toBe(0);
    } else {
      const readyLabel = operation === "publish" ? "Save & Publish" : "Import from Relays";
      await expect.poll(() => button.textContent()).toContain(readyLabel);
      await expect
        .poll(() => page.getByText("Nostr profile request timed out after 30 seconds").count())
        .toBe(1);
    }

    const requestState = await page.evaluate(
      () =>
        (
          window as unknown as {
            __nostrProofRequests?: Array<{
              method: string;
              hasSignal: boolean;
              aborted: boolean;
            }>;
          }
        ).__nostrProofRequests,
    );
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(artifactDir, `${expectedOutcome}-${operation}.png`),
    });
    await writeFile(
      path.join(artifactDir, `${expectedOutcome}-${operation}.json`),
      `${JSON.stringify({ expectedOutcome, operation, elapsedMs: 30_000, requestState }, null, 2)}\n`,
    );
  } finally {
    await context.close();
  }
}

describe("Nostr profile request timeout browser proof", () => {
  beforeAll(async () => {
    if (!canRunPlaywrightChromium(chromiumExecutablePath)) {
      throw new Error(`Playwright Chromium is unavailable at ${chromiumExecutablePath}`);
    }
    server = await startControlUiE2eServer();
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("captures stalled publish and body-read import behavior after 30 seconds", async () => {
    await captureOperation("publish");
    await captureOperation("import");
  });
});
