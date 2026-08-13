import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../../test/helpers/promise.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import {
  createContext,
  createGateway,
  createPage,
  createRequest,
  cronListResponse,
  setChannelFixtures,
  waitForCronPage,
} from "./cron-page.test-helpers.ts";
import "./cron-page.ts";

function addWorkAccount(context: ReturnType<typeof createContext>) {
  context.channels.state.channelsSnapshot?.channelAccounts.telegram?.push({
    accountId: "work",
    name: "Work Bot",
    configured: true,
    enabled: true,
    running: true,
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("CronPage conversation target suggestions", () => {
  it("scopes list, stats, and run history requests to the selected agent", async () => {
    const request = createRequest();
    const gateway = createGateway({ request } as unknown as GatewayBrowserClient, true);
    createPage(createContext(gateway, "writer"));

    await waitForCronPage(() => {
      expect(request).toHaveBeenCalledWith(
        "cron.list",
        expect.objectContaining({ agentId: "writer" }),
      );
      expect(request).toHaveBeenCalledWith(
        "cron.runs",
        expect.objectContaining({ agentId: "writer" }),
      );
    });
  });

  it("suggests canonical conversation targets for the form agent, not chat selection", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "conversations.list") {
        const { agentId } = params as { agentId: string };
        return {
          conversations: [
            {
              conversationRef: `conversation:telegram:gmail-cleaner:group:${agentId}-target`,
              channel: "telegram",
              accountId: "gmail-cleaner",
              kind: "group",
              target: `${agentId}-target`,
              label: `${agentId} room`,
              firstSeenAt: 0,
              lastSeenAt: 0,
            },
          ],
        };
      }
      if (method === "cron.list") {
        return cronListResponse([]);
      }
      if (method === "cron.runs") {
        return { entries: [], total: 0, offset: 0, hasMore: false };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      return {};
    });
    const gateway = createGateway({ request } as unknown as GatewayBrowserClient, true);
    const context = createContext(gateway, "writer");
    context.agentSelection.setScope("editor");
    expect(context.agentSelection.state).toEqual({ selectedId: "writer", scopeId: "editor" });
    setChannelFixtures(context);
    addWorkAccount(context);
    const page = createPage(context, { render: true });

    await waitForCronPage(() =>
      expect(page.querySelector('[data-test-id="cron-new-task"]')).not.toBeNull(),
    );
    expect(request.mock.calls.some(([method]) => method === "conversations.list")).toBe(false);
    (page.querySelector('[data-test-id="cron-new-task"]') as HTMLButtonElement).click();
    await waitForCronPage(() =>
      expect(page.querySelector("#cron-delivery-channel")).not.toBeNull(),
    );

    const agent = page.querySelector("#cron-agent-id") as HTMLInputElement;
    agent.value = "publisher";
    agent.dispatchEvent(new Event("input", { bubbles: true }));
    const channel = page.querySelector("#cron-delivery-channel") as HTMLSelectElement;
    channel.value = "telegram";
    channel.dispatchEvent(new Event("change", { bubbles: true }));
    const recipient = page.querySelector("#cron-delivery-to") as HTMLInputElement;
    recipient.value = "plugin-owned:free-form-target";
    recipient.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForCronPage(() => expect(recipient.value).toBe("plugin-owned:free-form-target"));

    await waitForCronPage(() =>
      expect(request).toHaveBeenCalledWith(
        "conversations.list",
        expect.objectContaining({ agentId: "publisher", channel: "telegram" }),
      ),
    );
    const recipientOptions = Array.from(
      page.querySelectorAll<HTMLOptionElement>("#cron-delivery-to-suggestions option"),
      (option) => option.value,
    );
    const accountOptions = Array.from(
      page.querySelectorAll<HTMLOptionElement>("#cron-delivery-account-suggestions option"),
      (option) => option.value,
    );
    expect(recipientOptions).toContain("publisher room (publisher-target)");
    expect(recipientOptions.join(" ")).not.toContain("editor-target");
    expect(recipientOptions.join(" ")).not.toContain("writer-target");
    expect(recipientOptions).not.toContain("gmail-cleaner");
    expect(recipientOptions).not.toContain("Gmail Cleaner");
    expect(accountOptions).toEqual(["gmail-cleaner", "work"]);
    expect(accountOptions).not.toContain("Gmail Cleaner");
    expect(accountOptions).not.toContain("Work Bot");
  });

  it("selects duplicate topics atomically and clears stale delivery threads", async () => {
    let topicJobCreated = false;
    const topicJob = {
      id: "topic-job",
      name: "Topic delivery",
      enabled: true,
      createdAtMs: 0,
      updatedAtMs: 0,
      schedule: { kind: "every" as const, everyMs: 3_600_000 },
      sessionTarget: "isolated" as const,
      wakeMode: "now" as const,
      payload: { kind: "agentTurn" as const, message: "Send the topic digest" },
      delivery: {
        mode: "announce" as const,
        channel: "telegram",
        to: "-1001",
        threadId: "22",
        accountId: "work",
      },
    };
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "conversations.list") {
        const { channel } = params as { channel: string };
        return {
          conversations:
            channel === "telegram"
              ? [
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
                    conversationRef: "conversation:telegram:work:group:shared:thread:11",
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
                    conversationRef: "conversation:telegram:work:group:shared:thread:22",
                    channel: "telegram",
                    accountId: "work",
                    kind: "group",
                    target: "-1001",
                    threadId: "22",
                    label: "Builds",
                    firstSeenAt: 0,
                    lastSeenAt: 0,
                  },
                  {
                    conversationRef: "conversation:telegram:work:group:plain",
                    channel: "telegram",
                    accountId: "work",
                    kind: "group",
                    target: "-1002",
                    label: "Plain room",
                    firstSeenAt: 0,
                    lastSeenAt: 0,
                  },
                ]
              : [],
        };
      }
      if (method === "cron.add") {
        topicJobCreated = true;
        return { id: "topic-job" };
      }
      if (method === "cron.update") {
        return {};
      }
      if (method === "cron.list") {
        return cronListResponse(topicJobCreated ? [topicJob] : []);
      }
      if (method === "cron.runs") {
        return { entries: [], total: 0, offset: 0, hasMore: false };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      return {};
    });
    const gateway = createGateway({ request } as unknown as GatewayBrowserClient, true);
    const context = createContext(gateway, "writer");
    setChannelFixtures(context);
    addWorkAccount(context);
    const page = createPage(context, { render: true });

    await waitForCronPage(() =>
      expect(page.querySelector('[data-test-id="cron-new-task"]')).not.toBeNull(),
    );
    (page.querySelector('[data-test-id="cron-new-task"]') as HTMLButtonElement).click();
    await waitForCronPage(() =>
      expect(page.querySelector("#cron-delivery-channel")).not.toBeNull(),
    );
    const selectChannel = (value: string) => {
      const channel = page.querySelector("#cron-delivery-channel") as HTMLSelectElement;
      channel.value = value;
      channel.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const selectConversation = async (value: string) => {
      await waitForCronPage(() =>
        expect(
          Array.from(
            page.querySelectorAll<HTMLOptionElement>("#cron-delivery-to-suggestions option"),
          ).some((option) => option.value === value),
        ).toBe(true),
      );
      const option = Array.from(
        page.querySelectorAll<HTMLOptionElement>("#cron-delivery-to-suggestions option"),
      ).find((entry) => entry.value === value);
      expect(option).toBeDefined();
      if (!option) {
        return;
      }
      const recipient = page.querySelector("#cron-delivery-to") as HTMLInputElement;
      recipient.value = option.value;
      recipient.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const conversationRequestCount = () =>
      request.mock.calls.filter(([method]) => method === "conversations.list").length;

    selectChannel("telegram");
    await waitForCronPage(() => expect(conversationRequestCount()).toBe(1));
    await waitForCronPage(() =>
      expect(
        Array.from(
          page.querySelectorAll<HTMLOptionElement>("#cron-delivery-to-suggestions option"),
          (option) => option.value,
        ),
      ).toEqual(["Default room (-1000)"]),
    );
    const account = page.querySelector("#cron-delivery-account-id") as HTMLInputElement;
    account.value = "work";
    account.dispatchEvent(new Event("input", { bubbles: true }));
    await selectConversation("Builds (-1001) [thread 22]");
    expect(conversationRequestCount()).toBe(1);
    expect(page.cron.cronForm.deliveryTo).toBe("-1001");
    expect(page.cron.cronForm.deliveryThreadId).toBe("22");
    const topicOptions = Array.from(
      page.querySelectorAll<HTMLOptionElement>("#cron-delivery-to-suggestions option"),
    ).filter((option) => option.value.includes("(-1001)") && option.value.includes("[thread "));
    expect(topicOptions).toHaveLength(2);
    expect(new Set(topicOptions.map((option) => option.value)).size).toBe(2);

    account.value = "gmail-cleaner";
    account.dispatchEvent(new Event("input", { bubbles: true }));
    expect(page.cron.cronForm.deliveryThreadId).toBeUndefined();
    account.value = "work";
    account.dispatchEvent(new Event("input", { bubbles: true }));
    await selectConversation("Builds (-1001) [thread 22]");

    const recipient = page.querySelector("#cron-delivery-to") as HTMLInputElement;
    recipient.value = "plugin-owned:free-form-target";
    recipient.dispatchEvent(new Event("input", { bubbles: true }));
    expect(page.cron.cronForm.deliveryThreadId).toBeUndefined();

    await selectConversation("General (-1001) [thread 11]");
    selectChannel("discord");
    await waitForCronPage(() => expect(conversationRequestCount()).toBe(2));
    expect(page.cron.cronForm.deliveryThreadId).toBeUndefined();

    selectChannel("telegram");
    await waitForCronPage(() => expect(conversationRequestCount()).toBe(3));
    await selectConversation("General (-1001) [thread 11]");
    const agent = page.querySelector("#cron-agent-id") as HTMLInputElement;
    agent.value = "publisher";
    agent.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForCronPage(() =>
      expect(request).toHaveBeenCalledWith(
        "conversations.list",
        expect.objectContaining({ agentId: "publisher", channel: "telegram" }),
      ),
    );
    expect(page.cron.cronForm.deliveryThreadId).toBeUndefined();

    await selectConversation("General (-1001) [thread 11]");
    await selectConversation("Plain room (-1002)");
    expect(page.cron.cronForm.deliveryTo).toBe("-1002");
    expect(page.cron.cronForm.deliveryThreadId).toBeUndefined();

    await selectConversation("Builds (-1001) [thread 22]");
    const name = page.querySelector("#cron-name") as HTMLInputElement;
    name.value = "Topic delivery";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const payload = page.querySelector("#cron-payload-text") as HTMLTextAreaElement;
    payload.value = "Send the topic digest";
    payload.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForCronPage(() => {
      const submit = page.querySelector('[data-test-id="cron-submit"]') as HTMLButtonElement | null;
      expect(submit).not.toBeNull();
      expect(submit?.disabled).toBe(false);
    });
    expect(page.cron.cronForm.deliveryThreadId).toBe("22");
    (page.querySelector('[data-test-id="cron-submit"]') as HTMLButtonElement).click();

    await waitForCronPage(() =>
      expect(request).toHaveBeenCalledWith(
        "cron.add",
        expect.objectContaining({
          delivery: expect.objectContaining({
            accountId: "work",
            channel: "telegram",
            to: "-1001",
            threadId: "22",
          }),
        }),
      ),
    );

    await waitForCronPage(() => expect(page.querySelector(".cron-table__row")).not.toBeNull());
    (page.querySelector(".cron-table__row") as HTMLElement).click();
    await waitForCronPage(() => expect(page.cron.cronEditingJobId).toBe("topic-job"));
    expect(page.cron.cronForm.deliveryThreadId).toBe("22");
    const deliveryMode = page.querySelector("#cron-delivery-mode") as HTMLSelectElement;
    deliveryMode.value = "webhook";
    deliveryMode.dispatchEvent(new Event("change", { bubbles: true }));
    await waitForCronPage(() => {
      expect(page.cron.cronForm.deliveryMode).toBe("webhook");
      expect(page.cron.cronForm.deliveryThreadId).toBeUndefined();
      expect((page.querySelector("#cron-delivery-mode") as HTMLSelectElement).value).toBe(
        "webhook",
      );
    });
    const restoredDeliveryMode = page.querySelector("#cron-delivery-mode") as HTMLSelectElement;
    restoredDeliveryMode.value = "announce";
    restoredDeliveryMode.dispatchEvent(new Event("change", { bubbles: true }));
    await waitForCronPage(() => {
      expect(page.cron.cronForm.deliveryMode).toBe("announce");
      expect(page.cron.cronForm.deliveryThreadId).toBeUndefined();
      expect(
        (page.querySelector('[data-test-id="cron-submit"]') as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    (page.querySelector('[data-test-id="cron-submit"]') as HTMLButtonElement).click();

    await waitForCronPage(() =>
      expect(request).toHaveBeenCalledWith(
        "cron.update",
        expect.objectContaining({
          id: "topic-job",
          patch: expect.objectContaining({
            delivery: expect.objectContaining({ threadId: null }),
          }),
        }),
      ),
    );
  });

  it("keeps failure-alert targets isolated across channel changes and stale responses", async () => {
    const staleDiscord = createDeferred<{
      conversations: Array<{
        conversationRef: string;
        channel: string;
        accountId: string;
        kind: "group";
        target: string;
        firstSeenAt: number;
        lastSeenAt: number;
      }>;
    }>();
    let telegramRequests = 0;
    let discordRequests = 0;
    const conversation = (
      channel: string,
      target: string,
      threadId?: string,
      accountId = "work",
    ) => ({
      conversationRef: `conversation:${channel}:${accountId}:group:${target}`,
      channel,
      accountId,
      kind: "group" as const,
      target,
      threadId,
      firstSeenAt: 0,
      lastSeenAt: 0,
    });
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "conversations.list") {
        const { channel } = params as { channel: string };
        if (channel === "telegram") {
          telegramRequests += 1;
          return {
            conversations: [conversation("telegram", "normal-target", undefined, "gmail-cleaner")],
          };
        }
        discordRequests += 1;
        return discordRequests === 1
          ? staleDiscord.promise
          : {
              conversations: [
                conversation("discord", "default-alert", undefined, "default"),
                conversation("discord", "current-alert"),
                conversation("discord", "topic-alert", "22"),
              ],
            };
      }
      if (method === "cron.list") {
        return cronListResponse([]);
      }
      if (method === "cron.runs") {
        return { entries: [], total: 0, offset: 0, hasMore: false };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      return {};
    });
    const gateway = createGateway({ request } as unknown as GatewayBrowserClient, true);
    const context = createContext(gateway, "writer");
    setChannelFixtures(context);
    const page = createPage(context, { render: true });

    await waitForCronPage(() =>
      expect(page.querySelector('[data-test-id="cron-new-task"]')).not.toBeNull(),
    );
    (page.querySelector('[data-test-id="cron-new-task"]') as HTMLButtonElement).click();
    await waitForCronPage(() =>
      expect(page.querySelector("#cron-delivery-channel")).not.toBeNull(),
    );
    const changeSelect = (selector: string, value: string) => {
      const select = page.querySelector(selector) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    changeSelect("#cron-delivery-channel", "telegram");
    await waitForCronPage(() => expect(telegramRequests).toBe(1));
    changeSelect("#cron-failure-alert-mode", "custom");
    await waitForCronPage(() =>
      expect(page.querySelector("#cron-failure-alert-channel")).not.toBeNull(),
    );
    changeSelect("#cron-failure-alert-channel", "discord");
    await waitForCronPage(() => expect(discordRequests).toBe(1));

    const failureTargets = () =>
      Array.from(
        page.querySelectorAll<HTMLOptionElement>("#cron-failure-alert-to-suggestions option"),
        (option) => option.value,
      );
    const deliveryTargets = () =>
      Array.from(
        page.querySelectorAll<HTMLOptionElement>("#cron-delivery-to-suggestions option"),
        (option) => option.value,
      );
    await waitForCronPage(() => expect(deliveryTargets()).toEqual(["normal-target"]));
    expect(
      (page.querySelector("#cron-failure-alert-to") as HTMLInputElement).getAttribute("list"),
    ).toBe("cron-failure-alert-to-suggestions");

    changeSelect("#cron-failure-alert-channel", "last");
    await waitForCronPage(() => expect(failureTargets()).toEqual([]));
    changeSelect("#cron-failure-alert-channel", "discord");
    await waitForCronPage(() => expect(discordRequests).toBe(2));
    await waitForCronPage(() => expect(failureTargets()).toEqual(["default-alert"]));
    const failureAccount = page.querySelector("#cron-failure-alert-account-id") as HTMLInputElement;
    failureAccount.value = "work";
    failureAccount.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForCronPage(() => expect(failureTargets()).toEqual(["current-alert"]));
    staleDiscord.resolve({ conversations: [conversation("discord", "stale-alert")] });
    await staleDiscord.promise;
    expect(failureTargets()).toEqual(["current-alert"]);
    expect(failureTargets()).not.toContain("normal-target");
    expect(failureTargets()).not.toContain("gmail-cleaner");
  });

  it("rejects conversation targets from stale channel and agent scopes", async () => {
    const staleTelegram = createDeferred<{
      conversations: Array<{
        conversationRef: string;
        channel: string;
        accountId: string;
        kind: "group";
        target: string;
        firstSeenAt: number;
        lastSeenAt: number;
      }>;
    }>();
    const currentTelegram = createDeferred<Awaited<typeof staleTelegram.promise>>();
    const staleWriterDiscord = createDeferred<Awaited<typeof staleTelegram.promise>>();
    let telegramRequests = 0;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "conversations.list") {
        const { agentId, channel } = params as { agentId: string; channel: string };
        if (agentId === "writer" && channel === "telegram") {
          telegramRequests += 1;
          return telegramRequests === 1 ? staleTelegram.promise : currentTelegram.promise;
        }
        if (agentId === "writer" && channel === "discord") {
          return staleWriterDiscord.promise;
        }
        return {
          conversations: [
            {
              conversationRef: "conversation:discord:default:group:fresh-editor",
              channel: "discord",
              accountId: "default",
              kind: "group" as const,
              target: "fresh-editor",
              firstSeenAt: 0,
              lastSeenAt: 0,
            },
          ],
        };
      }
      if (method === "cron.list") {
        return cronListResponse([]);
      }
      if (method === "cron.runs") {
        return { entries: [], total: 0, offset: 0, hasMore: false };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      return {};
    });
    const gateway = createGateway({ request } as unknown as GatewayBrowserClient, true);
    const context = createContext(gateway, "writer");
    setChannelFixtures(context);
    const page = createPage(context, { render: true });

    await waitForCronPage(() =>
      expect(page.querySelector('[data-test-id="cron-new-task"]')).not.toBeNull(),
    );
    (page.querySelector('[data-test-id="cron-new-task"]') as HTMLButtonElement).click();
    await waitForCronPage(() =>
      expect(page.querySelector("#cron-delivery-channel")).not.toBeNull(),
    );
    const selectChannel = (channel: string) => {
      const select = page.querySelector("#cron-delivery-channel") as HTMLSelectElement;
      select.value = channel;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    selectChannel("telegram");
    await waitForCronPage(() =>
      expect(request).toHaveBeenCalledWith(
        "conversations.list",
        expect.objectContaining({ agentId: "writer", channel: "telegram" }),
      ),
    );
    selectChannel("discord");
    await waitForCronPage(() =>
      expect(request).toHaveBeenCalledWith(
        "conversations.list",
        expect.objectContaining({ agentId: "writer", channel: "discord" }),
      ),
    );
    selectChannel("telegram");
    await waitForCronPage(() => expect(telegramRequests).toBe(2));

    currentTelegram.resolve({
      conversations: [
        {
          conversationRef: "conversation:telegram:work:group:current-channel",
          channel: "telegram",
          accountId: "work",
          kind: "group",
          target: "current-channel",
          firstSeenAt: 0,
          lastSeenAt: 0,
        },
      ],
    });
    await waitForCronPage(() =>
      expect(page.conversationDirectories.delivery.map((entry) => entry.target)).toEqual([
        "current-channel",
      ]),
    );

    staleTelegram.resolve({
      conversations: [
        {
          conversationRef: "conversation:telegram:work:group:stale-channel",
          channel: "telegram",
          accountId: "work",
          kind: "group",
          target: "stale-channel",
          firstSeenAt: 0,
          lastSeenAt: 0,
        },
      ],
    });
    await staleTelegram.promise;
    expect(page.conversationDirectories.delivery.map((entry) => entry.target)).toEqual([
      "current-channel",
    ]);

    context.agentSelection.setScope("editor");
    await waitForCronPage(() => expect(page.cron.cronAgentId).toBe("editor"));
    expect(page.cron.cronCreateOpen).toBe(false);
    expect(page.conversationDirectories.delivery).toEqual([]);
    staleWriterDiscord.resolve({
      conversations: [
        {
          conversationRef: "conversation:discord:default:group:stale-agent",
          channel: "discord",
          accountId: "default",
          kind: "group",
          target: "stale-agent",
          firstSeenAt: 0,
          lastSeenAt: 0,
        },
      ],
    });
    await Promise.resolve();
    expect(page.conversationDirectories.delivery).toEqual([]);
  });
});
