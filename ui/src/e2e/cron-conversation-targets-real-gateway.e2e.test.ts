// Cron target proof crosses the mounted Control UI, real Gateway RPC, and scheduler persistence.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildConversationIdentity } from "../../../src/config/sessions/conversation-identity.js";
import { registerConversationAddresses } from "../../../src/config/sessions/conversation-registry.js";
import { getFreePort } from "../../../src/test-utils/ports.ts";
import { createOpenClawTestInstance } from "../../../test/helpers/openclaw-test-instance.ts";
import { waitForControlUiGatewayReady } from "../test-helpers/control-ui-e2e-readiness.ts";
import {
  canRunPlaywrightChromium,
  controlUiE2eWaitTimeoutMs,
  resolvePlaywrightChromiumExecutablePath,
} from "../test-helpers/control-ui-e2e.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const allowMissingChromium = process.env.OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM === "1";
const describeRealGateway = chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

const captureUiProof = process.env.OPENCLAW_CAPTURE_UI_PROOF === "1";
const proofDir = path.resolve(
  process.env.OPENCLAW_UI_E2E_ARTIFACT_DIR?.trim() || ".artifacts/control-ui-e2e",
  "cron-conversation-targets",
);
const viewport = { height: 900, width: 1_280 };
let browser: Browser;

type CronJobReadback = {
  id: string;
  delivery?: {
    mode?: string;
    channel?: string;
    to?: string;
    threadId?: string | number;
    accountId?: string;
  };
};

type CronAddResponse = CronJobReadback | { job: CronJobReadback };

async function requestFromMountedUi<T>(page: Page, method: string, params?: unknown): Promise<T> {
  return (await page.evaluate(
    async ({ requestMethod, requestParams }) => {
      const app = document.querySelector("openclaw-app") as
        | (HTMLElement & {
            runtime?: {
              context?: {
                gateway?: {
                  snapshot?: {
                    client?: {
                      request: (method: string, params?: unknown) => Promise<unknown>;
                    } | null;
                  };
                };
              };
            };
          })
        | null;
      const client = app?.runtime?.context?.gateway?.snapshot?.client;
      if (!client) {
        throw new Error("mounted Control UI has no connected Gateway client");
      }
      return await client.request(requestMethod, requestParams);
    },
    { requestMethod: method, requestParams: params },
  )) as T;
}

function requireConversationIdentity(input: Parameters<typeof buildConversationIdentity>[0]) {
  const identity = buildConversationIdentity(input);
  if (!identity) {
    throw new Error(`invalid conversation identity fixture: ${input.label ?? input.peerId ?? ""}`);
  }
  return identity;
}

async function capture(page: Page, name: string): Promise<void> {
  if (!captureUiProof) {
    return;
  }
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(proofDir, name),
  });
}

describeRealGateway("Control UI Cron conversation targets real Gateway E2E", () => {
  beforeAll(async () => {
    if (!chromiumAvailable) {
      throw new Error(`Playwright Chromium is not available at ${chromiumExecutablePath}`);
    }
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it(
    "filters topic choices by account and persists the selected route",
    { timeout: 420_000 },
    async () => {
      const port = await getFreePort();
      const httpUrl = `http://127.0.0.1:${port}/`;
      const origin = new URL(httpUrl).origin;
      const instance = await createOpenClawTestInstance({
        name: "control-ui-cron-conversation-targets",
        port,
        startTimeoutMs: 180_000,
        env: {
          OPENCLAW_SKIP_CRON: "0",
        },
      });
      let context: BrowserContext | null = null;

      await mkdir(proofDir, { recursive: true });
      try {
        await instance.state.writeConfig({
          cron: { enabled: true },
          gateway: {
            auth: { mode: "none" },
            bind: "loopback",
            controlUi: {
              allowedOrigins: [origin],
              enabled: true,
              root: path.resolve("dist/control-ui"),
            },
            mode: "local",
            port,
          },
        });
        registerConversationAddresses({ agentId: "main", env: instance.state.env }, [
          requireConversationIdentity({
            channel: "telegram",
            accountId: "default",
            kind: "group",
            peerId: "-1000",
            deliveryTarget: "-1000",
            label: "Default room",
          }),
          requireConversationIdentity({
            channel: "telegram",
            accountId: "work",
            kind: "group",
            peerId: "-1001",
            deliveryTarget: "-1001",
            threadId: "11",
            label: "General",
          }),
          requireConversationIdentity({
            channel: "telegram",
            accountId: "work",
            kind: "group",
            peerId: "-1001",
            deliveryTarget: "-1001",
            threadId: "22",
            label: "Builds",
          }),
        ]);
        await instance.startGateway();
        console.info("[real-cron-conversation-proof] gateway-ready");

        context = await browser.newContext({
          locale: "en-US",
          serviceWorkers: "block",
          viewport,
          ...(captureUiProof ? { recordVideo: { dir: proofDir, size: viewport } } : {}),
        });
        context.setDefaultTimeout(Math.max(controlUiE2eWaitTimeoutMs, 60_000));
        const page = await context.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(String(error)));
        const cronUrl = new URL("cron", httpUrl);
        expect((await page.goto(cronUrl.toString()))?.status()).toBe(200);
        await waitForControlUiGatewayReady(page);
        await page.locator('[data-test-id="cron-new-task"]').waitFor();
        console.info("[real-cron-conversation-proof] mounted-ui-connected");

        const created = await requestFromMountedUi<CronAddResponse>(page, "cron.add", {
          name: "Real Gateway topic delivery",
          schedule: { kind: "every", everyMs: 86_400_000 },
          sessionTarget: "isolated",
          wakeMode: "now",
          payload: { kind: "agentTurn", message: "Send the topic digest" },
          delivery: {
            mode: "announce",
            channel: "telegram",
            to: "-1000",
            accountId: "default",
          },
        });
        const jobId = "job" in created ? created.job.id : created.id;
        expect(jobId).toEqual(expect.any(String));
        console.info("[real-cron-conversation-proof] seed-job-created");

        await page.locator(".cron-refresh").click();
        const jobRow = page.locator(`[data-test-id="cron-row-${jobId}"]`);
        await jobRow.waitFor();
        await jobRow.click();
        await page.locator("#cron-delivery-to").waitFor();
        await page.locator(".cron-advanced > summary").click();
        const deliveryAccount = page.locator("#cron-delivery-account-id");
        await deliveryAccount.fill("");
        console.info("[real-cron-conversation-proof] edit-snapshot-opened");

        const readDeliveryOptions = () =>
          page
            .locator("#cron-delivery-to-suggestions option")
            .evaluateAll((options) =>
              options.map((option) => option.getAttribute("value") ?? "").toSorted(),
            );
        await expect
          .poll(async () =>
            (await readDeliveryOptions()).filter((value) => value.includes("[thread ")),
          )
          .toEqual([
            "Builds (-1001) [thread 22] [account work]",
            "General (-1001) [thread 11] [account work]",
          ]);
        const deliveryOptions = await readDeliveryOptions();
        const multiAccountTopicOptions = deliveryOptions.filter((value) =>
          value.includes("[thread "),
        );
        const legacyFreeFormOptions = deliveryOptions.filter(
          (value) => !value.includes("[account "),
        );
        expect(deliveryOptions).toContain("Default room (-1000) [account default]");
        expect(legacyFreeFormOptions).toEqual(["-1000"]);
        console.info("[real-cron-conversation-proof] multi-account-options-visible");

        const selectedDisplay = "Builds (-1001) [thread 22] [account work]";
        const recipient = page.locator("#cron-delivery-to");
        await recipient.fill(selectedDisplay);
        await expect.poll(() => recipient.inputValue()).toBe("-1001");
        await expect.poll(() => deliveryAccount.inputValue()).toBe("work");
        await capture(page, "01-account-filtered-topic-selected.png");
        await page.locator('[data-test-id="cron-submit"]').click();
        console.info("[real-cron-conversation-proof] ui-save-submitted");

        await expect
          .poll(async () => {
            const readback = await requestFromMountedUi<CronJobReadback>(page, "cron.get", {
              id: jobId,
            });
            return readback.delivery;
          })
          .toMatchObject({
            mode: "announce",
            channel: "telegram",
            to: "-1001",
            threadId: "22",
            accountId: "work",
          });
        const readback = await requestFromMountedUi<CronJobReadback>(page, "cron.get", {
          id: jobId,
        });
        const persisted = {
          mode: readback.delivery?.mode,
          channel: readback.delivery?.channel,
          target: readback.delivery?.to,
          threadId: readback.delivery?.threadId,
          accountId: readback.delivery?.accountId,
        };
        const proof = {
          gateway: "real-ephemeral-websocket",
          readbackMethod: "cron.get",
          uiSource: "mounted-control-ui",
          multiAccountTopicOptions,
          preservedLegacyFreeFormOptions: legacyFreeFormOptions,
          selectedDisplay,
          persisted,
        };
        await writeFile(
          path.join(proofDir, "real-gateway-cron-conversation-targets.json"),
          `${JSON.stringify(proof, null, 2)}\n`,
          "utf8",
        );
        console.info(`[real-cron-conversation-proof] ${JSON.stringify(proof)}`);
        expect(persisted).toEqual({
          mode: "announce",
          channel: "telegram",
          target: "-1001",
          threadId: "22",
          accountId: "work",
        });
        expect(pageErrors).toEqual([]);
      } finally {
        await context?.close().catch(() => {});
        await instance.cleanup();
      }
    },
  );
});
