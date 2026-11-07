import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(process.env.OPENCLAW_FAVORITES_PROOF_CHECKOUT ?? process.argv[2] ?? process.cwd());
const artifactParent = path.resolve(process.env.OPENCLAW_FAVORITES_PROOF_OUTPUT ?? process.argv[3] ?? path.dirname(fileURLToPath(import.meta.url)));
const stage = process.env.OPENCLAW_FAVORITES_PROOF_STAGE ?? process.argv[4] ?? "smoke";
const stablePackage = path.resolve(process.env.OPENCLAW_FAVORITES_PROOF_STABLE ?? process.argv[5] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "stable-2026.11.1/package"));
const proofBase = process.env.OPENCLAW_FAVORITES_PROOF_BASE ?? "1de61f3e587c3093e57964f1423ba1ad51551b56";
const sourceSmokeHistory = path.resolve(process.env.OPENCLAW_FAVORITES_PROOF_SMOKE_HISTORY ?? path.join(artifactParent, "favorites-smoke-nIrvVV/receipt.json"));
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
const { createControlUiE2eArtifactDir } = await load("ui/src/test-helpers/control-ui-e2e-artifacts.ts");
const { startControlUiE2eServer, startBuiltControlUiE2eServer, installMockGateway, defaultControlUiFeatureMethods } = await load("ui/src/test-helpers/control-ui-e2e.ts");
const { waitForControlUiGatewayReady } = await load("ui/src/test-helpers/control-ui-e2e-readiness.ts");
const output = createControlUiE2eArtifactDir(`favorites-${stage}`, artifactParent);
const receipt = {
  at: new Date().toISOString(), stage, output, checkout: root,
  collectorSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
  head: git("rev-parse", "HEAD"), headTree: git("rev-parse", "HEAD^{tree}"),
  worktreeStatus: git("status", "--porcelain"),
  comparisonBase: proofBase,
  stagedDiffSha256: sha256(git("diff", "--cached", proofBase, "--binary")),
  originalCollectorSha256: "1638d3bda3b915f7b2ce62299b51ebd48c3370465ff89afc486c7660047f6733",
  firstAttempt: { receipt: "favorites-exact-head-djeSpK/receipt.json", result: "BLOCKED at unsupported fixed15px glyph assumption before actions", diagnosis: "favorites-canonical-first-native-diagnosis.json", qualification: "Pinned-main composer-surface.css .agent-chat__composer-footer svg intentionally supplies the inherited16px glyph size/stroke2 later in the cascade; assert actual context owner tokens without product edits" },
  canonicalVisualChange: "Current canonical 28px IconButton uses an outlined row glyph and shared pressed background. Existing composer SVG cascade determines the actual context glyph size (16px in this build); not visual parity with historical 18px filled-heart captures.",
  source: {}, served: [], observations: [], controls: {}, errors: [],
  limitations: ["Synthetic Gateway transport with real browser UI and real canonical preference workers; not a live authenticated Gateway authorization test.", "Personal-versus-shared product scope remains pending maintainer acceptance.", "Chromium only; native WebKit unavailable because required ICU 74 libraries are absent."],
};
const built = stage === "exact-head";
let builtIdentity;
let entryAssets = [];
if (built) {
  const index = fs.readFileSync(path.join(root, "dist/control-ui/index.html"), "utf8");
  const identity = index.match(/globalThis\.OPENCLAW_CONTROL_UI_BUILD_INFO=(\{[^<]+\});<\/script>/);
  assert.ok(identity, "Normal built index must include its source identity");
  builtIdentity = JSON.parse(identity[1]);
  assert.equal(builtIdentity.commit, receipt.head);
  assert.equal(builtIdentity.dirty, false);
  entryAssets = [...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => {
    const relative = match[1].replace(/^\.\//, "");
    assert.ok(relative.startsWith("assets/") && relative.endsWith(".js"));
    return { path: `/${relative}`, sha256: sha256(fs.readFileSync(path.join(root, "dist/control-ui", relative))) };
  });
  assert.ok(entryAssets.length);
  receipt.build = { ...builtIdentity, indexSha256: sha256(index), entryAssets, mode: "Existing normal production UI build served unchanged; no rebuild or identity rewrite" };
  const acquisition = path.join(path.dirname(stablePackage), "acquisition.json");
  receipt.stableAcquisition = { path: acquisition, ...JSON.parse(fs.readFileSync(acquisition, "utf8")) };
  assert.equal(receipt.stableAcquisition.version, "2026.11.1");
  const historyPath = sourceSmokeHistory;
  const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  receipt.sourceSmokeHistory = { path: historyPath, sha256: sha256(fs.readFileSync(historyPath)), head: history.head, stage: history.stage, result: history.result, boundary: "Earlier source-server smoke; kept separate from this built run" };
}
for (const relative of ["ui/src/pages/chat/components/chat-model-favorites.ts", "ui/src/pages/chat/components/chat-model-picker-panel.tsx", "ui/src/pages/chat/components/chat-model-picker-options.tsx", "ui/src/pages/chat/components/chat-model-provider-heading.tsx"]) {
  receipt.source[relative] = { sha256: sha256(fs.readFileSync(path.join(root, relative))), indexBlob: git("rev-parse", `:${relative}`) };
}
if (stage === "exact-head") assert.equal(receipt.worktreeStatus, "", "Exact-head proof requires a clean worktree");
const started = Date.now();
let state, server, browser, page, gateway, readPrefs, profileId, upgrade;
const responseJobs = [];
async function until(check, name) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(`Unsettled proof observation: ${name}`);
}
const favoriteKey = JSON.stringify(["openai/gpt-5-mini", null]);
const preferenceKey = "ui.modelFavorites:main";
const favoriteGroup = (p) => p.locator('[data-chat-model-provider-group="$favorites"]');
const providerGroup = (p) => p.locator('[data-chat-model-provider-group="openai"]');
const heartFor = (p, key, group = providerGroup(p)) => group.locator(`[data-chat-model-favorite=${JSON.stringify(key)}]`);
async function expand(group) {
  await group.waitFor();
  const toggle = group.locator("[data-chat-model-provider-toggle]");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}
async function screenshot(name) {
  const menu = page.locator(".chat-controls__model-menu");
  const visibleHeart = page.locator("[data-chat-model-favorite]:visible").first();
  await menu.waitFor({ state: "visible" });
  await visibleHeart.waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter(image => image.complete).map(image => image.decode().catch(() => {})));
  });
  const targets = [menu, visibleHeart];
  let previous;
  let settled;
  await until(async () => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await Promise.all(targets.map(target => target.boundingBox()));
    assert.ok(bounds.every(rect => rect && rect.width > 0 && rect.height > 0));
    const signature = JSON.stringify(bounds);
    settled = bounds;
    const stable = signature === previous;
    previous = signature;
    return stable;
  }, "standalone native capture layout");
  const png = await page.screenshot({ fullPage: false, animations: "disabled", caret: "hide", scale: "device" });
  assert.deepEqual(await Promise.all(targets.map(target => target.boundingBox())), settled);
  fs.writeFileSync(path.join(output, `${name}.png`), png);
  const canonicalStyle = await visibleHeart.evaluate(button => {
    const icon = button.querySelector("svg");
    const style = getComputedStyle(button);
    const glyph = icon && getComputedStyle(icon);
    return { owner: button.className, pressed: button.getAttribute("aria-pressed"), disabled: button.disabled, width: style.width, height: style.height, glyphWidth: glyph?.width, glyphHeight: glyph?.height, glyphFill: glyph?.fill, glyphStrokeWidth: glyph?.strokeWidth, composerGlyphSize: style.getPropertyValue("--chat-composer-icon-size").trim(), composerGlyphStroke: style.getPropertyValue("--chat-composer-icon-stroke").trim(), rowGlyphSize: style.getPropertyValue("--list-row-icon-size").trim(), background: style.backgroundColor, color: style.color };
  });
  assert.ok(canonicalStyle.owner.includes("oc-icon-button--28"));
  assert.ok(canonicalStyle.owner.includes("oc-icon-button--row-glyph"));
  assert.equal(canonicalStyle.width, "28px");
  assert.equal(canonicalStyle.height, "28px");
  assert.equal(canonicalStyle.glyphWidth, canonicalStyle.composerGlyphSize);
  assert.equal(canonicalStyle.glyphHeight, canonicalStyle.composerGlyphSize);
  assert.equal(Number.parseFloat(canonicalStyle.glyphStrokeWidth), Number.parseFloat(canonicalStyle.composerGlyphStroke));
  assert.equal(canonicalStyle.glyphFill, "none");
  (receipt.captures ??= []).push({ file: `${name}.png`, sha256: sha256(png), bounds: settled, canonicalStyle, method: "Standalone Playwright native viewport capture after visible semantic controls, settled fonts/two-frame geometry; no fake Vitest context" });
}
try {
  const { createOpenClawTestState } = await load("src/test-utils/openclaw-test-state.ts");
  state = await createOpenClawTestState({ layout: "state-only", prefix: "alix-favorites-111-proof-" });
  fs.mkdirSync(state.home, { recursive: true, mode: 0o700 });
  const seed = execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "favorites-proof-stable-seed.mjs"), stablePackage], {
    encoding: "utf8", timeout: 60000,
    env: { PATH: process.env.PATH, HOME: state.home, OPENCLAW_STATE_DIR: state.stateDir, OPENCLAW_CONFIG_PATH: state.configPath, NODE_ENV: "test" },
  });
  upgrade = JSON.parse(seed.trim());
  receipt.upgrade = { ...upgrade, writerExited: true, package: stablePackage, seedSha256: sha256(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "favorites-proof-stable-seed.mjs"))) };
  receipt.storage = { stateDir: state.stateDir, home: state.home, syntheticProfiles: [upgrade.profileId, upgrade.otherProfileId] };
  const { prepareStartupClientCredentials } = await load("src/commands/startup-client-credentials.ts");
  await prepareStartupClientCredentials({ env: state.env });
  receipt.upgrade.startupOwner = "prepareStartupClientCredentials: production backed-up Doctor maintenance, no manual schema writes";
  const { ensureProfileForEmail } = await load("src/state/user-profiles.ts");
  const preferences = await load("src/state/user-preferences.ts");
  readPrefs = preferences.getCanonicalUserPreferences;
  receipt.canonicalOwner = { file: "src/state/user-preferences.ts", sha256: sha256(fs.readFileSync(path.join(root, "src/state/user-preferences.ts"))), read: readPrefs.name, write: preferences.setCanonicalUserPreferences.name, boundary: "Actual candidate worker-backed canonical preference owner; adapter substitutes Gateway transport only" };
  profileId = ensureProfileForEmail("operator@example.test").id;
  assert.equal(profileId, upgrade.profileId);
  assert.deepEqual((await readPrefs(profileId)).entries, upgrade.entries);
  assert.deepEqual((await readPrefs(upgrade.otherProfileId)).entries, upgrade.otherEntries);
  receipt.upgrade.currentOwnerReadback = "PASS: both released profiles and every original preference remain exact";
  server = built
    ? await startBuiltControlUiE2eServer(path.join(root, "dist/control-ui"))
    : await startControlUiE2eServer(undefined, { source: true });
  receipt.serving = { baseUrl: server.baseUrl, mode: built ? "Normal built ControlUiE2e preview server; existing dist/control-ui, real browser, synthetic Gateway transport" : "normal ControlUiE2e Vite source server; served module hashes recorded, no installed production UI" };
  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-gpu-rasterization", "--disable-partial-raster"] });
  receipt.browser = { engine: "Chromium", version: browser.version() };
  async function setup(p) {
    p.on("pageerror", error => receipt.errors.push(error.message));
    p.on("console", msg => { if (msg.type() === "error") receipt.errors.push(msg.text().slice(0, 1200)); });
    p.on("response", response => {
      const pathname = new URL(response.url()).pathname;
      const entry = entryAssets.find(asset => pathname.endsWith(asset.path));
      const document = built && response.request().resourceType() === "document";
      if (entry || document || /chat-model-(favorites|picker-panel|picker-options|provider-heading)\.tsx?(\?|$)/.test(response.url())) {
        responseJobs.push(response.body().then(body => {
          const fingerprint = sha256(body);
          if (entry) assert.equal(fingerprint, entry.sha256, "Browser must receive the exact normal built entry asset");
          if (document) assert.equal(fingerprint, receipt.build.indexSha256, "Browser must receive the exact normal built index");
          receipt.served.push({ kind: entry ? "built-entry" : document ? "built-index" : "source-module", url: response.url(), status: response.status(), sha256: fingerprint });
        }).catch(error => receipt.errors.push(String(error))));
      }
    });
    return installMockGateway(p, {
      communityInvite: false, terminalEnabled: false,
      ...(builtIdentity ? { serverVersion: builtIdentity.version, serverCommit: builtIdentity.commit, serverBuiltAt: builtIdentity.builtAt, serverBuildId: builtIdentity.buildId } : {}),
      operatorScopes: ["operator.admin", "operator.read", "operator.write"],
      presenceUsers: [{ id: profileId, name: "Demo Operator", self: true }],
      agentModel: "openai/gpt-5.5",
      models: [
        { id: "gpt-5.5", name: "GPT 5.5", provider: "openai" },
        { id: "gpt-5-mini", name: "GPT 5 mini", provider: "openai" },
        { id: "claude-sonnet-4-6", name: "Claude Sonnet", provider: "anthropic" },
        ...Array.from({ length: 997 }, (_, i) => ({ id: `window-proof-${i}`, name: `Window Model ${String(i).padStart(4, "0")}`, provider: "openai" })),
      ],
      featureMethods: [...defaultControlUiFeatureMethods, "users.prefs.get", "users.prefs.set"],
    }, { requestHandlers: {
      "users.prefs.get": async params => {
        const result = await readPrefs(profileId, params?.keys);
        assert.ok(result);
        receipt.observations.push({ method: "users.prefs.get", params, entries: result.entries });
        return { status: "ok", entries: result.entries };
      },
      "users.prefs.set": async params => {
        const result = await preferences.setCanonicalUserPreferences(profileId, params.entries, { expectedEntries: params.expectedEntries });
        assert.ok(result);
        receipt.observations.push({ method: "users.prefs.set", params, result: result.ok ? "ok" : result.error.code });
        return { status: result.ok ? "ok" : "conflict" };
      },
    } });
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", serviceWorkers: "block" });
  page = await context.newPage();
  gateway = await setup(page);
  await page.goto(server.baseUrl + "chat");
  await waitForControlUiGatewayReady(page);
  if (built) {
    receipt.serving.browserBuildInfo = await page.evaluate(() => globalThis.OPENCLAW_CONTROL_UI_BUILD_INFO);
    assert.deepEqual(receipt.serving.browserBuildInfo, builtIdentity);
  }
  await page.locator(".agent-chat__composer-combobox textarea").waitFor({ timeout: 60000 });
  await page.locator("[data-chat-model-select]").first().click();
  await expand(providerGroup(page));
  const search = page.locator("[data-chat-model-search]");
  const heart = heartFor(page, favoriteKey);
  await heart.waitFor();
  await until(() => heart.isEnabled(), "initial preference receipt");
  await screenshot("before");
  assert.equal(await heart.getAttribute("aria-pressed"), "false");
  assert.equal(await favoriteGroup(page).count(), 0);
  receipt.controls.catalogSize = 1000;
  const initialCount = await page.locator("[data-chat-model-option]").count();
  assert.ok(initialCount > 1 && initialCount < 60);
  receipt.controls.initialMountedRows = initialCount;
  await search.fill("Window Model 0996");
  await until(async () => (await page.locator("[data-chat-model-favorite]:visible").count()) === 1, "offscreen catalog search");
  assert.equal(await page.locator("[data-chat-model-favorite]:visible").getAttribute("data-chat-model-favorite"), '["openai/window-proof-996",null]');
  await search.fill("");
  await heart.waitFor();
  receipt.controls.offscreenSearch = true;
  const allModels = providerGroup(page).locator("[data-chat-model-more-toggle]");
  await allModels.click();
  const viewport = page.locator("[data-chat-model-window]");
  await viewport.hover();
  await page.mouse.wheel(0, 40000);
  const lastModel = heartFor(page, '["openai/window-proof-996",null]');
  await lastModel.waitFor({ state: "visible" });
  const scrolledCount = await page.locator("[data-chat-model-option]").count();
  assert.ok(scrolledCount > 1 && scrolledCount < 60);
  receipt.controls.scrolledMountedRows = scrolledCount;
  await page.mouse.wheel(0, -40000);
  await heart.waitFor({ state: "visible" });
  const beforePatch = (await gateway.getRequests("sessions.patch")).length;
  await heart.focus();
  await heart.press("Enter");
  await until(async () => (await readPrefs(profileId)).entries[preferenceKey]?.includes(favoriteKey), "durable favorite write");
  assert.equal(await search.evaluate(node => document.activeElement === node), true);
  receipt.controls.keyboardFocusRetained = true;
  await expand(favoriteGroup(page));
  await until(async () => await heart.getAttribute("aria-pressed") === "true", "provider duplicate retained selected");
  assert.equal(await heartFor(page, favoriteKey, favoriteGroup(page)).getAttribute("aria-pressed"), "true");
  const duplicateRows = page.locator(`[data-chat-model-option="openai/gpt-5-mini"]`);
  assert.equal(await duplicateRows.count(), 2);
  const rowIds = await duplicateRows.evaluateAll(rows => rows.map(row => row.id));
  assert.equal(new Set(rowIds).size, 2);
  assert.ok(rowIds.every(Boolean));
  assert.equal(await page.locator(".chat-controls__model-menu").isVisible(), true);
  receipt.controls.independentFavoriteAndProviderRows = rowIds;
  receipt.favoriteReadback = (await readPrefs(profileId)).entries;
  await screenshot("after");
  const second = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", serviceWorkers: "block" });
  const secondPage = await second.newPage();
  const secondGateway = await setup(secondPage);
  await secondPage.goto(server.baseUrl + "chat");
  await waitForControlUiGatewayReady(secondPage);
  await secondPage.locator("[data-chat-model-select]").first().click();
  await expand(favoriteGroup(secondPage));
  assert.equal(await heartFor(secondPage, favoriteKey, favoriteGroup(secondPage)).getAttribute("aria-pressed"), "true");
  receipt.controls.secondBrowserReadback = true;
  await secondPage.reload();
  await waitForControlUiGatewayReady(secondPage);
  await secondPage.locator("[data-chat-model-select]").first().click();
  await expand(favoriteGroup(secondPage));
  const remove = heartFor(secondPage, favoriteKey, favoriteGroup(secondPage));
  await until(() => remove.isEnabled(), "reloaded favorite enabled");
  assert.equal(await remove.getAttribute("aria-pressed"), "true");
  await remove.focus();
  await remove.press("Space");
  await until(async () => !Object.hasOwn((await readPrefs(profileId)).entries, preferenceKey), "durable unfavorite removal");
  receipt.controls.reloadSpaceAndRemoval = true;
  assert.equal((await gateway.getRequests("sessions.patch")).length, beforePatch);
  assert.equal((await secondGateway.getRequests("sessions.patch")).length, 0);
  receipt.controls.noModelSelection = true;
  const after = (await readPrefs(profileId)).entries;
  const expectedMigration = { "new-session.migration.v1": true };
  assert.deepEqual(after, { ...upgrade.entries, ...expectedMigration });
  assert.deepEqual((await readPrefs(upgrade.otherProfileId)).entries, upgrade.otherEntries);
  receipt.upgrade.afterRemoval = after;
  receipt.upgrade.documentedAddedMetadata = expectedMigration;
  receipt.upgrade.otherProfileAfter = (await readPrefs(upgrade.otherProfileId)).entries;
  receipt.upgrade.result = "PASS: both released profiles preserved, only the exact current-owner new-session migration marker added";
  await second.close();
  await Promise.all(responseJobs);
  assert.ok(receipt.served.some(module => (built ? module.kind === "built-entry" : module.url.includes("chat-model-picker-panel.tsx")) && module.status === 200));
  if (built) assert.ok(receipt.served.some(module => module.kind === "built-index" && module.status === 200));
  assert.deepEqual(receipt.errors, []);
  receipt.result = "PASS";
  receipt.acceptance = "Released 2026.11.1 two-profile preferences survive real candidate startup; actual inline hearts persist/read/remove through canonical storage across two browser contexts and reload with zero model-selection writes.";
} catch (error) {
  receipt.result = "BLOCKED";
  receipt.failure = String(error.stack ?? error);
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    receipt.diagnostic = { text: (await page.locator("body").innerText()).slice(-6000), requests: await gateway?.getRequests() };
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  await state?.cleanup();
  receipt.cleanup = "Closed both isolated browsers/source server and canonical workers; removed private state. No production service, account configuration, model call, session message or external channel touched.";
  receipt.elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ result: receipt.result, output, acceptance: receipt.acceptance, failure: receipt.failure }));
}

export { receipt };
