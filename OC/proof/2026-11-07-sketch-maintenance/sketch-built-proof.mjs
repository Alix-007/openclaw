import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2]);
const parent = path.resolve(process.argv[3]);
const expectedHead = process.argv[4];
const load = p => import(pathToFileURL(path.join(root, p)).href);
const sha = b => createHash('sha256').update(b).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const { chromium } = createRequire(path.join(root, 'ui/package.json'))('playwright');
const { createControlUiE2eArtifactDir } = await load('ui/src/test-helpers/control-ui-e2e-artifacts.ts');
const { startBuiltControlUiE2eServer, installMockGateway, controlUiBundledSettingsStorageKey, resolvePlaywrightChromiumExecutablePath } = await load('ui/src/test-helpers/control-ui-e2e.ts');
const { waitForControlUiGatewayReady } = await load('ui/src/test-helpers/control-ui-e2e-readiness.ts');
const out = createControlUiE2eArtifactDir('sketch-built', parent);
const receipt = {
  at: new Date().toISOString(), head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
  status: git('status', '--porcelain'), collectorSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
  source: {}, served: [], scenes: [], errors: [],
  boundary: 'Normal production-built UI in real Chromium -> visible main/Side attachment menu -> native canvas -> attachment payload -> canonical synthetic Gateway request recorder -> independently decoded PNG.',
  limitations: [
    'Synthetic Gateway transport; no live authenticated Gateway, model execution, channel or external-user delivery.',
    'Chromium only. WebKit is not claimed; separate Sessions WebKit attempt was blocked before tests by missing host libraries.',
    'Retained-menu strict zero-mutation equality and hidden/late Side lifetime have separate focused tests; this built collector does not inject component state or claim those tests as built UI proof.',
    'No private image-only toggle is manufactured. Main permits media/files; the Side rail producer explicitly sets imagesOnly:true. Their distinct visible menus are asserted, and in-place mode changes have a separate owner test.',
    'Existing Draft/product acceptance hold remains; technical success does not accept product placement.',
  ],
};
const save = () => fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
let server, browser, failure;
try {
  assert.equal(receipt.status, '', 'Built proof requires clean exact-head source');
  if (expectedHead) assert.equal(receipt.head, expectedHead, 'Publication target changed');
  const builtDir = path.join(root, 'dist/control-ui');
  const index = fs.readFileSync(path.join(builtDir, 'index.html'));
  const info = index.toString().match(/globalThis\.OPENCLAW_CONTROL_UI_BUILD_INFO=(\{[^<]+\});<\/script>/);
  assert.ok(info, 'Normal build source identity required');
  receipt.build = JSON.parse(info[1]);
  assert.equal(receipt.build.commit, receipt.head);
  assert.equal(receipt.build.dirty, false);
  receipt.indexSha256 = sha(index);
  const entryAssets = [...index.toString().matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1].replace(/^\.\//, '').replace(/^\//, ''));
  assert.ok(entryAssets.length, 'Normal HTML script entries required');
  for (const file of [
    'ui/src/pages/chat/components/chat-composer-plus-menu-body.tsx',
    'ui/src/pages/chat/components/chat-composer-attachment-menu.tsx',
    'ui/src/pages/chat/components/chat-composer-plus-menu-content.tsx',
    'ui/src/pages/chat/components/chat-sketch-dialog.tsx',
    'ui/src/pages/chat/components/chat-sketch.ts',
    'ui/src/pages/chat/components/chat-session-rail.tsx',
  ]) receipt.source[file] = { sha256: sha(fs.readFileSync(path.join(root, file))), blob: git('rev-parse', `HEAD:${file}`) };

  server = await startBuiltControlUiE2eServer(builtDir);
  receipt.domain = server.baseUrl;
  browser = await chromium.launch({ headless: true, executablePath: resolvePlaywrightChromiumExecutablePath(chromium.executablePath()), args: ['--disable-partial-raster', '--disable-gpu-rasterization'] });
  receipt.browser = { engine: 'Chromium', version: browser.version() };
  for (const surface of ['main', 'side']) {
    const scene = { surface, controls: {}, result: 'RUNNING' };
    receipt.scenes.push(scene); save();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
    const pending = [], fetched = new Set();
    try {
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => receipt.errors.push({ surface, message: error.message }));
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin !== new URL(server.baseUrl).origin || !/\/assets\/[^/]+\.(?:js|css)$/u.test(url.pathname)) return;
        const relative = url.pathname.slice(url.pathname.indexOf('/assets/') + 1);
        pending.push(response.body().then(bytes => {
          assert.equal(response.status(), 200, relative);
          const actual = sha(bytes), expected = sha(fs.readFileSync(path.join(builtDir, relative)));
          assert.equal(actual, expected, `Served asset differs from this build: ${relative}`);
          fetched.add(relative); receipt.served.push({ surface, path: relative, status: response.status(), sha256: actual });
        }).catch(error => receipt.errors.push({ surface, asset: relative, message: String(error) })));
      });
      await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ chatSendShortcut: 'enter' })), { key: controlUiBundledSettingsStorageKey(server.baseUrl) });
      const gateway = await installMockGateway(page, {
        communityInvite: false, terminalEnabled: false,
        serverVersion: receipt.build.version, serverCommit: receipt.build.commit, serverBuiltAt: receipt.build.builtAt, serverBuildId: receipt.build.buildId,
        methodResponses: { 'sessions.companion.ask': { answer: 'Synthetic sketch accepted.', ts: 1 }, 'sessions.companion.state': { exchanges: [] } },
      });
      await page.goto(server.baseUrl + 'chat'); await waitForControlUiGatewayReady(page);
      assert.deepEqual(await page.evaluate(() => globalThis.OPENCLAW_CONTROL_UI_BUILD_INFO), receipt.build);
      let scope = page.locator('.agent-chat__composer-shell').filter({ visible: true }).first();
      if (surface === 'side') {
        const pane = page.locator('.chat-pane-cache__pane--active, .chat-split-view__cell--active openclaw-chat-pane.chat-split-view__pane').filter({ visible: true }).first();
        await pane.locator('.sidebar-region__panels-toggle').getByRole('button', { name: 'Panels', exact: true }).click();
        const launcher = pane.locator('.side-panel-launcher'); await launcher.waitFor({ state: 'visible' });
        await launcher.getByRole('button').filter({ has: page.getByText('Side chat', { exact: true }).and(page.locator('.side-panel-type-option__label')) }).click();
        scope = page.locator('openclaw-chat-session-rail').filter({ visible: true });
      }
      const method = surface === 'side' ? 'sessions.companion.ask' : 'chat.send';
      const add = scope.getByRole('button', { name: 'Add attachment', exact: true });
      const open = async () => {
        await add.click();
        const menu = page.locator('.agent-chat__capability-menu-panel:popover-open');
        await menu.getByRole('menuitem', { name: 'Draw a sketch', exact: true }).waitFor();
        scene.menu = await menu.getByRole('menuitem').allTextContents();
        scene.menuIds = await menu.getByRole('menuitem').evaluateAll(rows => rows.map(row => row.getAttribute('data-value')));
        // Side's actual attachmentProps owner sets imagesOnly:true, unlike main.
        const expectedAttachmentIds = surface === 'side' ? ['camera', 'photo', 'sketch'] : ['camera', 'media', 'file', 'sketch'];
        assert.deepEqual(scene.menuIds.filter(id => ['camera', 'photo', 'media', 'file', 'sketch'].includes(id)), expectedAttachmentIds);
        scene.menuPolicy = { imagesOnly: surface === 'side', expectedAttachmentIds };
        await menu.getByRole('menuitem', { name: 'Draw a sketch', exact: true }).click();
        await page.locator('.chat-sketch canvas').waitFor();
        await page.locator('openclaw-modal-dialog').evaluate(async element => {
          await Promise.all(element.getAnimations({ subtree: true }).filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})));
        });
      };
      const stroke = async (a, b) => {
        const box = await page.locator('.chat-sketch canvas').boundingBox(); assert.ok(box && box.width && box.height);
        await page.mouse.move(box.x + box.width * a[0], box.y + box.height * a[1]); await page.mouse.down();
        await page.mouse.move(box.x + box.width * b[0], box.y + box.height * b[1], { steps: 12 }); await page.mouse.up();
      };
      const closed = async () => {
        await page.locator('.chat-sketch').waitFor({ state: 'detached' });
        await page.waitForFunction(element => document.activeElement === element, await add.elementHandle());
      };
      await open(); assert.equal(await page.getByRole('button', { name: 'Attach sketch', exact: true }).isDisabled(), true);
      await page.screenshot({ path: path.join(out, `${surface}-blank.png`), animations: 'disabled', caret: 'hide' });
      await stroke([.2, .25], [.6, .25]); await page.getByRole('button', { name: 'Clear sketch', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Attach sketch', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await closed();
      assert.equal(await scope.locator('.chat-attachment-thumb').count(), 0);
      assert.equal((await gateway.getRequests(method)).length, 0);
      scene.controls.blankClearCancel = 'PASS: no attachment/request, focus restored to Add attachment';
      await open(); await page.keyboard.press('Escape'); await closed();
      scene.controls.escape = 'PASS: native Escape dismisses and restores focus';
      await open(); await stroke([.2, .25], [.6, .25]); await stroke([.2, .7], [.6, .7]);
      await page.getByRole('button', { name: 'Undo stroke', exact: true }).click();
      await page.screenshot({ path: path.join(out, `${surface}-drawn.png`), animations: 'disabled', caret: 'hide' });
      await page.getByRole('button', { name: 'Attach sketch', exact: true }).click();
      await scope.locator('.chat-attachment-thumb img').waitFor();
      assert.equal((await gateway.getRequests(method)).length, 0, 'Attaching must not send automatically');
      const composer = surface === 'side' ? scope.getByRole('textbox', { name: 'Ask in side chat', exact: true }) : scope.locator('textarea');
      await composer.fill('Interpret this synthetic sketch proof.'); await composer.press('Enter');
      const sent = await gateway.waitForRequest(method);
      assert.ok(Array.isArray(sent.params.attachments)); assert.equal(sent.params.attachments.length, 1);
      const attachment = sent.params.attachments[0]; assert.equal(attachment.fileName, 'sketch.png'); assert.equal(attachment.mimeType, 'image/png');
      const bytes = Buffer.from(attachment.content, 'base64');
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      const pixels = await page.evaluate(async content => {
        const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + content)).blob());
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const drawing = canvas.getContext('2d'); if (!drawing) throw new Error('Missing native PNG context');
        drawing.drawImage(image, 0, 0); image.close();
        return { width: canvas.width, height: canvas.height, stroke: [...drawing.getImageData(320, 112, 1, 1).data], undone: [...drawing.getImageData(320, 315, 1, 1).data], background: [...drawing.getImageData(10, 10, 1, 1).data] };
      }, attachment.content);
      assert.deepEqual(pixels, { width: 800, height: 450, stroke: [224, 68, 45, 255], undone: [255, 255, 255, 255], background: [255, 255, 255, 255] });
      fs.writeFileSync(path.join(out, `${surface}-sent-sketch.png`), bytes);
      fs.writeFileSync(path.join(out, `${surface}-request.json`), JSON.stringify(sent, null, 2) + '\n');
      scene.request = { method, fileName: attachment.fileName, mimeType: attachment.mimeType, sha256: sha(bytes), bytes: bytes.length, pixels };
      await page.screenshot({ path: path.join(out, `${surface}-sent.png`), animations: 'disabled', caret: 'hide' });
      await Promise.all(pending);
      for (const entry of entryAssets) assert.ok(fetched.has(entry), `HTML entry was not observed from this build: ${entry}`);
      assert.ok(fetched.size > entryAssets.length, 'Actual lazy interaction assets must be served');
      scene.assetCount = fetched.size; scene.result = 'PASS'; save();
    } finally { await context.close(); }
  }
  assert.deepEqual(receipt.errors, []);
  assert.equal(git('rev-parse', 'HEAD'), receipt.head); assert.equal(git('status', '--porcelain'), '');
  assert.equal(sha(fs.readFileSync(path.join(root, 'dist/control-ui/index.html'))), receipt.indexSha256);
  receipt.result = 'PASS';
} catch (error) { receipt.result = 'BLOCKED'; receipt.error = String(error); failure = error; }
finally {
  receipt.cleanup = { browserClosed: !browser, serverClosed: !server, productionTouched: false, externalMessages: false };
  for (const [key, resource] of [['browserClosed', browser], ['serverClosed', server]]) {
    if (!resource) continue;
    try { await resource.close(); receipt.cleanup[key] = true; }
    catch (error) { receipt.result = 'BLOCKED'; receipt.errors.push({ cleanup: key, message: String(error) }); failure ??= error; }
  }
  save(); console.log(JSON.stringify({ result: receipt.result, head: receipt.head, output: out, scenes: receipt.scenes.map(s => ({ surface: s.surface, result: s.result })) }));
}
if (failure) throw failure;
