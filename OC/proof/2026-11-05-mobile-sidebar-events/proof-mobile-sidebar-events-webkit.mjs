import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {withIsolatedGateway} from './isolated-gateway.mjs';

const [checkoutArg, outArg, expected] = process.argv.slice(2);
const checkout = path.resolve(checkoutArg), out = path.resolve(outArg);
assert.ok(['base', 'head'].includes(expected));
const {webkit} = createRequire(path.join(checkout, 'ui/package.json'))('playwright');
const executablePath = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH;
assert.ok(executablePath, 'Set an installed WebKit executable path');
const original = 'Alpha one\nBeta two\nAlpha three\n';
await withIsolatedGateway(checkout, out, async ({config}) => {
  config.plugins = {allow: [], slots: {memory: 'none'}};
  fs.writeFileSync(path.join(config.agents.defaults.workspace, 'notes.txt'), original);
}, async ({config, record, rpc, save}) => {
  let browser, context, page;
  record.entry = 'Normally built isolated Gateway -> persisted session assistant file link -> actual responsive Control UI file Find -> native WebKit editable focus and keyboard Escape';
  record.scope = 'Complete mobile-host Portal event routing: editable focus autoexpansion and child-first Escape dismissal; no app-state injection, synthetic DOM keyboard events, external models/channels, or UI file writes';
  record.limitations = 'Responsive Linux Playwright WebKit only, not physical iOS/macOS Safari. Native IME composition is NOT exercised in WebKit because it has no Chromium CDP imeSetComposition API; the separate unchanged Chromium collector owns the trusted composition control. No external provider/channel/production service claim';
  record.composition = {status: 'NOT_TESTED', reason: 'WebKit does not expose Chromium CDP Input.imeSetComposition; no synthetic composition substitute'};
  record.cases = []; record.pageErrors = [];
  const key = 'agent:main:mobile-webkit-proof';
  try {
    await rpc('sessions.create', {key, agentId: 'main', cwd: config.agents.defaults.workspace, worktree: false});
    await rpc('chat.inject', {sessionKey: key, message: 'Synthetic mobile file Find proof. [Open notes](./notes.txt)'});
    record.historyBefore = await rpc('chat.history', {sessionKey: key, limit: 10});
    record.fileBefore = await rpc('sessions.files.get', {agentId: 'main', path: './notes.txt', sessionKey: key});
    assert.equal(record.fileBefore.file.content, original);
    save();
    record.stage = 'launch-WebKit';
    save();
    browser = await webkit.launch({headless: true, executablePath});
    context = await browser.newContext({viewport: {width: 400, height: 850}, locale: 'en-US'});
    page = await context.newPage(); page.setDefaultTimeout(30000);
    record.stage = 'real-Gateway-WebKit-user-scene';
    record.browser = {engine: 'WebKit', version: browser.version(), viewport: {width: 400, height: 850}};
    page.on('pageerror', error => record.pageErrors.push(String(error).replaceAll(config.gateway.auth.token, '[ephemeral token]')));
    await page.addInitScript(() => {
      // Observe native events only. Do not alter event propagation, defaults, or application state.
      window.__mobileSidebarObserved = [];
      for (const type of ['keydown', 'focusin']) {
        document.addEventListener(type, event => {
          const entry = {type: event.type, key: event.key, code: event.code, keyCode: event.keyCode, isComposing: event.isComposing, isTrusted: event.isTrusted, data: event.data, targetClass: event.target?.className, defaultPrevented: event.defaultPrevented, bubbles: event.bubbles, composed: event.composed, path: event.composedPath().map(node => node.nodeName ? String(node.nodeName) + (node.className && typeof node.className === 'string' ? '.' + node.className : '') : node.constructor.name)};
          window.__mobileSidebarObserved.push(entry);
          setTimeout(() => { entry.defaultPreventedAfterDispatch = event.defaultPrevented; }, 0);
        }, true);
      }
    });
    const origin = record.domain.replace('ws:', 'http:');
    await page.goto(origin + '/chat/main/mobile-webkit-proof#token=' + encodeURIComponent(config.gateway.auth.token));
    const fileLink = page.locator('.chat-thread a[data-file-path="./notes.txt"]');
    await fileLink.waitFor({timeout: 60000});
    const entryPath = await page.locator('script[src]').evaluateAll(xs => xs.map(x => x.getAttribute('src')).find(x => x.includes('/assets/index-')));
    const asset = await page.request.get(origin + entryPath);
    record.servedEntry = {path: entryPath, status: asset.status(), sha256: createHash('sha256').update(await asset.body()).digest('hex')};
    assert.equal(asset.status(), 200);
    const host = page.locator('.chat-mobile-host:visible');
    const fileView = page.locator('.sidebar-file-view:visible');
    const query = page.locator('.sidebar-file-mobile__query:visible');
    async function openFind() {
      if (!await fileView.count()) await fileLink.click();
      await fileView.waitFor();
      await page.getByRole('button', {name: 'Search in file', exact: true}).click();
      await query.waitFor();
      await query.click();
      assert.equal(await query.evaluate(node => document.activeElement === node), true);
    }
    const snapshot = () => page.evaluate(() => ({
      hosts: [...document.querySelectorAll('.chat-mobile-host')].map(node => ({hidden: node.hidden, inert: node.inert, mode: node.dataset.mode, mobilePage: node.dataset.mobilePage, open: node.closest('.sidebar-region')?.hasAttribute('data-mobile-open')})),
      finds: [...document.querySelectorAll('.sidebar-file-mobile__query')].map(node => ({value: node.value, connected: node.isConnected, active: document.activeElement === node, closestHost: Boolean(node.closest('.chat-mobile-host')), ancestors: [...(function*(n){ for (let x=n; x; x=x.parentElement) yield x; })(node)].map(x => x.tagName + '.' + x.className)})),
      fileViews: [...document.querySelectorAll('.sidebar-file-view')].map(node => ({text: node.innerText, rect: {width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height}})),
      active: {tag: document.activeElement?.tagName, class: document.activeElement?.className},
      tooltips: [...document.querySelectorAll('openclaw-tooltip')].map(node => ({content: node.content, active: Boolean(node.shadowRoot?.querySelector('[role=tooltip]:popover-open'))})).filter(x => x.active),
      events: window.__mobileSidebarObserved,
    }));
    await fileLink.click();
    await fileView.waitFor();
    record.beforeFind = await snapshot();
    assert.equal(record.beforeFind.hosts[0].mode, 'dock');
    await page.screenshot({path: path.join(out, 'before-Find-focus.png')});
    await openFind();
    await page.waitForTimeout(150);
    record.afterFindFocus = await snapshot();
    await page.screenshot({path: path.join(out, 'after-Find-focus.png')});
    assert.equal(record.afterFindFocus.finds[0].active, true);
    const expectedMode = expected === 'base' ? 'dock' : 'expanded';
    assert.equal(record.afterFindFocus.hosts[0].mode, expectedMode);
    record.cases.push({label: 'editable-Find-focus-through-Portal', activeInput: true, hostMode: record.afterFindFocus.hosts[0].mode, expectedHostMode: expectedMode, operatorExpectedHostMode: 'expanded'});
    save();
    await query.fill('Alpha');
    await query.press('Escape');
    await page.waitForTimeout(100);
    const afterFindEscape = await snapshot();
    record.afterFindEscape = afterFindEscape;
    const ordinaryFirst = afterFindEscape.events.filter(event => event.type === 'keydown' && event.key === 'Escape').at(-1);
    assert.equal(ordinaryFirst.isTrusted, true); assert.equal(ordinaryFirst.isComposing, false);
    assert.equal(await query.count(), 0);
    assert.equal(await host.count(), 1);
    record.cases.push({label: 'ordinary-Escape-closes-Find-only', event: ordinaryFirst, hostVisible: true, findVisible: false});
    save();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    record.afterReturnedFocusEscape = await snapshot();
    const returnedFocusEscape = record.afterReturnedFocusEscape.events.filter(event => event.type === 'keydown' && event.key === 'Escape').at(-1);
    record.cases.push({label: 'ordinary-Escape-at-returned-toggle-may-dismiss-tooltip', event: returnedFocusEscape, hostVisible: await host.count() > 0, tooltips: record.afterReturnedFocusEscape.tooltips});
    save();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const afterHostEscape = await snapshot();
    const ordinarySecond = afterHostEscape.events.filter(event => event.type === 'keydown' && event.key === 'Escape').at(-1);
    if (expected === 'base') assert.equal(ordinarySecond.defaultPreventedAfterDispatch, false, 'BASE dismissal RED must use an unconsumed Escape after tooltip dismissal');
    assert.equal(ordinarySecond.isTrusted, true); assert.equal(ordinarySecond.isComposing, false);
    const afterHostVisible = await host.count() > 0;
    assert.equal(afterHostVisible, expected === 'base', 'Unconsumed ordinary Escape must close host on head; base reproduces Portal bypass');
    record.cases.push({label: 'ordinary-Escape-after-tooltip-dismissal', event: ordinarySecond, hostVisible: afterHostVisible, expectedHostVisible: expected === 'base', operatorExpectedHostVisible: false});
    record.afterControls = afterHostEscape;
    await page.screenshot({path: path.join(out, 'after-ordinary-Escape-controls.png')});
    record.fileAfter = await rpc('sessions.files.get', {agentId: 'main', path: './notes.txt', sessionKey: key});
    assert.equal(record.fileAfter.file.content, original);
    record.historyAfter = await rpc('chat.history', {sessionKey: key, limit: 10});
    record.fixtureUnchanged = fs.readFileSync(path.join(config.agents.defaults.workspace, 'notes.txt'), 'utf8') === original;
    assert.equal(record.fixtureUnchanged, true);
    record.observation = expected === 'base' ? 'ACCEPTANCE RED: native editable focus through the Portal leaves the mobile host docked, and unconsumed ordinary Escape after returned Find-toggle tooltip dismissal leaves the host open. Ordinary Find Escape remains child-first and tooltip consumption is recorded; native IME is explicitly untested on WebKit; Gateway and disk file readbacks unchanged.' : 'ACCEPTANCE GREEN: native editable focus through the Portal expands the mobile host, and unconsumed ordinary Escape after returned Find-toggle tooltip dismissal closes it. Ordinary Find Escape remains child-first and tooltip consumption is recorded; native IME is explicitly untested on WebKit; Gateway and disk file readbacks unchanged.';
    record.proofStatus = 'PASS';
    record.sourceReadback = Object.fromEntries(['ui/src/pages/chat/chat-pane-sidebar-view.tsx','ui/src/pages/chat/components/chat-sidebar-region.runtime.tsx','ui/src/pages/chat/components/chat-sidebar-file-mobile.tsx'].map(relative => [relative, {sha256: createHash('sha256').update(fs.readFileSync(path.join(checkout, relative))).digest('hex')} ]));
    save();
  } catch (error) {
    record.proofStatus = browser ? 'FAIL' : 'BLOCKED';
    if (page) {
      await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
      fs.writeFileSync(path.join(out, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''));
      record.finalEvents = await page.evaluate(() => window.__mobileSidebarObserved ?? []).catch(() => []);
    }
    throw new Error(String(error).replaceAll(config.gateway.auth.token, '[ephemeral token]'));
  } finally { await context?.close(); await browser?.close(); }
});
