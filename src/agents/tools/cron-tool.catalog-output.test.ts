import { afterEach, expect, it } from "vitest";
import { resetGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { getToolContractFailureCode } from "../tool-contract-error.js";
import { ToolSearchRuntime } from "../tool-search-runtime.js";
import {
  createToolSearchCatalogRef,
  registerHeadlessToolSearchCatalog,
  resolveToolSearchConfig,
} from "../tool-search.js";
import { createCronTool } from "./cron-tool.js";

afterEach(() => resetGlobalHookRunner());

const pausedJob = {
  id: "operator-paused",
  name: "Operator paused job",
  enabled: false,
  nextRunAt: null,
  nextRunAtMs: null,
  scheduleKind: "every",
  lastRunAt: null,
  lastRunAtMs: null,
  lastRunStatus: null,
  lastRunError: null,
};

function createInventory(jobs: Record<string, unknown>[]) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const tool = createCronTool(undefined, {
    callGatewayTool: async <T>(method: string, _options: unknown, params: unknown) => {
      calls.push({ method, params });
      return {
        jobs,
        total: jobs.length,
        offset: 0,
        limit: 50,
        hasMore: false,
        nextOffset: null,
      } as T;
    },
  });
  const catalogRef = createToolSearchCatalogRef();
  registerHeadlessToolSearchCatalog({ catalogRef, tools: [tool] });
  const runtime = new ToolSearchRuntime(
    { catalogRef },
    resolveToolSearchConfig({ tools: { toolSearch: { enabled: true, mode: "tools" } } }),
    { validateInput: true },
  );
  return {
    calls,
    list: () => runtime.callValue(tool.name, { action: "list", includeDisabled: true }),
  };
}

it("returns mixed auto-disabled and operator-paused jobs through catalog validation", async () => {
  const jobs = [{ ...pausedJob, id: "auto-disabled", autoDisabled: true }, pausedJob];
  const fixture = createInventory(jobs);
  await expect(fixture.list()).resolves.toMatchObject({ jobs, scope: "caller" });
  expect(fixture.calls).toEqual([
    { method: "cron.list", params: { includeDisabled: true, compact: true } },
  ]);
});

it.each([{ jobs: [] }, { jobs: [pausedJob] }])(
  "accepts inventories without the optional marker: %j",
  async ({ jobs }) => {
    await expect(createInventory(jobs).list()).resolves.toMatchObject({ jobs });
  },
);

it.each([false, "true", null])(
  "rejects an invalid autoDisabled marker: %j",
  async (autoDisabled) => {
    const fixture = createInventory([{ ...pausedJob, autoDisabled }]);
    const error = await fixture.list().catch((value: unknown) => value);
    expect(getToolContractFailureCode(error)).toBe("output_contract");
    expect(fixture.calls).toHaveLength(1);
  },
);

it("keeps unrelated compact fields forbidden", async () => {
  const fixture = createInventory([{ ...pausedJob, unexpectedField: true }]);
  const error = await fixture.list().catch((value: unknown) => value);
  expect(getToolContractFailureCode(error)).toBe("output_contract");
  expect(fixture.calls).toHaveLength(1);
});
