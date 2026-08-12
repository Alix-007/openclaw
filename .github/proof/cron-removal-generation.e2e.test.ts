import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { expect, it } from "vitest";
import {
  installMockGateway,
  type MockGatewayRequest,
  waitForConfirmModal,
} from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const TARGET_HEAD = "22aaa1ed2988a36b6279936b341229ca2f4615c7";
const artifactDir = path.resolve(
  process.env.OPENCLAW_PROOF_ARTIFACT_DIR ??
    ".artifacts/control-ui-e2e/cron-removal-generation-121137",
);

const suite = createControlUiE2eSuite({
  name: "PR 121137 exact-head Cron removal generation proof",
  startServerBeforeBrowser: true,
  unavailableMessage: (executablePath) =>
    `Playwright Chromium is not installed or cannot start at ${executablePath}.`,
});

const job = {
  id: "nightly-digest",
  name: "Nightly digest",
  enabled: true,
  createdAtMs: Date.parse("2026-08-11T08:00:00.000Z"),
  updatedAtMs: Date.parse("2026-08-11T08:05:00.000Z"),
  schedule: { kind: "every", everyMs: 60_000 },
  sessionTarget: "isolated",
  wakeMode: "now",
  payload: { kind: "agentTurn", message: "Summarize the overnight activity" },
  state: {},
};

function cronListResponse(jobs: unknown[], total = jobs.length) {
  return {
    jobs,
    snapshotRevision: jobs.length > 0 ? "cron-proof-present" : "cron-proof-empty",
    total,
    offset: 0,
    limit: 50,
    hasMore: false,
    nextOffset: null,
  };
}

function cronListFixtures(options: { failing: number; removed: boolean }) {
  return {
    cases: [
      {
        match: { lastRunStatus: "error" },
        response: cronListResponse([], options.failing),
      },
      {
        match: {},
        response: cronListResponse(options.removed ? [] : [job]),
      },
    ],
  };
}

async function visibleStats(page: Page) {
  const tasksText = await page.locator(".cron-stats .cron-stat").first().textContent();
  const failingText = await page
    .locator('[data-test-id="cron-stat-failing"] .cron-stat__value')
    .textContent();
  const tasks = Number(tasksText?.match(/\d+/u)?.[0]);
  const failing = Number(failingText?.trim());
  return { tasks, failing };
}

async function waitForStats(page: Page, expected: { tasks: number; failing: number }) {
  await expect.poll(() => visibleStats(page), { timeout: 10_000 }).toEqual(expected);
}

async function screenshot(page: Page, fileName: string) {
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(artifactDir, fileName),
  });
}

function requestKind(request: MockGatewayRequest) {
  const params = (request.params ?? {}) as Record<string, unknown>;
  if (request.method === "cron.list") {
    return params.lastRunStatus === "error" ? "failing-count" : "jobs-page";
  }
  return request.method;
}

suite.define(() => {
  it("keeps the confirmation-time refresh visible after the removal reload resolves late", async () => {
    expect(process.env.OPENCLAW_PROOF_HEAD_SHA).toBe(TARGET_HEAD);
    expect(process.env.OPENCLAW_PROOF_HARNESS_SHA).toMatch(/^[0-9a-f]{40}$/u);
    const rawVideoDir = path.resolve(
      process.env.OPENCLAW_PROOF_VIDEO_TEMP_DIR ?? path.join(artifactDir, "raw-video"),
    );
    await mkdir(rawVideoDir, { recursive: true });

    const context = await suite.browser.newContext({
      locale: "en-US",
      recordVideo: {
        dir: rawVideoDir,
        size: { height: 900, width: 1280 },
      },
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const video = page.video();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    let verdict: Record<string, unknown> | null = null;

    try {
      const gateway = await installMockGateway(page, {
        methodResponses: {
          "agents.list": {
            agents: [
              { id: "main", name: "Main" },
              { id: "writer", name: "Writer" },
            ],
            defaultId: "main",
            mainKey: "main",
            scope: "agent",
          },
          "cron.list": cronListFixtures({ failing: 1, removed: false }),
          "cron.remove": {},
          "cron.runs": { entries: [], total: 0, offset: 0, limit: 50, hasMore: false },
          "cron.status": { enabled: true, jobs: 1, nextWakeAtMs: null },
        },
      });

      const response = await page.goto(`${suite.server.baseUrl}cron`);
      expect(response?.status()).toBe(200);
      const row = page.locator(`[data-test-id="cron-row-${job.id}"]`);
      await row.waitFor({ state: "visible", timeout: 10_000 });

      const agentScope = page.locator(".agent-scope-control openclaw-agent-select");
      await agentScope.locator(".agent-select__trigger").click();
      await agentScope
        .locator("wa-dropdown-item[data-agent-option]")
        .filter({ hasText: "All agents" })
        .click();
      await expect
        .poll(() =>
          agentScope.evaluate((element) => (element as HTMLElement & { value: string }).value),
        )
        .toBe("");
      await waitForStats(page, { tasks: 1, failing: 1 });
      await screenshot(page, "01-initial-overview.png");

      const menu = page.locator("wa-dropdown.cron-job-menu").first();
      await menu.locator(".cron-job-menu__trigger").click();
      await menu.locator('wa-dropdown-item[value="remove"]').click();
      const confirmation = await waitForConfirmModal(page);
      await expect(confirmation.textContent()).resolves.toContain(job.name);
      await expect.poll(async () => gateway.getRequests("cron.remove")).toHaveLength(0);
      const confirmationOpenedAfterSequence = (await gateway.getRequests()).length;

      await gateway.setMethodResponse(
        "cron.list",
        cronListFixtures({ failing: 2, removed: false }),
      );
      await gateway.setMethodResponse("cron.status", {
        enabled: true,
        jobs: 2,
        nextWakeAtMs: null,
      });
      await page.locator("button.cron-refresh").evaluate((element) => {
        (element as HTMLButtonElement).click();
      });
      await waitForStats(page, { tasks: 2, failing: 2 });
      await expect(confirmation).toBeVisible();
      const newerRefreshCompletedAfterSequence = (await gateway.getRequests()).length;
      await screenshot(page, "02-confirmation-open-refresh-complete.png");

      await gateway.setMethodResponse(
        "cron.list",
        cronListFixtures({ failing: 99, removed: true }),
      );
      await gateway.deferNext("cron.status");
      const statusRequestsBeforeRemoval = (await gateway.getRequests("cron.status")).length;
      await confirmation.getByRole("button", { name: "Remove" }).click();
      await expect.poll(async () => gateway.getRequests("cron.remove")).toHaveLength(1);
      await expect
        .poll(async () => (await gateway.getRequests("cron.status")).length)
        .toBe(statusRequestsBeforeRemoval + 1);
      await expect.poll(() => row.count()).toBe(0);
      await waitForStats(page, { tasks: 2, failing: 2 });
      await screenshot(page, "03-removal-status-99-held.png");

      const failingRequestsBeforeRelease = (await gateway.getRequests("cron.list")).filter(
        (request) => requestKind(request) === "failing-count",
      ).length;
      await gateway.resolveDeferred("cron.status", {
        enabled: true,
        jobs: 99,
        nextWakeAtMs: 99_000,
      });
      await expect
        .poll(
          async () =>
            (await gateway.getRequests("cron.list")).filter(
              (request) => requestKind(request) === "failing-count",
            ).length,
        )
        .toBe(failingRequestsBeforeRelease + 1);
      await expect.poll(() => page.locator("button.cron-refresh").isEnabled()).toBe(true);
      await waitForStats(page, { tasks: 2, failing: 2 });
      await screenshot(page, "04-late-removal-snapshot-rejected.png");

      const requests = await gateway.getRequests();
      const trace = requests
        .map((request, index) => ({
          sequence: index + 1,
          method: request.method,
          kind: requestKind(request),
        }))
        .filter((request) => request.method.startsWith("cron."));
      const removeSequence = trace.find((request) => request.method === "cron.remove")?.sequence;
      const removalTableSequence = trace.find(
        (request) =>
          request.sequence > (removeSequence ?? Number.MAX_SAFE_INTEGER) &&
          request.kind === "jobs-page",
      )?.sequence;
      const removalStatusSequence = trace.find(
        (request) =>
          request.sequence > (removalTableSequence ?? Number.MAX_SAFE_INTEGER) &&
          request.method === "cron.status",
      )?.sequence;
      const removalFailingSequence = trace.find(
        (request) =>
          request.sequence > (removalStatusSequence ?? Number.MAX_SAFE_INTEGER) &&
          request.kind === "failing-count",
      )?.sequence;

      expect(removeSequence).toBeGreaterThan(newerRefreshCompletedAfterSequence);
      expect(removalTableSequence).toBeGreaterThan(removeSequence ?? 0);
      expect(removalStatusSequence).toBeGreaterThan(removalTableSequence ?? 0);
      expect(removalFailingSequence).toBeGreaterThan(removalStatusSequence ?? 0);
      const webSocketConnections = await gateway.getSocketCount();
      expect(webSocketConnections).toBeGreaterThanOrEqual(1);
      expect(pageErrors).toEqual([]);
      expect((await page.locator(".cron-stats").textContent())?.includes("99")).toBe(false);

      verdict = {
        schemaVersion: 1,
        targetHeadSha: TARGET_HEAD,
        harnessSha: process.env.OPENCLAW_PROOF_HARNESS_SHA,
        verdict: "pass",
        runtime: {
          node: process.version,
          browser: `Chromium ${suite.browser.version()}`,
        },
        boundary: {
          controlUi: "source-mounted Vite production Cron page",
          transport: "repository mock Gateway WebSocket",
          fixture: "secretless deterministic request ordering",
        },
        ordering: {
          webSocketConnections,
          confirmationOpenedAfterSequence,
          newerRefreshCompletedAfterSequence,
          removeSequence,
          removalTableSequence,
          removalStatusSequence,
          removalFailingSequence,
        },
        requestTrace: trace,
        assertions: {
          initialVisible: { tasks: 1, failing: 1 },
          confirmationRefreshVisible: { tasks: 2, failing: 2 },
          delayedRemovalSnapshot: { tasks: 99, failing: 99 },
          finalVisible: { tasks: 2, failing: 2 },
          confirmationStayedOpenDuringRefresh: true,
          removalStatusWasHeld: true,
          staleRemovalSnapshotOverwroteNewerGeneration: false,
          pageErrors: 0,
        },
        artifacts: {
          screenshots: 4,
          video: "cron-removal-generation.webm",
        },
        secretOutput: false,
      };
    } finally {
      await context.close();
      if (video) {
        await video.saveAs(path.join(artifactDir, "cron-removal-generation.webm"));
      }
    }

    expect(verdict).not.toBeNull();
    await writeFile(
      path.join(artifactDir, "verdict.json"),
      `${JSON.stringify(verdict, null, 2)}\n`,
      "utf8",
    );
    console.log(
      "[cron removal generation proof] exact-head=true confirm-held=true refresh-visible=2 remove=true delayed-status=99 final-visible=2 stale-overwrite=false secret-output=false",
    );
  }, 90_000);
});
