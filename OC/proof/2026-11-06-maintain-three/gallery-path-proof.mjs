import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const [checkout, label = 'gallery-base', expected = 'base', entry = 'built', browserMode = 'none'] = process.argv.slice(2);
assert.ok(path.isAbsolute(checkout));
const git = values => execFileSync('git', values, {cwd: checkout, encoding: 'utf8'}).trim();
const head = git(['rev-parse', 'HEAD']);
assert.equal(git(['status', '--porcelain']), '', 'Proof requires a clean checkout');
const buildInfo = JSON.parse(await fs.readFile(path.join(checkout, 'dist/build-info.json'), 'utf8'));
assert.equal(buildInfo.commit, head, 'Runtime build commit must match the checkout HEAD');
const task = path.dirname(new URL(import.meta.url).pathname);
const fixture = await fs.mkdtemp(path.join(task, `${label}-fixture-`));
const repo = path.join(fixture, 'repo');
await fs.mkdir(repo, {recursive: true});
const exact = 'LITERAL ARTIFACT CONTENT\n';
const decoy = 'TRIMMED DECOY CONTENT\n';
const ordinary = 'ORDINARY CONTROL CONTENT\n';
const evidence = (artifact, source = 'fixture.test.ts') => ({
  kind: 'openclaw.qa.evidence-summary', schemaVersion: 2,
  generatedAt: '2026-10-28T15:00:00.000Z', evidenceMode: 'full',
  entries: [{
    test: {kind: 'vitest-test', id: 'literal-path-fixture', title: 'Synthetic path fixture', source: {path: source}},
    coverage: [{id: 'qa.artifact', role: 'primary'}],
    execution: {runner: 'vitest', environment: {ref: 'gallery-path-fixture', os: 'linux', nodeVersion: process.version},
      provider: {id: 'mock-openai', live: false, model: {name: 'mock-openai/gpt-5.6-luna', ref: 'mock-openai/gpt-5.6-luna'}},
      packageSource: {kind: 'source-checkout'}, artifacts: [{kind: 'text', path: artifact, source: 'fixture'}]},
    result: {status: 'pass'},
  }],
});
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
await fs.writeFile(path.join(repo, 'ordinary.log'), ordinary);
await fs.writeFile(path.join(repo, 'captured.log '), exact);
await fs.writeFile(path.join(repo, ' captured.log'), exact);
await fs.writeFile(path.join(repo, 'captured.log'), decoy);
await fs.writeFile(path.join(repo, 'undeclared.log'), 'NOT DECLARED\n');
await writeJson(path.join(repo, 'control.json'), evidence('ordinary.log'));
await writeJson(path.join(repo, 'artifact.json'), evidence('captured.log ', 'fixture.test.ts '));
await writeJson(path.join(repo, 'leading-artifact.json'), evidence(' captured.log'));
await writeJson(path.join(repo, 'evidence.json '), evidence('ordinary.log'));
await writeJson(path.join(repo, 'submitted.json '), evidence('ordinary.log'));
await fs.mkdir(path.join(repo, 'run '));
await writeJson(path.join(repo, 'run ', 'qa-evidence.json'), evidence('../ordinary.log'));
const config = path.join(fixture, 'openclaw.json');
await writeJson(config, {plugins: {allow: []}});
const fixtureHome = path.join(fixture, 'home');
await fs.mkdir(fixtureHome, {recursive: true});
const env = {...process.env, HOME: fixtureHome, OPENCLAW_HOME: fixtureHome,
  OPENCLAW_STATE_DIR: path.join(fixture, 'state'), OPENCLAW_CONFIG_PATH: config,
  OPENCLAW_DISABLE_BUNDLED_PLUGINS: '0', OPENCLAW_NO_RESPAWN: '1',
  OPENCLAW_DEV_SOURCE_ROOT: checkout,
  OPENCLAW_BUILD_PRIVATE_QA: '1', OPENCLAW_ENABLE_PRIVATE_QA_CLI: '1',
  OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_SKIP_GMAIL_WATCHER: '1',
  OPENCLAW_SERVICE_REPAIR_POLICY: 'external', OPENCLAW_DEBUG: '1',
  HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: ''};
const args = [entry === 'source' ? 'scripts/run-node.mjs' : 'openclaw.mjs', 'qa', 'ui', '--repo-root', repo,
  '--host', '127.0.0.1', '--embedded-gateway', 'disabled'];
if (browserMode === 'browser') {
  const uiDistDir = path.join(checkout, 'extensions/qa-lab/web/dist');
  await fs.access(path.join(uiDistDir, 'index.html'));
  args.push('--ui-dist-dir', uiDistDir);
}
const child = spawn(process.execPath, args, {cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe']});
let stdout = '', stderr = '';
const log = await fs.open(path.join(task, label + '-cli.log'), 'w');
child.stdout.on('data', chunk => {stdout += chunk; void log.write(chunk); process.stdout.write(chunk);});
child.stderr.on('data', chunk => {stderr += chunk; void log.write(chunk); process.stderr.write(chunk);});
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
let childDone = false;
void exited.then(() => {childDone = true;});
const start = Date.now();
let baseUrl;
while (!(baseUrl = stdout.match(/QA Lab UI: (http:\/\/[^\s]+)/)?.[1])) {
  assert.ok(!childDone, 'Official QA CLI exited before serving: ' + stderr.slice(-1800));
  assert.ok(Date.now() - start < 8 * 60 * 1000, 'QA preparation/startup exceeded eight minutes');
  await delay(100);
}
const observations = [];
const request = async (name, route, method = 'GET') => {
  const response = await fetch(new URL(route, baseUrl), {method});
  const body = await response.text();
  const result = {name, method, route, status: response.status,
    contentLength: response.headers.get('content-length'), body};
  observations.push(result);
  return result;
};
const endpoint = (name, values) => `/api/${name}?${new URLSearchParams(values)}`;
let result;
try {
  const control = await request('ordinary evidence', endpoint('evidence', {path: 'control.json'}));
  assert.equal(control.status, 200);
  const model = JSON.parse(control.body).evidence;
  assert.equal(model.entries[0].artifacts[0].exists, true);
  assert.equal(model.entries[0].artifacts[0].preview, ordinary);
  const controlGet = await request('ordinary artifact GET', model.entries[0].artifacts[0].href);
  assert.equal(controlGet.status, 200); assert.equal(controlGet.body, ordinary);
  const controlHead = await request('ordinary artifact HEAD', model.entries[0].artifacts[0].href, 'HEAD');
  assert.equal(controlHead.status, 200); assert.equal(Number(controlHead.contentLength), Buffer.byteLength(ordinary));
  assert.equal(controlHead.body, '');
  const file = await request('literal evidence filename', endpoint('evidence', {path: 'evidence.json '}));
  const directory = await request('literal evidence directory', endpoint('evidence', {path: 'run '}));
  const artifact = await request('serialized literal artifact', endpoint('evidence', {path: 'artifact.json'}));
  assert.equal(artifact.status, 200);
  const artifactModel = JSON.parse(artifact.body).evidence;
  const indexedGet = await request('literal artifact indexed GET', artifactModel.entries[0].artifacts[0].href);
  const indexedHead = await request('literal artifact indexed HEAD', artifactModel.entries[0].artifacts[0].href, 'HEAD');
  const directGet = await request('literal artifact direct GET', endpoint('evidence/artifact', {evidencePath: 'artifact.json', artifactPath: 'captured.log '}));
  const directHead = await request('literal evidence direct HEAD', endpoint('evidence/artifact', {evidencePath: 'evidence.json ', artifactPath: 'ordinary.log'}), 'HEAD');
  const blank = await request('blank evidence selector remains rejected', endpoint('evidence/artifact', {evidencePath: ' ', artifactPath: 'ordinary.log'}));
  assert.equal(blank.status, 400);
  const undeclared = await request('undeclared artifact remains rejected', endpoint('evidence/artifact', {evidencePath: 'control.json', artifactPath: 'undeclared.log'}));
  assert.equal(undeclared.status, 403);
  const outside = await request('outside evidence remains rejected', endpoint('evidence', {path: '../openclaw.json'}));
  assert.equal(outside.status, 403);
  const failures = {
    literalEvidenceFilename: file.status !== 200,
    literalEvidenceDirectory: directory.status !== 200,
    serializedArtifactPath: artifactModel.entries[0].artifacts[0].path !== 'captured.log ',
    sourcePath: artifactModel.entries[0].sourcePath !== 'fixture.test.ts ',
    indexedArtifactBytes: indexedGet.body !== exact,
    indexedArtifactLength: Number(indexedHead.contentLength) !== Buffer.byteLength(exact),
    directArtifactBytes: directGet.body !== exact,
    literalEvidenceHead: directHead.status !== 200,
  };
  assert.equal(indexedGet.status, 200); assert.equal(indexedHead.status, 200);
  if (expected === 'base') assert.ok(Object.values(failures).every(Boolean), 'Expected each literal-path regression on frozen base');
  else assert.ok(Object.values(failures).every(value => !value), 'Literal paths must all resolve without changing bytes');
  let browserProof;
  if (browserMode === 'browser') {
    const requireFromCheckout = createRequire(path.join(checkout, 'package.json'));
    const {chromium} = requireFromCheckout('playwright');
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome';
    const browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox']});
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    const network = [];
    const isEvidenceResponse = response => new URL(response.url()).pathname === '/api/evidence';
    const record = async (name, response) => {
      const url = new URL(response.url());
      const body = await response.text();
      const observation = {name, url: response.url(), requestedPath: url.searchParams.get('path'), status: response.status(), body};
      network.push(observation);
      return observation;
    };
    try {
      for (const key of ['path', 'evidencePath']) {
        const pending = page.waitForResponse(isEvidenceResponse);
        await page.goto(new URL(`/evidence?${new URLSearchParams({[key]: 'evidence.json '})}`, baseUrl).href);
        const response = await record(`initial ${key}`, await pending);
        assert.equal(response.requestedPath, expected === 'base' ? 'evidence.json' : 'evidence.json ');
        assert.equal(response.status, expected === 'base' ? 404 : 200);
      }
      const controlPending = page.waitForResponse(isEvidenceResponse);
      await page.goto(new URL('/evidence?path=control.json', baseUrl).href);
      const controlResponse = await record('browser ordinary control', await controlPending);
      assert.equal(controlResponse.status, 200);
      assert.equal(JSON.parse(controlResponse.body).evidence.entries[0].artifacts[0].preview, ordinary);
      await page.locator('.evidence-inspector .evidence-artifact-preview-shell summary').click();
      const controlPreview = page.locator('.evidence-inspector .evidence-artifact-preview');
      const controlPreviewText = await controlPreview.textContent();
      assert.equal(controlPreviewText, ordinary);
      assert.equal(await controlPreview.isVisible(), true);
      await page.waitForFunction(() => !document.querySelector('[data-action="load-evidence"]')?.disabled);
      await page.locator('#evidence-path').fill('submitted.json ');
      const formPending = page.waitForResponse(isEvidenceResponse);
      await page.locator('[data-action="load-evidence"]').click();
      const formResponse = await record('form literal evidence path', await formPending);
      assert.equal(formResponse.requestedPath, expected === 'base' ? 'submitted.json' : 'submitted.json ');
      assert.equal(formResponse.status, expected === 'base' ? 404 : 200);
      await page.waitForFunction(() => !document.querySelector('[data-action="load-evidence"]')?.disabled);
      await page.locator('#evidence-path').fill('artifact.json');
      const artifactPending = page.waitForResponse(isEvidenceResponse);
      await page.locator('[data-action="load-evidence"]').click();
      const artifactResponse = await record('form serialized artifact read', await artifactPending);
      assert.equal(artifactResponse.status, 200);
      const wanted = expected === 'base' ? decoy : exact;
      const trailingArtifact = JSON.parse(artifactResponse.body).evidence.entries[0].artifacts[0];
      const trailingPath = expected === 'base' ? 'captured.log' : 'captured.log ';
      assert.equal(trailingArtifact.path, trailingPath);
      assert.equal(trailingArtifact.mediaKind, expected === 'base' ? 'text' : 'file');
      assert.equal(trailingArtifact.preview, expected === 'base' ? decoy : null);
      await page.waitForFunction(filePath => document.querySelector('.evidence-inspector .evidence-artifact-card footer')?.textContent === filePath, trailingPath);
      const trailingDomPath = await page.locator('.evidence-inspector .evidence-artifact-card footer').first().textContent();
      const trailingPreviewCount = await page.locator('.evidence-inspector .evidence-artifact-preview').count();
      assert.equal(trailingPreviewCount, expected === 'base' ? 1 : 0);
      if (expected === 'head') {
        assert.equal(await page.locator('.evidence-inspector').getByRole('link', {name: 'Open artifact', exact: true}).count(), 1);
      }
      const href = await page.locator('.evidence-inspector a[href^="/api/evidence/artifact"]').first().getAttribute('href');
      assert.ok(href);
      const browserBody = await page.evaluate(async href => {
        const response = await fetch(href);
        return {status: response.status, body: await response.text()};
      }, href);
      assert.equal(browserBody.status, 200); assert.equal(browserBody.body, wanted);
      await page.waitForFunction(() => !document.querySelector('[data-action="load-evidence"]')?.disabled);
      await page.locator('#evidence-path').fill('leading-artifact.json');
      const leadingPending = page.waitForResponse(isEvidenceResponse);
      await page.locator('[data-action="load-evidence"]').click();
      const leadingResponse = await record('form preview-eligible leading artifact', await leadingPending);
      assert.equal(leadingResponse.status, 200);
      const leadingArtifact = JSON.parse(leadingResponse.body).evidence.entries[0].artifacts[0];
      const leadingPath = expected === 'base' ? 'captured.log' : ' captured.log';
      assert.equal(leadingArtifact.path, leadingPath);
      assert.equal(leadingArtifact.mediaKind, 'text');
      assert.equal(leadingArtifact.preview, wanted);
      await page.waitForFunction(filePath => document.querySelector('.evidence-inspector .evidence-artifact-card footer')?.textContent === filePath, leadingPath);
      const leadingDetails = page.locator('.evidence-inspector .evidence-artifact-preview-shell');
      const initialOpen = await leadingDetails.evaluate(el => el.open);
      // The current view preserves disclosure state between evidence loads.
      // Establish a closed state through its real control, then open it.
      if (initialOpen) await leadingDetails.locator('summary').click();
      assert.equal(await leadingDetails.evaluate(el => el.open), false);
      await leadingDetails.locator('summary').click();
      const leadingPreview = page.locator('.evidence-inspector .evidence-artifact-preview');
      assert.equal(await leadingPreview.textContent(), wanted);
      assert.equal(await leadingPreview.isVisible(), true);
      const leadingHref = await page.locator('.evidence-inspector a[href^="/api/evidence/artifact"]').first().getAttribute('href');
      assert.ok(leadingHref);
      const leadingReadback = await page.evaluate(async href => {
        const response = await fetch(href);
        return {status: response.status, body: await response.text()};
      }, leadingHref);
      assert.equal(leadingReadback.status, 200); assert.equal(leadingReadback.body, wanted);
      assert.deepEqual(pageErrors, []);
      browserProof = {outcome: expected === 'base' ? 'BROWSER_RED_CONFIRMED_WITH_CONTROL' : 'BROWSER_GREEN',
        playwright: requireFromCheckout.resolve('playwright'), executablePath, version: browser.version(),
        network, artifactHref: href, artifactReadback: browserBody,
        trailingArtifact: {path: trailingArtifact.path, mediaKind: trailingArtifact.mediaKind,
          preview: trailingArtifact.preview, domPath: trailingDomPath, domPreviewCount: trailingPreviewCount},
        leadingArtifact: {path: leadingArtifact.path, mediaKind: leadingArtifact.mediaKind,
          preview: await leadingPreview.textContent(), previewVisible: await leadingPreview.isVisible(),
          href: leadingHref, readback: leadingReadback},
        controlPreview: controlPreviewText, pageErrors};
    } finally {
      await browser.close();
    }
  }
  result = {at: new Date().toISOString(), expected, outcome: expected === 'base' ? 'RED_CONFIRMED_WITH_CONTROLS' : 'GREEN',
    checkout, head, buildCommit: buildInfo.commit, home: fixtureHome,
    diffHash: createHash('sha256').update(git(['diff', '--binary', 'HEAD'])).digest('hex'),
    command: [process.execPath, ...args], fixture, baseUrl, startupMs: Date.now() - start,
    exact, decoy, ordinary, failures, observations, browserProof};
  await writeJson(path.join(task, label + '-result.json'), result);
  console.log(JSON.stringify({outcome: result.outcome, failures, fixture, receipt: path.join(task, label + '-result.json')}, null, 2));
} finally {
  child.kill('SIGINT');
  const stopped = await Promise.race([exited, delay(5000).then(() => null)]);
  if (!stopped) {child.kill('SIGKILL'); await exited;}
  await log.close();
}
