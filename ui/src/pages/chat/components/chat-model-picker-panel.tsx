import type { JSX } from "@solidjs/web";
import { createMemo, Errored, For, Loading, Show, useContext } from "solid-js";
import { resolveModelRuntimeRoute } from "../../../../../src/shared/model-runtime-route.js";
import { providerDisplayLabel } from "../../../components/provider-icon.ts";
import { Icon } from "../../../components/solid/icon.tsx";
import { canonicalModelAuthProviderId } from "../../../lib/model-auth.ts";
import { formatModelRuntimeLabel } from "../../../lib/model-runtime-label.ts";
import { t } from "../../../lib/reactive/i18n.ts";
import { ChatContextWindowControl } from "./chat-context-window-control.tsx";
import { ChatModelAccountSectionView } from "./chat-model-account-control.tsx";
import { ChatModelCatalogRefresh, ChatModelCatalogState } from "./chat-model-catalog-state.tsx";
import { createChatModelFavorites, createChatModelFavoritesScope } from "./chat-model-favorites.ts";
import {
  isModelPickerOptionSelected,
  modelPickerOptionKey,
  type ChatModelPickerOption as ModelPickerOption,
  type ChatModelPickerTargetGroup,
} from "./chat-model-picker-options.ts";
import {
  ChatModelPickerOption,
  ChatModelPickerTargetOption,
  ChatModelProviderIcon,
  modelOptionSearchRow,
} from "./chat-model-picker-options.tsx";
import {
  ChatModelSearchContext,
  handleModelSearchKeydown,
  updateModelSearch,
  type ChatModelSearchCatalog,
} from "./chat-model-picker-search.ts";
import type { ChatModelPickerParams } from "./chat-model-picker.tsx";

const FAVORITES_GROUP = "$favorites";

// A model pinned to Claude CLI belongs to its runtime's provider group.
const groupProvider = (option: ModelPickerOption) =>
  resolveModelRuntimeRoute(option.provider, option.agentRuntimeId) === "claudeCli"
    ? "claude-cli"
    : option.provider;

function prepareChatModelPickerPanel(params: ChatModelPickerParams, favorites: readonly string[]) {
  const defaultModelOption = params.modelOptions.find((option) => option.isDefault);
  const activeModelOption = params.modelOptions.find((option) =>
    isModelPickerOptionSelected(option, params.selectedModelValue, params.selectedAgentRuntime),
  );
  const leadingModelOption = activeModelOption ?? defaultModelOption;
  // Default restores inheritance; it stays ahead of ranked model choices. When a
  // provider recommends models, they follow, and the rest collapse under "All models".
  const recommendingProviders = new Set(
    params.modelOptions.filter((option) => option.recommended).map(groupProvider),
  );
  const providerGroups = new Map<
    string,
    { lead: ModelPickerOption[]; more: ModelPickerOption[] }
  >();
  const favoriteOptions: ModelPickerOption[] = [];
  for (const option of params.modelOptions) {
    if (!option.isDefault && favorites.includes(modelPickerOptionKey(option))) {
      favoriteOptions.push(option);
      continue;
    }
    const provider = groupProvider(option);
    const group = providerGroups.get(provider) ?? { lead: [], more: [] };
    if (option.isDefault) {
      group.lead.unshift(option);
    } else if (option === leadingModelOption) {
      group.lead.splice(group.lead[0]?.isDefault ? 1 : 0, 0, option);
    } else if (option.recommended || !recommendingProviders.has(provider)) {
      group.lead.push(option);
    } else {
      group.more.push(option);
    }
    providerGroups.set(provider, group);
  }
  // Unranked catalogs can contain hundreds of models; browse the rest through All models.
  for (const [provider, group] of providerGroups) {
    if (!recommendingProviders.has(provider)) {
      group.more = group.lead.splice(9);
    }
  }
  const orderedProviderGroups = [...providerGroups];
  const leadingProvider = leadingModelOption && groupProvider(leadingModelOption);
  const activeProvider = activeModelOption && groupProvider(activeModelOption);
  const selectedProviderIndex = orderedProviderGroups.findIndex(
    ([provider]) => provider === leadingProvider,
  );
  if (selectedProviderIndex > 0) {
    orderedProviderGroups.unshift(...orderedProviderGroups.splice(selectedProviderIndex, 1));
  }
  if (favoriteOptions.length) {
    orderedProviderGroups.unshift([FAVORITES_GROUP, { lead: favoriteOptions, more: [] }]);
  }
  const orderedOptions = orderedProviderGroups.flatMap(([, { lead, more }]) => [...lead, ...more]);
  const optionIndex = new Map(
    orderedOptions.map((option, index) => [modelPickerOptionKey(option), index]),
  );
  const targetGroups = params.targetGroups ?? [];
  const targetOptionCount = targetGroups.reduce((count, group) => count + group.options.length, 0);
  const hasOptions = params.modelOptions.length > 0 || targetGroups.length > 0;
  const hasSelectableModelOptions = params.modelOptions.some((option) => !option.disabled);
  return {
    orderedProviderGroups,
    activeProvider:
      activeModelOption && favoriteOptions.includes(activeModelOption)
        ? FAVORITES_GROUP
        : activeProvider,
    orderedOptions,
    optionIndex,
    targetGroups,
    targetOptionCount,
    hasOptions,
    hasSelectableModelOptions,
  };
}

function ModelList(props: { label: string; id: string; more?: boolean; children: JSX.Element }) {
  const search = useContext(ChatModelSearchContext);
  return (
    <div
      id={search?.listId(props.id)}
      class="chat-controls__provider-model-list"
      data-chat-model-list="true"
      data-chat-model-more={props.more ? "" : undefined}
      role="listbox"
      aria-label={props.label}
    >
      {props.children}
    </div>
  );
}

type PanelProps = {
  params: ChatModelPickerParams;
  onSelectionClose: (event: MouseEvent) => void;
  searchRef: (element: HTMLInputElement) => void;
};

export function ChatModelPickerPanel(panel: PanelProps) {
  const owner = createChatModelFavoritesScope(() => panel.params.sessionKey);
  const search = useContext(ChatModelSearchContext);
  const favorites = createChatModelFavorites(owner);
  const state = createMemo(() =>
    prepareChatModelPickerPanel(panel.params, favorites.snapshot().keys),
  );
  const accounts = createMemo(() =>
    panel.params.accountSection?.viewProps(
      state().orderedOptions.length + state().targetOptionCount,
    ),
  );
  const catalog = createMemo<ChatModelSearchCatalog>(() => {
    const current = state();
    const unlocked = !panel.params.modelSelectionLocked;
    const providerGroups = unlocked ? current.orderedProviderGroups : [];
    const targetGroups = unlocked ? current.targetGroups : [];
    const account = accounts();
    return {
      activeProvider: current.activeProvider,
      providers: providerGroups.map(([provider]) => provider),
      lists: [
        ...providerGroups.flatMap(([provider, group]) => [
          provider,
          ...(group.more.length ? [`${provider}:more`] : []),
        ]),
        ...targetGroups.map((group) => `target:${group.id}`),
        ...(account ? ["accounts"] : []),
      ],
      rows: [
        ...providerGroups.flatMap(([provider, group]) =>
          group.lead
            .map((entry) =>
              Object.assign(modelOptionSearchRow({ ...panel.params, entry }), { provider }),
            )
            .concat(
              group.more.map((entry) =>
                Object.assign(modelOptionSearchRow({ ...panel.params, entry }), {
                  provider,
                  more: true,
                }),
              ),
            ),
        ),
        ...targetGroups.flatMap((group) =>
          group.options.map((entry) => ({
            key: `target:${group.id}:${entry.value}`,
            name: entry.label.toLocaleLowerCase(),
            providerLabel: group.label.toLocaleLowerCase(),
            reference: entry.value,
            selected: false,
            hasShortcut: true,
            disabled: panel.params.disabled,
          })),
        ),
        ...(account?.options.map((entry) => ({
          key: `account:${entry.value}`,
          name: entry.label.toLocaleLowerCase(),
          keywords: entry.description?.toLocaleLowerCase(),
          providerLabel: "account",
          reference: `account:${entry.value}`,
          selected: entry.value === account.currentValue,
          hasShortcut: false,
          disabled: account.disabled || Boolean(entry.disabled),
          visible: account.open,
        })) ?? []),
      ],
    };
  });
  const searchView = search?.createView(catalog);
  const selectModel = (entry: ModelPickerOption, event: MouseEvent) => {
    event.stopPropagation();
    // Resetting a pin does not require the inherited model to be available.
    const resetsPin = entry.isDefault && panel.params.sessionModelPinned;
    if (
      panel.params.disabled ||
      panel.params.modelSelectionLocked ||
      (entry.disabled && !resetsPin)
    ) {
      event.preventDefault();
      return;
    }
    void panel.params.onModelSelect(
      entry.commitValue,
      panel.params.sessionKey,
      entry.runtimeOverride ??
        (entry.isDefault || entry.agentRuntime !== undefined ? null : undefined),
    );
    panel.onSelectionClose(event);
  };
  const selectTarget = (groupId: string, value: string, event: MouseEvent) => {
    event.stopPropagation();
    if (panel.params.disabled || panel.params.modelSelectionLocked) {
      event.preventDefault();
      return;
    }
    panel.params.onTargetSelect?.(groupId, value);
    panel.onSelectionClose(event);
  };
  // Retain the route boundary across unrelated owner publications.
  const renderDirect = (render: () => JSX.Element) => render();
  const renderCatalogStatus = createMemo(
    () => panel.params.renderModelCatalogStatus ?? renderDirect,
  );
  function TargetOptions(props: { group: ChatModelPickerTargetGroup }) {
    const options = createMemo(() => props.group.completion.promise);
    return (
      <ModelList label={props.group.label} id={`target:${props.group.id}`}>
        <For each={options()} keyed={(entry) => entry.value}>
          {(entry, index) => (
            <ChatModelPickerTargetOption
              disabled={panel.params.disabled}
              entry={entry()}
              groupId={props.group.id}
              groupLabel={props.group.label}
              index={state().orderedOptions.length + index()}
              onSelect={selectTarget}
            />
          )}
        </For>
      </ModelList>
    );
  }
  function TargetState(props: { group: ChatModelPickerTargetGroup; error?: boolean }) {
    return (
      <>
        <ChatModelCatalogState
          state={{ hasSnapshot: false, status: props.error ? "error" : "loading" }}
          hasOptions={false}
          hasSelectableOptions={false}
          errorLabel={props.group.errorLabel}
          retryTarget={
            panel.params.onTargetRetry
              ? {
                  disabled: panel.params.disabled,
                  groupId: props.group.id,
                  onRetry: panel.params.onTargetRetry!,
                }
              : undefined
          }
        />
        <ModelList label={props.group.label} id={`target:${props.group.id}`}>
          {null}
        </ModelList>
      </>
    );
  }
  function ModelOption(props: { entry: ModelPickerOption }) {
    return (
      <ChatModelPickerOption
        disabled={panel.params.disabled}
        entry={props.entry}
        index={state().optionIndex.get(modelPickerOptionKey(props.entry)) ?? 0}
        selectedModelValue={panel.params.selectedModelValue}
        selectedAgentRuntime={panel.params.selectedAgentRuntime}
        sessionModelPinned={panel.params.sessionModelPinned}
        onSelect={selectModel}
        onModelSetup={panel.params.onModelSetup}
      />
    );
  }
  function ProviderHeading(props: {
    provider: string;
    options: ModelPickerOption[];
    toggle?: boolean;
    more?: boolean;
  }) {
    const isFavorites = () => props.provider === FAVORITES_GROUP;
    const providerLabel = () =>
      isFavorites() ? t("chat.modelControls.favorites") : providerDisplayLabel(props.provider);
    const groupLabel = () =>
      isFavorites()
        ? providerLabel()
        : t("chat.modelControls.providerModels", { provider: providerLabel() });
    const auth = () => panel.params.providerAuth?.get(canonicalModelAuthProviderId(props.provider));
    const authKind = () => auth()?.kind;
    const showAuth = createMemo(
      () =>
        Boolean(auth()) &&
        !(
          auth()?.kind === "missing" &&
          props.options.some(
            (option) =>
              option.disabled &&
              (option.unavailableReason === "missing-auth" ||
                option.unavailableReason === "auth-failed"),
          )
        ),
    );
    const authLabel = () =>
      showAuth() ? [auth()?.label, auth()?.detail].filter(Boolean).join(" · ") : undefined;
    const routeDetail = () => {
      const route = resolveModelRuntimeRoute(props.provider);
      return route ? t(`chat.modelControls.routes.${route}.detail`) : undefined;
    };
    return (
      <div
        class="chat-controls__provider-heading"
        data-chat-model-provider={props.provider}
        title={[routeDetail(), authLabel()].filter(Boolean).join(" · ") || undefined}
      >
        <Show
          when={props.toggle}
          fallback={
            <>
              <ChatModelProviderIcon provider={props.provider} />
              <span class="chat-controls__provider-label">{providerLabel()}</span>
            </>
          }
        >
          <button
            class="chat-controls__provider-toggle"
            type="button"
            data-chat-model-group-toggle
            data-chat-model-provider-toggle
            aria-expanded={searchView?.providerOpen(props.provider) ? "true" : "false"}
            aria-controls={[
              search?.listId(props.provider),
              ...(props.more ? [search?.listId(`${props.provider}:more`)] : []),
            ].join(" ")}
            aria-label={`${groupLabel()} (${props.options.length})`}
            aria-description={routeDetail()}
            disabled={panel.params.disabled}
            onClick={(event) => {
              event.stopPropagation();
              searchView?.toggleProvider(props.provider);
            }}
          >
            <Show
              when={isFavorites()}
              fallback={<ChatModelProviderIcon provider={props.provider} />}
            >
              <Icon name="star" class="chat-controls__provider-icon" />
            </Show>
            <span class="chat-controls__provider-label">{providerLabel()}</span>
            <span>{props.options.length}</span>
            <span class="chat-controls__inline-select-chevron" aria-hidden="true">
              <Icon name="chevronDown" />
            </span>
          </button>
        </Show>
        {showAuth() ? (
          <span class="chat-controls__auth-meta" data-auth-kind={authKind()}>
            <span aria-hidden="true">
              <Icon
                name={
                  authKind() === "subscription"
                    ? "circleUser"
                    : authKind() === "api"
                      ? "key"
                      : "alertTriangle"
                }
              />
            </span>
            <span class="chat-controls__auth-meta-label">{authLabel()}</span>
          </span>
        ) : undefined}
        {panel.params.onProviderSettings && !isFavorites() ? (
          <button
            class="chat-controls__provider-settings"
            data-chat-model-provider-settings
            type="button"
            aria-label={t("chat.modelControls.configureModels")}
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              panel.params.onProviderSettings?.(props.provider);
            }}
          >
            <Icon name="settings" />
          </button>
        ) : undefined}
      </div>
    );
  }
  function ProviderGroup(props: {
    provider: string;
    lead: ModelPickerOption[];
    more: ModelPickerOption[];
  }) {
    const groupLabel = () =>
      props.provider === FAVORITES_GROUP
        ? t("chat.modelControls.favorites")
        : t("chat.modelControls.providerModels", {
            provider: providerDisplayLabel(props.provider),
          });
    // When every model moves to Favorites, retain its provider's auth/settings owner.
    const favoriteProviders = createMemo(() =>
      props.provider === FAVORITES_GROUP
        ? [...new Set(props.lead.map(groupProvider))].filter(
            (provider) => !state().orderedProviderGroups.some(([group]) => group === provider),
          )
        : [],
    );
    return (
      <section
        class="chat-controls__provider-model-group"
        data-chat-model-provider-group={props.provider}
        aria-label={groupLabel()}
      >
        <ProviderHeading
          provider={props.provider}
          options={[...props.lead, ...props.more]}
          toggle
          more={props.more.length > 0}
        />
        <For each={favoriteProviders()}>
          {(provider) => (
            <ProviderHeading
              provider={provider}
              options={props.lead.filter((option) => groupProvider(option) === provider)}
            />
          )}
        </For>
        <ModelList label={groupLabel()} id={props.provider}>
          <For each={props.lead} keyed={modelPickerOptionKey}>
            {(entry) => <ModelOption entry={entry()} />}
          </For>
        </ModelList>
        {props.more.length > 0 ? (
          <>
            <button
              class="chat-controls__inline-select-option chat-controls__model-more-toggle"
              type="button"
              data-chat-model-more-toggle
              aria-expanded={searchView?.moreOpen(props.provider) ? "true" : "false"}
              aria-controls={search?.listId(`${props.provider}:more`)}
              hidden={
                searchView?.filtering() ||
                searchView?.moreOpen(props.provider) ||
                !searchView?.providerOpen(props.provider)
              }
              disabled={panel.params.disabled}
              onClick={(event) => searchView?.expandMore(props.provider, event)}
            >
              <span class="chat-controls__model-option-provider" aria-hidden="true" />
              <span>{t("chat.modelControls.allModels", { count: String(props.more.length) })}</span>
              <span class="chat-controls__inline-select-chevron" aria-hidden="true">
                <Icon name="chevronDown" />
              </span>
            </button>
            <ModelList label={groupLabel()} id={`${props.provider}:more`} more>
              <For each={props.more} keyed={modelPickerOptionKey}>
                {(entry) => <ModelOption entry={entry()} />}
              </For>
            </ModelList>
          </>
        ) : undefined}
      </section>
    );
  }
  return (
    <div
      class="chat-controls__inline-select-menu chat-controls__model-menu"
      aria-label={t("chat.selectors.model")}
      data-chat-model-filtering={searchView?.filtering() ? "" : undefined}
    >
      {panel.params.modelSelectionLocked ? (
        <div class="chat-controls__locked-model" aria-label={t("chat.selectors.modelLockedLabel")}>
          <span class="chat-controls__inline-select-section-label">
            {t("chat.selectors.modelSection")}
          </span>
          <span class="chat-controls__locked-model-value">{panel.params.triggerModelLabel}</span>
          <span class="chat-controls__locked-model-badge">{t("chat.selectors.modelLocked")}</span>
        </div>
      ) : (
        <>
          {state().hasOptions || panel.params.accountSection ? (
            <div class="chat-controls__model-search-wrap">
              <Icon name="search" />
              <input
                ref={[search?.inputRef(), panel.searchRef]}
                class="chat-controls__model-search"
                data-chat-model-search="true"
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-controls={searchView?.controls()}
                aria-expanded={search?.open() ? "true" : "false"}
                aria-activedescendant={
                  search?.highlighted() ? search.optionId(search.highlighted()!) : undefined
                }
                value={search?.query() ?? ""}
                autocomplete="off"
                spellcheck="false"
                placeholder={t("chat.modelControls.searchModels")}
                aria-label={t("chat.modelControls.searchModels")}
                disabled={panel.params.disabled}
                onInput={(event: InputEvent) =>
                  // SAFETY: This input handler belongs to the model search input.
                  updateModelSearch(event.currentTarget as HTMLInputElement)
                }
                onKeyDown={handleModelSearchKeydown}
              />
              {panel.params.modelOptions.length > 0 ? (
                <ChatModelCatalogRefresh state={panel.params.modelCatalogState} />
              ) : undefined}
            </div>
          ) : undefined}
          <Show when={favorites.available()}>
            <details class="chat-controls__favorites-editor">
              <summary>{t("chat.modelControls.manageFavorites")}</summary>
              <div role="group" aria-label={t("chat.modelControls.manageFavorites")}>
                <For
                  each={panel.params.modelOptions.filter((option) => !option.isDefault)}
                  keyed={modelPickerOptionKey}
                >
                  {(entry) => (
                    <label class="chat-controls__favorite-choice">
                      <input
                        type="checkbox"
                        data-chat-model-favorite={modelPickerOptionKey(entry())}
                        checked={favorites.keys().includes(modelPickerOptionKey(entry()))}
                        disabled={favorites.disabled()}
                        onClick={(event) => {
                          event.preventDefault();
                          favorites.toggle(modelPickerOptionKey(entry()));
                        }}
                      />
                      <span>
                        {[
                          entry().label,
                          formatModelRuntimeLabel(entry().provider, entry().agentRuntimeId)?.label,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </label>
                  )}
                </For>
              </div>
            </details>
            <Show when={favorites.snapshot().error}>
              <div role="alert">
                {favorites.snapshot().error}
                <button type="button" onClick={() => favorites.retry()}>
                  {t("common.retry")}
                </button>
              </div>
            </Show>
            <Show when={!favorites.saving()}>
              <Errored fallback={(error) => <div role="alert">{String(error())}</div>}>
                {favorites.outcome()}
              </Errored>
            </Show>
          </Show>
          {renderCatalogStatus()(() => (
            <ChatModelCatalogState
              state={panel.params.modelCatalogState}
              hasOptions={panel.params.modelOptions.length > 0}
              hasSelectableOptions={state().hasSelectableModelOptions}
              onModelSetup={panel.params.onModelSetup}
              emptyLabel={
                panel.params.modelOptions.some(
                  (option) =>
                    option.unavailableReason === "missing-auth" &&
                    resolveModelRuntimeRoute(option.provider, option.agentRuntimeId) ===
                      "claudeCli",
                )
                  ? t("chat.modelControls.claudeCliNotReady")
                  : undefined
              }
            />
          ))}
          {state().hasOptions || panel.params.accountSection ? (
            <>
              <div class="chat-controls__model-options">
                <For each={state().orderedProviderGroups} keyed={(group) => group[0]}>
                  {(group) => (
                    <ProviderGroup
                      provider={group()[0]}
                      lead={group()[1].lead}
                      more={group()[1].more}
                    />
                  )}
                </For>
                <For each={state().targetGroups} keyed={(group) => group.id}>
                  {(group) => (
                    <section
                      class="chat-controls__provider-model-group"
                      data-chat-model-target-group={group().id}
                      aria-label={group().label}
                    >
                      <div class="chat-controls__provider-heading">
                        <span
                          class="chat-controls__provider-icon chat-controls__target-icon"
                          aria-hidden="true"
                        >
                          <Icon name="terminal" />
                        </span>
                        <span>{group().label}</span>
                      </div>
                      <Show when={group().completion} keyed>
                        <Errored fallback={() => <TargetState group={group()} error />}>
                          <Loading fallback={<TargetState group={group()} />}>
                            <TargetOptions group={group()} />
                          </Loading>
                        </Errored>
                      </Show>
                    </section>
                  )}
                </For>
                {panel.params.accountSection ? (
                  <ChatModelAccountSectionView {...accounts()!} />
                ) : undefined}
              </div>
              <div
                class="chat-controls__model-search-empty"
                data-chat-model-search-empty
                hidden={!searchView?.empty()}
              >
                {t("chat.modelControls.noMatchingModels")}
              </div>
              {panel.params.contextWindow ? (
                <ChatContextWindowControl
                  contextWindow={panel.params.contextWindow}
                  sessionKey={panel.params.sessionKey}
                />
              ) : undefined}
            </>
          ) : undefined}
        </>
      )}
      {panel.params.modelSelectionLocked && panel.params.accountSection ? (
        <div class="chat-controls__model-options">
          <ChatModelAccountSectionView {...accounts()!} startIndex={0} />
        </div>
      ) : undefined}
      {panel.params.modelCatalogState?.modelSelectionPolicy?.restricted ? (
        <div class="chat-controls__model-catalog-state" data-chat-model-policy>
          {t("chat.modelControls.restrictedModelsHelp")}
        </div>
      ) : undefined}
    </div>
  );
}
