import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { prepare } from './native-cli.mjs';

const p = prepare(process.argv[2], process.argv[3]);
assert.equal(p.receipt.sha, 'd928e37739e672f7802475db462856b4740d495b');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const sourceFiles = [
  'src/cli/plugins-cli.ts',
  'src/cli/plugins-search-command.ts',
  'src/plugins/catalog-search.ts',
  'src/infra/clawhub-packages.ts',
  'src/infra/clawhub-client.ts',
  'src/infra/clawhub-retry.ts',
  'src/cli/plugins-search-command.clawhub.e2e.test.ts',
];
const sources = () => Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(p.checkout, file)))]));
const sourceBefore = sources();
const configBefore = sha(fs.readFileSync(p.configPath));
const base = 'd4ae77eae296fd8eb1f90f7a4ebb5d77fa2e6ad9';
const productionDelta = execFileSync('git', ['diff', '--name-only', base, p.receipt.sha, '--', ...sourceFiles.slice(0, -1)], { cwd: p.checkout, encoding: 'utf8' }).trim();
assert.equal(productionDelta, '');
p.receipt.sourceBase = base;
p.receipt.node = process.version;
p.receipt.collector = { file: path.basename(import.meta.filename), sha256: sha(fs.readFileSync(import.meta.filename)) };
p.receipt.sourceHashesBefore = sourceBefore;
p.receipt.productionFilesUnchangedFromBase = true;
p.receipt.buildInfo = JSON.parse(fs.readFileSync(path.join(p.checkout, 'dist/build-info.json')));
p.receipt.runtimePostbuild = JSON.parse(fs.readFileSync(path.join(p.checkout, 'dist/.runtime-postbuildstamp')));
p.receipt.entry = { path: 'openclaw.mjs', sha256: sha(fs.readFileSync(path.join(p.checkout, 'openclaw.mjs'))) };
p.receipt.boundary = 'Registered shipped CLI subprocess -> catalog/package client -> actual loopback HTTP -> real process stdout/stderr and exit status';
p.receipt.comparison = 'Same exact-head product binary in every cell; only the external terminal-error fixture adds Retry-After: 61. Production code is unchanged by this test-only PR.';
p.save();

let active;
const sockets = new Set();
const server = http.createServer((req, res) => {
  const atMs = performance.now();
  const url = new URL(req.url, 'http://127.0.0.1');
  const family = url.searchParams.get('family');
  const row = {
    at: new Date().toISOString(),
    msSinceCellStart: Math.round(atMs - active.started),
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: { ...req.headers, ...(req.headers.authorization ? { authorization: '[UNEXPECTED_REDACTED]' } : {}) },
    authorizationPresent: Boolean(req.headers.authorization),
    closed: false,
    finished: false,
  };
  active.requests.push(row);
  const expected = req.method === 'GET' && url.pathname === '/api/v1/packages/search'
    && ['code-plugin', 'bundle-plugin'].includes(family)
    && url.searchParams.get('q') === active.query;
  if (!expected) active.unexpectedRequests++;
  const status = expected ? active.status : 404;
  const headers = { 'content-type': 'application/json', ...(expected && active.retryAfter ? { 'retry-after': active.retryAfter } : {}) };
  const body = status === 503 ? { error: 'catalog unavailable' } : status === 200 ? {
    results: [{
      score: family === 'bundle-plugin' ? 12 : 4,
      package: { name: '@acme/calendar', family, channel: 'official', isOfficial: true },
    }],
  } : { error: 'unexpected synthetic route' };
  row.response = { status, headers, body };
  req.once('close', () => { row.closed = true; row.closedAt = new Date().toISOString(); });
  res.once('finish', () => { row.finished = true; row.finishedAt = new Date().toISOString(); });
  res.writeHead(status, headers).end(JSON.stringify(body));
});
server.on('connection', socket => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const registry = `http://127.0.0.1:${server.address().port}`;
p.receipt.registry = registry;
const overrides = {
  OPENCLAW_CLAWHUB_URL: registry,
  CLAWHUB_CONFIG_PATH: path.join(p.out, 'no-clawhub-config.json'),
  CLAWHUB_DISABLE_TELEMETRY: '1',
};

async function cell(label, status, retryAfter) {
  active = { label, status, retryAfter, query: status === 503 ? 'unavailable' : 'calendar', requests: [], unexpectedRequests: 0, started: performance.now() };
  const result = await p.run(['plugins', 'search', active.query, '--limit', '5'], label, overrides);
  // All product-side requests settle before the process closes; preserve observed
  // recorder events, rather than synthesizing an output or exit through a test runtime.
  result.fixture = { status, retryAfter: retryAfter ?? null, query: active.query };
  result.requests = active.requests;
  result.unexpectedRequests = active.unexpectedRequests;
  result.stdoutSha256 = sha(fs.readFileSync(path.join(p.out, `${label}.stdout.log`)));
  result.stderrSha256 = sha(fs.readFileSync(path.join(p.out, `${label}.stderr.log`)));
  result.requestsByFamily = Object.fromEntries(['code-plugin', 'bundle-plugin'].map(family => [family, active.requests.filter(row => row.query.family === family).length]));
  result.requestGapsMs = Object.fromEntries(['code-plugin', 'bundle-plugin'].map(family => {
    const rows = active.requests.filter(row => row.query.family === family);
    return [family, rows.slice(1).map((row, index) => row.msSinceCellStart - rows[index].msSinceCellStart)];
  }));
  p.save();
  assert.equal(result.exit.signal, null);
  assert.equal(result.exit.code, status === 503 ? 1 : 0);
  assert.equal(result.unexpectedRequests, 0);
  assert.ok(active.requests.every(row => !row.authorizationPresent && row.response.status === status && row.finished));
  if (status === 503) {
    assert.equal(result.stdout.trim(), '');
    assert.match(result.stderr, /catalog unavailable/);
    assert.match(result.stderr, /503/);
    assert.ok(active.requests.every(row => row.response.headers['retry-after'] === retryAfter));
    if (retryAfter) {
      assert.deepEqual(result.requestsByFamily, { 'code-plugin': 1, 'bundle-plugin': 1 });
      assert.ok(result.seconds < 30, 'Terminal hint must finish within the unchanged E2E deadline');
    } else {
      assert.deepEqual(result.requestsByFamily, { 'code-plugin': 5, 'bundle-plugin': 5 });
      assert.ok(result.seconds > 30, 'Original permanent-error fixture must outlast the unchanged E2E deadline');
    }
  } else {
    assert.equal(result.stderr.trim(), '');
    assert.equal((result.stdout.match(/^@acme\/calendar {2}/gm) ?? []).length, 1);
    assert.deepEqual(result.requestsByFamily, { 'code-plugin': 1, 'bundle-plugin': 1 });
    assert.ok(!result.stdout.includes('catalog unavailable'));
  }
  result.assertionsPassed = true;
  p.save();
  return result;
}

try {
  await cell('original-no-retry-hint', 503);
  await cell('terminal-retry-after-61', 503, '61');
  await cell('legal-200-control', 200);
  assert.deepEqual(sources(), sourceBefore);
  assert.equal(sha(fs.readFileSync(p.configPath)), configBefore);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: p.checkout, encoding: 'utf8' }), '');
  p.receipt.sourceHashesAfter = sources();
  p.receipt.configUnchanged = true;
  p.receipt.result = 'PASS_NATIVE_TERMINAL_ERROR_AND_SUCCESS_CONTROL';
  p.receipt.observation = 'The same normally built shipped CLI exits1 with catalog unavailable in both503cells; nohint waits through real backoff beyond30s, Retry-After61 sends exactlyoneGET per family and finishesunder30s. Legal200 exits0 and printsone deduplicated plugin.';
  p.save();
} catch (error) {
  p.receipt.result = 'FAILED_OR_BLOCKED';
  p.receipt.error = String(error);
  p.save();
  throw error;
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  p.receipt.cleanup = { listenerClosed: !server.listening, openSockets: sockets.size, productionServicesTouched: false, modelOrChannelCalls: false, syntheticStateRetained: true };
  p.save();
}
console.log(JSON.stringify({ sha: p.receipt.sha, result: p.receipt.result, cases: p.receipt.cases.map(({ label, exit, seconds, requestsByFamily }) => ({ label, exit, seconds, requestsByFamily })), cleanup: p.receipt.cleanup }, null, 2));
