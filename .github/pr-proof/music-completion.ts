import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Remote, secretless runner only. The local HTTP proxy is also the fixture
// provider: it never forwards requests or opens an external connection.
const root = process.cwd();
const receipt = process.env.PROOF_RECEIPT_DIR!;
assert(receipt);
const mode = process.env.EXPECTATION_MODE ?? 'parent';
assert(['parent', 'product'].includes(mode));
await mkdir(receipt, { recursive: true });
const audio = Buffer.alloc(48);
audio.write('RIFF', 0); audio.writeUInt32LE(40, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
audio.write('data', 36); audio.writeUInt32LE(4, 40);
let scenario = 'eof';
const requests: object[] = [];
const tunnels: string[] = [];
const sockets = new Set<Socket>();
const fixtureErrors: string[] = [];
const server = createServer(async (req, res) => {
  try {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push({ scenario, method: req.method, url: req.url, body });
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.host, 'openrouter.ai');
  assert(['/api/v1/chat/completions', 'http://openrouter.ai/api/v1/chat/completions'].includes(req.url ?? ''));
  assert.equal(body.stream, true);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { audio: { data: audio.toString('base64'), transcript: 'proof' } } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  const timer = setTimeout(() => res.end(), scenario === 'eof' ? 0 : 3000);
  res.once('close', () => clearTimeout(timer));
  } catch (error) {
    fixtureErrors.push(String(error));
    res.destroy(error instanceof Error ? error : undefined);
  }
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
// Undici ProxyAgent tunnels plain HTTP too. Complete CONNECT locally, then
// give the same socket back to the HTTP parser; never dial the requested host.
server.on('connect', (req, socket, head) => {
  if (req.url !== 'openrouter.ai:80') {
    fixtureErrors.push(`unexpected CONNECT target: ${req.url}`);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  tunnels.push(req.url);
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head.length > 0) socket.unshift(head);
  server.emit('connection', socket);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
process.env.HTTP_PROXY = `http://127.0.0.1:${address.port}`;
process.env.HTTPS_PROXY = process.env.HTTP_PROXY;
process.env.NO_PROXY = '';
for (const key of ['http_proxy', 'https_proxy', 'no_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[key];
process.env.OPENCLAW_DEBUG_PROXY_SESSION_ID = 'music-completion-proof';
let closeCaptureStore: (() => void) | undefined;
const observations = [];
try {
  const { buildOpenRouterMusicGenerationProvider } = await import(pathToFileURL(path.join(root, 'extensions/openrouter/music-generation-provider.ts')).href);
  const { getDebugProxyCaptureStore, closeDebugProxyCaptureStore } = await import(pathToFileURL(path.join(root, 'src/proxy-capture/store.sqlite.ts')).href);
  closeCaptureStore = closeDebugProxyCaptureStore;
  for (const [name, capture] of [['eof', true], ['delayed-eof', false], ['delayed-eof', true]] as const) {
    scenario = name;
    process.env.OPENCLAW_DEBUG_PROXY_ENABLED = capture ? '1' : '0';
    const sessionId = `music-completion-proof-${name}-${capture}`;
    process.env.OPENCLAW_DEBUG_PROXY_SESSION_ID = sessionId;
    const started = performance.now();
    const result = await buildOpenRouterMusicGenerationProvider().generateMusic({
      provider: 'openrouter', prompt: 'fixture only', format: 'wav', timeoutMs: 8000,
      cfg: { models: { providers: { openrouter: { baseUrl: 'http://openrouter.ai/api/v1', apiKey: 'fixture-not-a-secret', models: [] } } } },
    });
    const elapsedMs = Math.round(performance.now() - started);
    assert.deepEqual(result.tracks[0].buffer, audio);
    assert.deepEqual(result.lyrics, ['proof']);
    await writeFile(path.join(receipt, `${name}-${capture}.wav`), result.tracks[0].buffer);
    // Awaiting capture here is outside the measured provider operation. Product
    // proof may return before the capture sibling sees fixture EOF.
    let events = getDebugProxyCaptureStore().getSessionEvents(sessionId);
    for (let attempt = 0; capture && !events.some((event) => event.kind === 'response' || event.kind === 'error') && attempt < 45; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      events = getDebugProxyCaptureStore().getSessionEvents(sessionId);
    }
    const captureEvents = events.map(({ kind, status, host, path, dataSha256, errorText }) => ({
      kind, status, host, path, dataSha256,
      ...(typeof errorText === 'string' ? { errorText: errorText.replaceAll('fixture-not-a-secret', '[REDACTED]') } : {}),
    }));
    // Record the full redacted terminal message even if its assertion fails.
    observations.push({ name, capture, elapsedMs, audioBytes: result.tracks[0].buffer.length, captureEvents });
    if (capture) {
      assert(events.some((event) => event.kind === 'request'));
      const terminals = events.filter((event) => event.kind === 'response' || event.kind === 'error');
      assert.equal(terminals.length, 1, 'capture must have exactly one recorded terminal event');
      const terminal = terminals[0];
      if (mode === 'product' && name === 'delayed-eof' && terminal.kind === 'error') {
        // Capture persists Error.message, not Error.name. These exact messages
        // are Node AbortController's default and Undici's AbortError fallback.
        assert(['This operation was aborted', 'The operation was aborted.'].includes(terminal.errorText as string),
          `unexpected capture terminal error: ${terminal.errorText}`);
      } else {
        assert.equal(terminal.kind, 'response');
        assert.equal(terminal.status, 200);
      }
    } else assert.equal(events.length, 0);
  }
  const delayed = observations[2];
  assert(observations[0].elapsedMs < 2000, 'normal EOF control');
  assert(observations[1].elapsedMs < 2000, 'capture-disabled control');
  if (mode === 'parent') assert(delayed.elapsedMs >= 2500, 'parent must exhibit cleanup delay');
  else assert(delayed.elapsedMs < 2000, 'product must finish before fixture EOF');
  assert.deepEqual(fixtureErrors, []);
  assert.equal(requests.length, 3);
  const result = { mode, productSha: process.env.PRODUCT_SHA, entry: 'buildOpenRouterMusicGenerationProvider().generateMusic', observations, requests, tunnels, passed: true, limitations: 'Loopback fixture through supported HTTP_PROXY; no real OpenRouter inference or channels. Actual provider, guarded fetch, capture tee and audio readback; no production mocks.' };
  await writeFile(path.join(receipt, 'receipt.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(path.join(receipt, 'failure.json'), JSON.stringify({ mode, observations, requests, tunnels, fixtureErrors, error: String(error) }, null, 2));
  console.error(error);
  console.error('[music-completion-proof] FAILED (exit 1)');
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeCaptureStore?.();
}
