// Control UI tests cover Cron announce target discovery through the mocked Gateway.
import { expect, it } from "vitest";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Control UI Cron conversation targets mocked Gateway E2E",
  startServerBeforeBrowser: true,
  unavailableMessage: (executablePath) =>
    `Playwright Chromium is not installed or cannot start at ${executablePath}. Run \`pnpm --dir ui exec playwright install --with-deps chromium\`, or set OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM=1 only when intentionally skipping this lane.`,
});

suite.define(() => {
  it("offers channel-owned targets without treating account identity as a recipient", async () => {
    await suite.withPage(
      {
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { height: 900, width: 1_280 },
      },
      async ({ page }) => {
        const gateway = await installMockGateway(page, {
          assistantName: "Writer",
          defaultAgentId: "writer",
          methodResponses: {
            "agents.list": {
              agents: [{ id: "writer", name: "Writer" }],
              defaultId: "writer",
              mainKey: "writer",
              scope: "agent",
            },
            "channels.status": {
              ts: 0,
              channelOrder: ["telegram"],
              channelLabels: { telegram: "Telegram" },
              channelMeta: [{ id: "telegram", label: "Telegram", detailLabel: "Telegram Bot" }],
              channels: {},
              channelAccounts: {
                telegram: [
                  {
                    accountId: "gmail-cleaner",
                    name: "Gmail Cleaner",
                    configured: true,
                    enabled: true,
                    running: true,
                  },
                ],
              },
              channelDefaultAccountId: { telegram: "gmail-cleaner" },
            },
            "conversations.list": {
              conversations: [
                {
                  conversationRef: "conversation:telegram:work:group:-1001234567890",
                  channel: "telegram",
                  accountId: "work",
                  kind: "group",
                  target: "-1001234567890:topic:42",
                  label: "Release room",
                  firstSeenAt: 0,
                  lastSeenAt: 0,
                },
              ],
            },
            "cron.list": {
              jobs: [],
              snapshotRevision: "cron-conversation-targets-fixture",
              total: 0,
              offset: 0,
              limit: 50,
              hasMore: false,
              nextOffset: null,
            },
            "cron.runs": { entries: [], total: 0, offset: 0, hasMore: false },
            "cron.status": { enabled: true, jobs: 0, nextWakeAtMs: null },
          },
        });

        const response = await page.goto(`${suite.server.baseUrl}cron`);
        expect(response?.status()).toBe(200);
        await page.locator('[data-test-id="cron-new-task"]').click();
        await page.locator("#cron-delivery-channel").selectOption("telegram");

        const recipient = page.locator("#cron-delivery-to");
        await recipient.fill("plugin-owned:free-form-target");
        expect(await recipient.inputValue()).toBe("plugin-owned:free-form-target");

        await expect
          .poll(async () => await gateway.getRequests("conversations.list"))
          .toContainEqual(
            expect.objectContaining({
              params: expect.objectContaining({ agentId: "writer", channel: "telegram" }),
            }),
          );
        const recipientOptions = await page
          .locator("#cron-delivery-to-suggestions option")
          .evaluateAll((options) => options.map((option) => option.getAttribute("value")));
        const accountOptions = await page
          .locator("#cron-delivery-account-suggestions option")
          .evaluateAll((options) => options.map((option) => option.getAttribute("value")));
        expect(recipientOptions).toContain("-1001234567890:topic:42");
        expect(recipientOptions).not.toContain("gmail-cleaner");
        expect(recipientOptions).not.toContain("Gmail Cleaner");
        expect(accountOptions).toEqual(["gmail-cleaner", "Gmail Cleaner"]);
      },
    );
  });
});
