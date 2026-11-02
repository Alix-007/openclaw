import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const taskDir = path.dirname(new URL(import.meta.url).pathname);
const [checkoutArg, outputParent, mode, expected] = process.argv.slice(2);
assert.ok(["draft", "label"].includes(mode));
assert.ok(["base", "head"].includes(expected));
const baseline = path.resolve(checkoutArg);
assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: baseline, encoding: "utf8" }), "");
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: baseline, encoding: "utf8" }).trim();
const uiRoot = path.join(baseline, "ui");
const requireUi = createRequire(path.join(uiRoot, "package.json"));
const importSource = (relative: string) => import(pathToFileURL(path.join(baseline, relative)).href);
const { createControlUiE2eArtifactDir } = await importSource("ui/src/test-helpers/control-ui-e2e-artifacts.ts");
const artifactDir = createControlUiE2eArtifactDir("ui-settings-" + mode + "-" + expected, path.resolve(outputParent));
const report: Record<string, any> = {
  sourceHead, mode, expected,
  source: baseline,
  artifactDir,
  verdict: "setup-gap",
  stages: [],
  cases: [],
  externalRequestsBlocked: [],
};
const save = () => writeFileSync(path.join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
const stage = (name: string) => { report.stages.push({ name, at: new Date().toISOString() }); save(); console.log(name); };
let browser: any;
let server: any;
let currentPage: any;
let deadline: ReturnType<typeof setTimeout>;
try {
  deadline = setTimeout(() => {
    report.failure = { message: "Collector exceeded its 300-second total bound" };
    save();
    void browser?.close();
    void server?.close();
    process.exitCode = 2;
  }, 300_000);
  const [playwright, harness] = await Promise.all([
    import(pathToFileURL(requireUi.resolve("playwright")).href),
    importSource("ui/src/test-helpers/control-ui-e2e.ts"),
  ]);
  report.playwrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  stage("dependencies-imported");
  const playwrightApi = playwright.chromium ? playwright : playwright.default;
  browser = await playwrightApi.chromium.launch({ headless: true });
  report.browserVersion = browser.version();
  stage("matching-headless-chromium-started");
  server = await harness.startControlUiE2eServer(undefined, { source: true });
  const origin = new URL(server.baseUrl).origin;
  report.origin = origin;
  stage("stock-vite-source-started");

  const settle = (page: any) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const rowFor = (page: any, title: string) => page.locator(".settings-row").filter({ has: page.locator(".settings-row__title").getByText(title, { exact: true }) });
  const capture = async (input: any, markIdentity = false) => input.evaluate((element: HTMLInputElement, mark: boolean) => {
    const scope = window as any;
    if (mark) scope.__modelPickerCollectorInput = element;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      value: element.value, hidden: element.hidden, disabled: element.disabled,
      display: style.display, visibility: style.visibility,
      connected: element.isConnected, sameNode: scope.__modelPickerCollectorInput === element,
      focused: document.activeElement === element,
      activeElement: document.activeElement?.tagName.toLowerCase(),
      activeClass: document.activeElement?.getAttribute("class"),
      selectionStart: element.selectionStart, selectionEnd: element.selectionEnd,
      width: rect.width, height: rect.height,
      usagePublication: (document.querySelector("openclaw-app-shell") as any)?.readiness?.runtime?.context?.gateway?.snapshot?.usagePublications?.main ?? null,
    };
  }, markIdentity);
  const memoryPlugins = ["memory-core", "memory-lancedb"].map(id => ({ id, name: id === "memory-core" ? id : "Memory LanceDB", installed: true, enabled: true, state: "enabled", kind: ["memory"] }));
  const runCase = async (name: string, action: "custom-publish" | "custom-blur" | "text-publish") => {
    const context = await browser.newContext({ colorScheme: "dark", locale: "en-US", serviceWorkers: "block", viewport: { height: 1000, width: 1440 } });
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(30_000);
    const result: any = { name, action, pageErrors: [] };
    report.cases.push(result); save();
    page.on("pageerror", (error: Error) => { result.pageErrors.push(error.message); save(); });
    await page.route("**/*", async (route: any) => {
      const url = route.request().url();
      if (url.startsWith(origin + "/")) return route.fallback();
      report.externalRequestsBlocked.push({ url, method: route.request().method() }); save();
      return route.abort("blockedbyclient");
    });
    const syntheticConfig = {
      agents: { defaults: { userTimezone: "Asia/Singapore" } },
      plugins: { slots: { memory: "memory-core" }, entries: { "memory-core": { config: { dreaming: { frequency: "0 6 * * *", verboseLogging: true } } } } },
    };
    const gateway = await harness.installMockGateway(page, { methodResponses: {
      "config.get": { config: syntheticConfig, hash: "memory-defaults-e2e", appliedConfigHash: "memory-defaults-e2e", raw: JSON.stringify(syntheticConfig), valid: true, issues: [] },
      "plugins.list": { plugins: memoryPlugins, diagnostics: [], mutationAllowed: true },
    } }, { afterInitScript: harness.createControlUiMockSameOriginGatewayScript() });
    result.httpStatus = (await page.goto(origin + "/settings/memory/settings", { timeout: 60_000 }))?.status();
    const row = rowFor(page, action === "text-publish" ? "Dreaming frequency" : "Dreaming model");
    await row.waitFor({ state: "visible", timeout: 60_000 });
    const input = action === "text-publish" ? row.getByRole("textbox") : row.locator("input.model-picker__custom");
    result.initial = await capture(input);
    if (action !== "text-publish") {
      result.customOptionLabel = await input.getAttribute("aria-label");
      await row.locator(".picker-select__trigger").click();
      const option = page.getByRole("option", { name: result.customOptionLabel, exact: true });
      result.customOptionText = await option.innerText();
      await page.screenshot({ path: path.join(artifactDir, name + "-option.png"), fullPage: true });
      await option.click();
      await input.waitFor({ state: "visible" });
      result.chosenCustom = await capture(input);
    }
    const draft = action === "text-publish" ? "0 4 * * *" : "anthropic/collector-draft-model";
    await input.fill(draft);
    result.before = await capture(input, true);
    result.requestsBefore = await gateway.getRequests("config.set");
    await page.screenshot({ path: path.join(artifactDir, name + "-before.png"), fullPage: true });
    save();
    if (action === "custom-blur") {
      await input.blur();
      await page.waitForFunction(() => (window as any).openclawControlUiE2eGateway?.findRequests("config.set").length > 0, undefined, { timeout: 10_000 });
    } else {
      const publication = { agentId: "main", usageUpdatedAt: Date.now(), modelCatalogChanged: false, authChanged: false };
      result.publication = publication;
      await gateway.emitGatewayEvent("chat.metadata.changed", publication);
      await page.waitForFunction((expected: number) => (document.querySelector("openclaw-app-shell") as any)?.readiness?.runtime?.context?.gateway?.snapshot?.usagePublications?.main?.usageUpdatedAt === expected, publication.usageUpdatedAt, { timeout: 10_000 });
    }
    await settle(page);
    result.after = await capture(input);
    result.requestsAfter = await gateway.getRequests("config.set");
    result.socketUrls = await gateway.getSocketUrls();
    result.customRowText = await row.textContent();
    await page.screenshot({ path: path.join(artifactDir, name + "-after.png"), fullPage: true });
    result.draftPreserved = result.after.value === draft && result.after.hidden === false && result.after.focused === true && result.after.sameNode === true;
    if (action === "custom-blur") {
      const saved = result.requestsAfter.at(-1);
      const raw = JSON.parse(String(saved?.params?.raw ?? "{}"));
      result.savedModel = raw.plugins?.entries?.["memory-core"]?.config?.dreaming?.model;
      result.commitControlPass = result.requestsBefore.length === 0 && result.savedModel === draft;
    }
    save();
    console.log(JSON.stringify({ name, before: result.before, after: result.after, draftPreserved: result.draftPreserved, commitControlPass: result.commitControlPass }));
    await context.close();
    currentPage = undefined;
  };
  if (mode === "draft") {
    await runCase("custom-model-usage-publication", "custom-publish");
    await runCase("normal-custom-model-blur-control", "custom-blur");
    await runCase("normal-text-draft-publication-control", "text-publish");
    const [candidate, commitControl, textControl] = report.cases;
    assert.equal(candidate.before.value, "anthropic/collector-draft-model");
    assert.equal(candidate.draftPreserved, expected === "head");
    assert.equal(candidate.requestsBefore.length, 0);
    assert.equal(candidate.requestsAfter.length, 0);
    if (expected === "base") assert.equal(candidate.after.value, "");
    else assert.equal(candidate.after.selectionStart, candidate.before.selectionStart);
    report.controlsPass = commitControl.commitControlPass && textControl.draftPreserved;
  } else {
    await runCase("cold-custom-model-label", "custom-blur");
    const [candidate] = report.cases;
    const label = expected === "base" ? "cron.form.customModel" : "Custom model…";
    assert.equal(candidate.customOptionLabel, label);
    assert.equal(candidate.customOptionText.trim(), label);
    report.controlsPass = candidate.commitControlPass;
  }
  assert.equal(report.controlsPass, true);
  assert.deepEqual(report.externalRequestsBlocked, []);
  for (const result of report.cases) assert.deepEqual(result.pageErrors, []);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: baseline, encoding: "utf8" }), "");
  report.verdict = expected === "base" ? "RED" : "GREEN";
  stage("scenario-and-controls-finished");
} catch (error) {
  report.failure = { message: String(error), stack: error instanceof Error ? error.stack : null };
  if (currentPage && !currentPage.isClosed()) {
    try {
      report.failure.browserText = (await currentPage.locator("body").innerText({ timeout: 2000 })).slice(0, 12000);
      report.failure.requestSummary = await currentPage.evaluate(() => ((window as any).openclawControlUiE2eGateway?.requests ?? []).map((request: any) => ({ method: request.method, params: request.params })));
      await currentPage.screenshot({ path: path.join(artifactDir, "failure.png"), fullPage: true, timeout: 3000 });
    } catch (diagnosticError) { report.failure.diagnosticError = String(diagnosticError); }
  }
  console.error(report.failure.message);
  process.exitCode = 2;
} finally {
  clearTimeout(deadline!);
  save();
  await browser?.close();
  await server?.close();
  console.log(JSON.stringify({ verdict: report.verdict, controlsPass: report.controlsPass, artifactDir, failure: report.failure?.message }));
}
