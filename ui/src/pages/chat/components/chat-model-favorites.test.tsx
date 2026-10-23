/* @vitest-environment jsdom */
import { expect, it, vi } from "vitest";
import { createDeferred } from "../../../../../test/helpers/promise.ts";
import { createApplicationGateway } from "../../../test-helpers/application-context-fixtures.ts";
import { createSolidApplicationContextProvider } from "../../../test-helpers/solid-application-context.tsx";
import { flush, waitForSolid } from "../../../test-helpers/solid-settle.ts";
import { createContext } from "../../skill-workshop/skill-workshop-page.test-support.ts";
import {
  modelOption,
  modelPickerProps,
  mountModelPicker,
} from "./chat-model-picker.test-support.tsx";

const key = "ui.modelFavorites:research";
const model = JSON.stringify(["openai/small", null]);

async function mount(
  entries: Record<string, unknown> = {},
  scopes = ["operator.write"],
  overrides: Partial<ReturnType<typeof modelPickerProps>> = {},
) {
  const request = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
    if (method === "users.prefs.get") {
      return { status: "ok", entries: { ...entries } };
    }
    if (method === "users.prefs.set") {
      const values = (params as { entries: Record<string, unknown> }).entries;
      for (const [name, value] of Object.entries(values)) {
        if (value === null) {
          delete entries[name];
        } else {
          entries[name] = value;
        }
      }
      return { status: "ok" };
    }
    throw new Error(`Unexpected method: ${method}`);
  });
  const context = createContext(request, {
    methods: ["users.prefs.get", "users.prefs.set"],
    scopes,
  });
  const gateway = createApplicationGateway({
    ...context.gateway.snapshot,
    selfUser: { id: "operator" },
  });
  const provider = createSolidApplicationContextProvider({ ...context, gateway: gateway.gateway });
  const params = modelPickerProps({
    open: true,
    sessionKey: "agent:research:main",
    modelOptions: [modelOption("openai", "large"), modelOption("openai", "small")],
    selectedModelValue: "openai/large",
    ...overrides,
  });
  const view = mountModelPicker(params, { wrapper: provider.wrapper });
  const checkbox = () =>
    view.container.querySelectorAll<HTMLInputElement>("[data-chat-model-favorite]")[1]!;
  await waitForSolid(() => expect(checkbox()).toBeDefined());
  await waitForSolid(() =>
    expect(request).toHaveBeenCalledWith("users.prefs.get", { keys: [key] }),
  );
  return { ...view, checkbox, request, gateway, params, entries };
}

it("saves and removes a favorite without selecting its model, then restores it on reopen", async () => {
  const view = await mount();
  await waitForSolid(() => expect(view.checkbox().disabled).toBe(false));
  view.checkbox().click();
  await waitForSolid(() => expect(view.checkbox().checked).toBe(true));
  await waitForSolid(() => expect(view.entries[key]).toEqual([model]));
  expect(view.params.onModelSelect).not.toHaveBeenCalled();
  await waitForSolid(() =>
    expect(
      view.container.querySelector('[data-chat-model-provider-group="$favorites"]')?.textContent,
    ).toContain("small"),
  );
  expect(view.request).toHaveBeenCalledWith("users.prefs.set", {
    entries: { [key]: [model] },
    expectedEntries: { [key]: null },
  });
  view.unmount();
  const reopened = await mount(view.entries);
  await waitForSolid(() => expect(reopened.checkbox().checked).toBe(true));
  reopened.checkbox().click();
  await waitForSolid(() => expect(reopened.checkbox().checked).toBe(false));
  await waitForSolid(() => expect(Object.hasOwn(view.entries, key)).toBe(false));
  await waitForSolid(() =>
    expect(
      reopened.container.querySelector('[data-chat-model-provider-group="$favorites"]'),
    ).toBeNull(),
  );
});

it("identifies same-model favorites by their execution runtime", async () => {
  const view = await mount({}, undefined, {
    modelOptions: [
      modelOption("anthropic", "sonnet", {
        label: "Claude Sonnet",
        agentRuntimeId: "openclaw",
        agentRuntime: "openclaw",
      }),
      modelOption("anthropic", "sonnet", {
        label: "Claude Sonnet",
        agentRuntimeId: "claude-cli",
        agentRuntime: "claude-cli",
        runtimeOverride: "claude-cli",
      }),
    ],
  });
  const api = () => view.getByRole<HTMLInputElement>("checkbox", { name: /Claude Sonnet.*API/ });
  const cli = () =>
    view.getByRole<HTMLInputElement>("checkbox", { name: /Claude Sonnet.*Claude CLI/ });
  await waitForSolid(() => expect(cli().disabled).toBe(false));
  cli().click();
  await waitForSolid(() => expect(cli().checked).toBe(true));
  expect(api().checked).toBe(false);
  expect(view.entries[key]).toEqual([JSON.stringify(["anthropic/sonnet", "claude-cli"])]);
  expect(view.params.onModelSelect).not.toHaveBeenCalled();
});

it("keeps provider authentication and settings after favoriting its only model", async () => {
  const onProviderSettings = vi.fn();
  const view = await mount({}, undefined, {
    modelOptions: [
      modelOption("openai", "inherited", { isDefault: true }),
      modelOption("openai", "large"),
      modelOption("anthropic", "sonnet"),
    ],
    providerAuth: new Map([["anthropic", { kind: "api", label: "API key", detail: "Configured" }]]),
    onProviderSettings,
  });
  await waitForSolid(() => expect(view.checkbox().disabled).toBe(false));
  view.checkbox().click();
  await waitForSolid(() => expect(view.checkbox()?.checked, view.container.textContent).toBe(true));
  const heading = view.container.querySelector('[data-chat-model-provider="anthropic"]');
  expect(heading?.textContent).toContain("API key");
  const settings = heading?.querySelector<HTMLButtonElement>("[data-chat-model-provider-settings]");
  expect(settings).not.toBeNull();
  settings!.click();
  expect(onProviderSettings).toHaveBeenCalledWith("anthropic");
  expect(view.checkbox().checked).toBe(true);
  expect(view.params.onModelSelect).not.toHaveBeenCalled();
});

it("shows a conflicting write and reconciles the authoritative favorites", async () => {
  const view = await mount();
  await waitForSolid(() => expect(view.checkbox().disabled).toBe(false));
  view.request.mockImplementation(async (method) => {
    if (method === "users.prefs.get") {
      return { status: "ok", entries: { [key]: [JSON.stringify(["openai/large", null])] } };
    }
    return { status: "conflict" };
  });
  view.checkbox().click();
  await waitForSolid(() =>
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Favorites changed",
    ),
  );
  await waitForSolid(() => expect(view.checkbox().checked).toBe(false));
  expect(
    view.container.querySelector('[data-chat-model-provider-group="$favorites"]')?.textContent,
  ).toContain("large");
  expect(view.params.onModelSelect).not.toHaveBeenCalled();
});

it.each(["viewer", "connection", "agent"])(
  "retires pending favorites on %s changes",
  async (change) => {
    const view = await mount({ [key]: [model] });
    await waitForSolid(() => expect(view.checkbox().checked).toBe(true));
    await waitForSolid(() => expect(view.checkbox().disabled).toBe(false));
    const write = createDeferred<unknown>();
    view.request.mockImplementation(async (method) =>
      method === "users.prefs.set" ? write.promise : { status: "ok", entries: {} },
    );
    view.checkbox().click();
    await waitForSolid(() => expect(view.checkbox().disabled).toBe(true));
    if (change === "viewer") {
      view.gateway.publish({
        ...view.gateway.gateway.snapshot,
        selfUser: { id: "other-operator" },
      });
    } else if (change === "connection") {
      Object.assign(view.gateway.gateway.snapshot.client!, { connectionGeneration: 1 });
      view.gateway.publish({ ...view.gateway.gateway.snapshot });
    } else {
      view.update({ ...view.params, sessionKey: "agent:other:main" });
    }
    flush();
    await waitForSolid(() => expect(view.checkbox().checked).toBe(false));
    await waitForSolid(() => expect(view.checkbox().disabled).toBe(false));
    write.resolve({ status: "conflict" });
    await waitForSolid(() => expect(view.checkbox().disabled).toBe(false));
    expect(view.checkbox().checked).toBe(false);
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(
      view.container.querySelector('[data-chat-model-provider-group="$favorites"]'),
    ).toBeNull();
  },
);

it("restores the checkbox after a rejected write and retries a failed preference read", async () => {
  const view = await mount();
  await waitForSolid(() => expect(view.checkbox().disabled).toBe(false));
  view.request.mockImplementation(async (method) => {
    if (method === "users.prefs.set") {
      throw new Error("Favorite save rejected");
    }
    return { status: "ok", entries: {} };
  });
  view.checkbox().click();
  await waitForSolid(() =>
    expect(view.getByRole("alert").textContent).toContain("Favorite save rejected"),
  );
  expect(view.checkbox().checked).toBe(false);
  expect(view.checkbox().disabled).toBe(false);
  view.request.mockRejectedValue(new Error("Favorite read rejected"));
  view.gateway.publishEvent({
    type: "event",
    event: "users.prefs.changed",
    payload: { profileId: "operator", keys: [key] },
  });
  await waitForSolid(() => expect(view.checkbox().disabled).toBe(true));
  await waitForSolid(() => expect(view.container.textContent).toContain("Favorite read rejected"));
  view.request.mockResolvedValue({ status: "ok", entries: {} });
  view.getByRole("button", { name: "Retry" }).click();
  await waitForSolid(() => expect(view.checkbox().disabled).toBe(false));
});

it("does not write favorites without operator write access", async () => {
  const view = await mount({}, ["operator.read"]);
  expect(view.checkbox().disabled).toBe(true);
  view.checkbox().click();
  flush();
  expect(view.request.mock.calls.some(([method]) => method === "users.prefs.set")).toBe(false);
});

it("refreshes an alias viewer when its canonical profile preferences change", async () => {
  const view = await mount();
  await waitForSolid(() => expect(view.checkbox().disabled).toBe(false));
  view.entries[key] = [model];
  view.gateway.publishEvent({
    type: "event",
    event: "users.prefs.changed",
    payload: { profileId: "canonical-operator", keys: [key] },
  });
  await waitForSolid(() => expect(view.checkbox().checked).toBe(true));
  expect(view.params.onModelSelect).not.toHaveBeenCalled();
});

it("switches agent favorites without changing catalog availability or runtime identity", async () => {
  const alternate = JSON.stringify(["openai/small", "claude-cli"]);
  const view = await mount({ [key]: [model], "ui.modelFavorites:other": [alternate] });
  const params = {
    ...view.params,
    modelOptions: [
      ...view.params.modelOptions,
      modelOption("openai", "small", { agentRuntime: "claude-cli", disabled: true }),
    ],
  };
  view.update(params);
  await waitForSolid(() => expect(view.checkbox().checked).toBe(true));
  view.update({ ...params, sessionKey: "agent:other:main" });
  await waitForSolid(() => {
    const inputs = view.container.querySelectorAll<HTMLInputElement>("[data-chat-model-favorite]");
    expect([inputs[1]?.checked, inputs[2]?.checked]).toEqual([false, true]);
  });
  const favorite = view.container.querySelector<HTMLButtonElement>(
    '[data-chat-model-provider-group="$favorites"] [data-chat-model-option]',
  );
  expect(favorite?.disabled).toBe(true);
  favorite?.click();
  expect(view.params.onModelSelect).not.toHaveBeenCalled();
  expect(view.request.mock.calls.some(([method]) => method === "users.prefs.set")).toBe(false);
});
