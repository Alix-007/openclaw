import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Socket } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Reuses the prior OpenRouter proof boundary: real guarded HTTP, a proxy
// that never forwards externally, and the actual capture SQLite recorder.
const receiptDir = process.env.PROOF_RECEIPT_DIR!;
const mode = process.env.EXPECTATION_MODE;
assert(receiptDir && (mode === 'parent' || mode === 'product'));
await mkdir(receiptDir, { recursive: true });
const sockets = new Set<Socket>();
const requests: object[] = [];
const failures: string[] = [];
const observations: object[] = [];
let scenario = 'success';
let closeCaptureStore: (() => void) | undefined;
let closedAt = 0;
const server = createServer((req, res) => {
  try {
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.host, 'clawrouter.example');
    assert.equal(new URL(req.url!, 'http://clawrouter.example').pathname, '/v1/usage');
    requests.push({ scenario, method: req.method, path: '/v1/usage' });
    res.once('close', () => { closedAt = performance.now(); });
    res.writeHead(scenario === 'success' ? 200 : 503, { 'content-type': 'application/json' });
    const payload = scenario === 'success'
      ? { budget: { configured: false }, usage: { summary: { requestCount: 3, totalTokens: 9, actualCostMicros: 0 } } }
      : { error: 'fixture unavailable' };
    if (scenario === 'delayed-error') {
      res.write(JSON.stringify(payload));
      const timer = setTimeout(() => res.end(), 3000);
      res.once('close', () => clearTimeout(timer));
    } else res.end(JSON.stringify(payload));
  } catch (error) { failures.push(String(error)); res.destroy(); }
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
server.on('connect', (req, socket, head) => {
  if (req.url !== 'clawrouter.example:80') {
    failures.push('Unexpected proxy destination'); socket.destroy(); return;
  }
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head.length) socket.unshift(head);
  server.emit('connection', socket);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
process.env.HTTP_PROXY = `http://127.0.0.1:${address.port}`;
process.env.HTTPS_PROXY = process.env.HTTP_PROXY;
process.env.NO_PROXY = '';
for (const key of ['http_proxy', 'https_proxy', 'no_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[key];
try {
  const root = process.cwd();
  const { fetchClawRouterUsage } = await import(pathToFileURL(path.join(root, 'extensions/clawrouter/usage.ts')).href);
  const { getDebugProxyCaptureStore, closeDebugProxyCaptureStore } = await import(pathToFileURL(path.join(root, 'src/proxy-capture/store.sqlite.ts')).href);
  closeCaptureStore = closeDebugProxyCaptureStore;
  for (const [name, capture] of [['success', true], ['error-eof', true], ['delayed-error', false], ['delayed-error', true]] as const) {
    scenario = name;
    closedAt = 0;
    const sessionId = `clawrouter-cleanup-${name}-${capture}`;
    process.env.OPENCLAW_DEBUG_PROXY_ENABLED = capture ? '1' : '0';
    process.env.OPENCLAW_DEBUG_PROXY_SESSION_ID = sessionId;
    const start = performance.now();
    let snapshot: unknown;
    let errorText: string | undefined;
    try {
      snapshot = await fetchClawRouterUsage({ token: 'fixture-not-a-secret', baseUrl: 'http://clawrouter.example/v1', timeoutMs: 8000 });
    } catch (error) { errorText = error instanceof Error ? error.message : String(error); }
    const elapsedMs = Math.round(performance.now() - start);
    let events = getDebugProxyCaptureStore().getSessionEvents(sessionId);
    for (let attempt = 0; attempt < 45 && (!closedAt || (capture && !events.some((e) => e.kind === 'response' || e.kind === 'error'))); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      events = getDebugProxyCaptureStore().getSessionEvents(sessionId);
    }
    const captureEvents = events.map(({ kind, status, flowId, errorText }) => ({ kind, status, flowId, errorText }));
    observations.push({ name, capture, sessionId, elapsedMs, closedMs: closedAt ? Math.round(closedAt - start) : null, snapshot, errorText, captureEvents });
    if (name === 'success') {
      assert.equal(errorText, undefined);
      assert.deepEqual(snapshot, { provider: 'clawrouter', displayName: 'ClawRouter', windows: [], billing: [{ type: 'spend', amount: 0, unit: 'USD' }], summary: '3 requests · 9 tokens · $0.00 used', plan: 'Unmetered proxy key' });
    } else assert.equal(errorText, 'ClawRouter usage request failed (HTTP 503)');
    if (capture) {
      const request = events.filter((e) => e.kind === 'request');
      const terminal = events.filter((e) => e.kind === 'response' || e.kind === 'error');
      assert.equal(request.length, 1); assert.equal(terminal.length, 1);
      assert.equal(request[0].flowId, terminal[0].flowId);
      if (terminal[0].kind === 'error') {
        assert(mode === 'product' && name !== 'success');
        assert(['This operation was aborted', 'The operation was aborted.'].includes(terminal[0].errorText));
      } else assert.equal(terminal[0].status, name === 'success' ? 200 : 503);
    } else assert.equal(events.length, 0);
    assert(closedAt > 0, 'fixture response close must be observed');
    if (mode === 'parent' && name === 'delayed-error' && capture) assert(elapsedMs >= 2500);
    else { assert(elapsedMs < 2000); assert(closedAt - start < 2000); }
  }
  assert.deepEqual(failures, []); assert.equal(requests.length, 4);
} catch (error) {
  failures.push(String(error)); console.error('[clawrouter-proof] FAILED (exit 1)'); process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeCaptureStore?.();
  const receipt = { productSha: process.env.PRODUCT_SHA, mode, observations, requests, failures, cleanup: { serverClosed: true }, limitations: 'Real local HTTP transport and capture SQLite; no authenticated ClawRouter service or live channel.' };
  await writeFile(path.join(receiptDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}
