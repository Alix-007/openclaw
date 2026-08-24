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
              agents: [
                { id: "writer", name: "Writer" },
                { id: "editor", name: "Editor" },
              ],
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
                  {
                    accountId: "work",
                    name: "Work Bot",
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
                  conversationRef: "conversation:telegram:gmail-cleaner:group:default-room",
                  channel: "telegram",
                  accountId: "gmail-cleaner",
                  kind: "group",
                  target: "-1000",
                  label: "Default room",
                  firstSeenAt: 0,
                  lastSeenAt: 0,
                },
                {
                  conversationRef: "conversation:telegram:work:group:-1001:topic:11",
                  channel: "telegram",
                  accountId: "work",
                  kind: "group",
                  target: "-1001",
                  threadId: "11",
                  label: "General",
                  firstSeenAt: 0,
                  lastSeenAt: 0,
                },
                {
                  conversationRef: "conversation:telegram:work:group:-1001:topic:22",
                  channel: "telegram",
                  accountId: "work",
                  kind: "group",
                  target: "-1001",
                  threadId: "22",
                  label: "Builds",
                  firstSeenAt: 0,
                  lastSeenAt: 0,
                },
              ],
            },
            "cron.add": { id: "topic-delivery-job" },
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
        const agentScope = page.locator(".agent-scope-control openclaw-agent-select");
        await agentScope.locator(".agent-select__trigger").click();
        await agentScope
          .locator("wa-dropdown-item[data-agent-option]")
          .filter({ hasText: "Editor" })
          .click();
        await page.locator('[data-test-id="cron-new-task"]').click();
        const formAgent = page.locator("#cron-agent-id");
        await expect
          .poll(() =>
            formAgent.evaluate((element) =>
              String((element as HTMLElement & { value?: string }).value),
            ),
          )
          .toBe("writer");
        const channelPicker = page.locator("#cron-delivery-channel");
        if ((await channelPicker.evaluate((element) => element.localName)) === "select") {
          await channelPicker.selectOption("telegram");
        } else {
          await channelPicker.click();
          await channelPicker.locator('wa-option[value="telegram"]').click();
        }
        await expect
          .poll(() =>
            channelPicker.evaluate((element) =>
              String((element as HTMLElement & { value?: string }).value),
            ),
          )
          .toBe("telegram");

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
        const defaultRecipientOptions = await page
          .locator("#cron-delivery-to-suggestions option")
          .evaluateAll((options) => options.map((option) => option.getAttribute("value")));
        const accountOptions = await page
          .locator("#cron-delivery-account-suggestions option")
          .evaluateAll((options) => options.map((option) => option.getAttribute("value")));
        expect(defaultRecipientOptions).toEqual([
          "Default room (-1000) [account gmail-cleaner]",
          "General (-1001) [thread 11] [account work]",
          "Builds (-1001) [thread 22] [account work]",
        ]);
        expect(defaultRecipientOptions).not.toContain("gmail-cleaner");
        expect(defaultRecipientOptions).not.toContain("Gmail Cleaner");
        expect(accountOptions).toEqual(["gmail-cleaner", "work"]);
        expect(accountOptions).not.toContain("Gmail Cleaner");
        expect(accountOptions).not.toContain("Work Bot");

        await page.locator(".cron-advanced > summary").click();
        const deliveryAccount = page.locator("#cron-delivery-account-id");
        await expect(deliveryAccount).toHaveValue("");
        await recipient.fill("Builds (-1001) [thread 22] [account work]");
        await expect(deliveryAccount).toHaveValue("work");
        await page.locator("#cron-name").fill("Topic delivery");
        await page.locator("#cron-payload-text").fill("Send the topic digest");
        await page.locator('[data-test-id="cron-submit"]').click();
        const addRequest = await gateway.waitForRequest("cron.add");
        expect(addRequest.params).toMatchObject({
          delivery: {
            mode: "announce",
            channel: "telegram",
            to: "-1001",
            threadId: "22",
            accountId: "work",
          },
        });
      },
    );
  });
});
