import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2]);
const parent = path.resolve(process.argv[3]);
const stage = process.argv[4] ?? "base";
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
const { createControlUiE2eArtifactDir } = await load("ui/src/test-helpers/control-ui-e2e-artifacts.ts");
const { startBuiltControlUiE2eServer, installMockGateway, defaultControlUiFeatureMethods } = await load("ui/src/test-helpers/control-ui-e2e.ts");
const { waitForControlUiGatewayReady } = await load("ui/src/test-helpers/control-ui-e2e-readiness.ts");
const { openChatSidePanelType } = await load("ui/src/e2e/chat-side-panel.test-support.ts");
const out = createControlUiE2eArtifactDir(`address-ime-built-${stage}`, parent);
const receipt = {
  at: new Date().toISOString(), stage, checkout: root, head: git("rev-parse", "HEAD"),
  worktreeStatus: git("status", "--porcelain"), output: out,
  collectorSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
  source: Object.fromEntries(["ui/src/components/browser/browser-panel-toolbar.tsx", "ui/src/components/browser/browser-panel-owner.ts", "ui/src/components/browser/browser-url.ts", "ui/src/lib/ime.ts"].map(p => [p, sha(fs.readFileSync(path.join(root, p)))])),
  served: [], cases: [], errors: [], blockedExternalRequests: [],
  limitations: ["Real native Chromium CDP IME composition and native keyboard events in the actual Control UI Browser panel and controller; synthetic Gateway transport records browser.request only.", "No managed remote browser or external page is contacted. No physical Japanese/Chinese keyboard, Safari, or WKWebView is claimed.", "Normal built Control UI acceptance with exact clean source identity and browser-received HTML/entry hashes; not a live authenticated Gateway or managed browser."],
};
let server, browser;
const responseJobs = [];
const started = Date.now();
try {
  assert.ok(["base", "head"].includes(stage));
  assert.equal(receipt.worktreeStatus, "", "Built proof must bind a clean committed checkout");
  const builtDir = path.join(root, "dist/control-ui");
  const index = fs.readFileSync(path.join(builtDir, "index.html"));
  const identity = index.toString("utf8").match(/globalThis\.OPENCLAW_CONTROL_UI_BUILD_INFO=(\{[^<]+\});<\/script>/);
  assert.ok(identity, "Normal built HTML must carry its source identity");
  const buildInfo = JSON.parse(identity[1]);
  assert.equal(buildInfo.commit, receipt.head);
  assert.equal(buildInfo.dirty, false);
  const entryAssets = [...index.toString("utf8").matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => {
    const relative = match[1].replace(/^\.\//, "");
    assert.ok(relative.startsWith("assets/") && relative.endsWith(".js"));
    return { path: `/${relative}`, sha256: sha(fs.readFileSync(path.join(builtDir, relative))) };
  });
  assert.ok(entryAssets.length);
  receipt.build = { ...buildInfo, indexSha256: sha(index), entryAssets, mode: "Existing normal scripts/ui.js build, served unchanged by the official built ControlUiE2e server" };
  receipt.sourceProofHistory = {
    collector: "scout-address-ime-proof.mjs",
    sha256: "dd769ea7e031c25fd4b51f19f56cbabf6075d11856f1e224d1510f4f50b84fa3",
    base: "address-ime-base-enzGQJ/receipt.json",
    sourceGreen: "address-ime-head-0L6R90/receipt.json",
    boundary: "Separate earlier source-server proof; not substituted for this built run",
  };
  server = await startBuiltControlUiE2eServer(builtDir);
  receipt.server = server.baseUrl;
  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  receipt.browser = browser.version();
  for (const scenario of [{ id: "ordinary-enter", key: "Enter", composition: false }, { id: "ordinary-escape", key: "Escape", composition: false }, { id: "ime-enter", key: "Enter", composition: true }, { id: "ime-escape", key: "Escape", composition: true }]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("pageerror", e => receipt.errors.push(e.message));
    page.on("response", response => {
      const pathname = new URL(response.url()).pathname;
      const entry = entryAssets.find(asset => pathname.endsWith(asset.path));
      const document = response.request().resourceType() === "document";
      if (entry || document) responseJobs.push(response.body().then(body => {
        const fingerprint = sha(body);
        assert.equal(fingerprint, document ? receipt.build.indexSha256 : entry.sha256);
        receipt.served.push({ kind: document ? "built-index" : "built-entry", url: response.url(), status: response.status(), sha256: fingerprint });
      }).catch(error => receipt.errors.push(String(error))));
    });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return route.continue();
      receipt.blockedExternalRequests.push(url.origin);
      return route.abort();
    });
    const gateway = await installMockGateway(page, {
      communityInvite: false, terminalEnabled: false,
      serverVersion: buildInfo.version, serverCommit: buildInfo.commit, serverBuiltAt: buildInfo.builtAt, serverBuildId: buildInfo.buildId,
      operatorScopes: ["operator.admin", "operator.read", "operator.write"],
      featureMethods: [...defaultControlUiFeatureMethods, "browser.request"],
      methodResponses: { "browser.request": { running: true, tabs: [] } },
      historyMessages: [{ role: "assistant", content: "Synthetic local Browser address composition verification." }],
    });
    await page.goto(`${server.baseUrl}chat`);
    await waitForControlUiGatewayReady(page);
    assert.deepEqual(await page.evaluate(() => globalThis.OPENCLAW_CONTROL_UI_BUILD_INFO), buildInfo);
    await openChatSidePanelType(page, "Browser");
    const input = page.locator('[data-panel-slot="browser"] .bp-url');
    await input.waitFor({ state: "visible" });
    await input.fill(scenario.composition ? "https://" : "https://ordinary.invalid/path");
    await input.evaluate(element => {
      globalThis.__addressImeEvents = [];
      for (const name of ["compositionstart", "compositionupdate", "compositionend", "keydown", "keyup", "input", "blur", "focus"]) element.addEventListener(name, event => {
        globalThis.__addressImeEvents.push({ type: event.type, key: event.key, keyCode: event.keyCode, isComposing: event.isComposing, isTrusted: event.isTrusted, defaultPrevented: event.defaultPrevented, data: event.data, value: element.value, focused: document.activeElement === element });
      }, true);
    });
    const cdp = await context.newCDPSession(page);
    if (scenario.composition) await cdp.send("Input.imeSetComposition", { text: "れい", selectionStart: 2, selectionEnd: 2 });
    const read = () => input.evaluate(element => ({ value: element.value, title: element.title, mirror: element.closest(".bp-toolbar-address").querySelector(".bp-toolbar-address-text").textContent, focused: document.activeElement === element, events: [...globalThis.__addressImeEvents] }));
    const before = await read();
    const initial = await gateway.getRequests("browser.request");
    assert.equal(before.focused, true);
    assert.equal(before.value, scenario.composition ? "https://れい" : "https://ordinary.invalid/path");
    if (scenario.composition) assert.ok(before.events.some(event => event.type === "compositionstart" && event.isTrusted));
    await page.keyboard.down(scenario.key);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const afterKeydown = await read();
    const requests = (await gateway.getRequests("browser.request")).slice(initial.length);
    const navigation = requests.filter(request => request.params?.method === "POST" && ["/tabs/open", "/navigate"].includes(request.params?.path));
    const nativeKey = afterKeydown.events.find(event => event.type === "keydown" && event.key === scenario.key);
    assert.ok(nativeKey?.isTrusted, "Proof must use native keyboard events");
    if (scenario.composition) assert.equal(nativeKey.isComposing, true, "Native key must reach the field inside an actual CDP composition");
    const observation = { ...scenario, before, afterKeydown, requests, navigation, nativeKey };
    if (scenario.composition) {
      observation.expected = "No navigation, no UI reset, same focused field and draft while IME owns the key";
      observation.acceptance = navigation.length === 0 && afterKeydown.focused && afterKeydown.value === before.value && afterKeydown.mirror === before.mirror;
      if (scenario.key === "Enter" && observation.acceptance) {
        await cdp.send("Input.insertText", { text: "例え" });
        await page.keyboard.up("Enter");
        await cdp.send("Input.insertText", { text: ".invalid/path" });
        await page.keyboard.press("Enter");
        await gateway.waitForRequest("browser.request", { match: { method: "POST", path: "/tabs/open" }, after: 0 });
        observation.confirmedNavigation = (await gateway.getRequests("browser.request")).filter(request => request.params?.path === "/tabs/open");
        assert.equal(observation.confirmedNavigation.length, 1);
        assert.equal(observation.confirmedNavigation[0].params.body.url, new URL("https://例え.invalid/path").toString());
      } else {
        await page.keyboard.up(scenario.key);
      }
    } else {
      await page.keyboard.up(scenario.key);
      if (scenario.key === "Enter") {
        assert.equal(navigation.length, 1);
        assert.equal(navigation[0].params.body.url, "https://ordinary.invalid/path");
        assert.equal(afterKeydown.focused, false);
      } else {
        assert.equal(navigation.length, 0);
        assert.equal(afterKeydown.value, "");
        assert.equal(afterKeydown.focused, false);
      }
      observation.control = "PASS";
    }
    receipt.cases.push(observation);
    fs.writeFileSync(path.join(out, `${scenario.id}.png`), await page.screenshot({ animations: "disabled", caret: "hide" }));
    await cdp.detach();
    await context.close();
  }
  await Promise.all(responseJobs);
  assert.equal(receipt.served.filter(item => item.kind === "built-index").length, receipt.cases.length);
  for (const asset of entryAssets) assert.equal(receipt.served.filter(item => item.kind === "built-entry" && item.sha256 === asset.sha256).length, receipt.cases.length);
  assert.equal(git("status", "--porcelain"), "");
  assert.equal(receipt.errors.length, 0);
  const imeCases = receipt.cases.filter(row => row.composition);
  receipt.result = imeCases.every(row => row.acceptance) ? "GREEN" : "RED";
  if (stage === "base") assert.equal(receipt.result, "RED");
  if (stage === "head") assert.equal(receipt.result, "GREEN");
} catch (error) {
  receipt.result = "BLOCKED";
  receipt.failure = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  receipt.elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ result: receipt.result, output: out, elapsedMs: receipt.elapsedMs, failure: receipt.failure }));
}
