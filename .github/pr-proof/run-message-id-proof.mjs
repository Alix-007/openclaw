import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [root, sha, receipts, mode = 'parent'] = process.argv.slice(2);
assert(root && /^[a-f0-9]{40}$/.test(sha ?? '') && receipts);
assert(['parent', 'product'].includes(mode), `unsupported expectation mode: ${mode}`);
const fixture = await mkdtemp(path.join(tmpdir(), 'message-id-proof-'));
await mkdir(receipts, { recursive: true });
const receiptDir = mode === 'parent' ? receipts : path.join(receipts, mode);
await mkdir(receiptDir, { recursive: true });
// Credential allowlist; keep the inherited runner HOME unchanged. All product
// state/config paths point at this disposable fixture and contain no accounts.
const env = { PATH: process.env.PATH, CI: 'true', NO_COLOR: '1',
  OPENCLAW_STATE_DIR: path.join(fixture, 'state'), OPENCLAW_CONFIG_PATH: path.join(fixture, 'openclaw.json') };
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const token = 'isolated-message-id-proof-only';
await writeFile(env.OPENCLAW_CONFIG_PATH, JSON.stringify({
  gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } },
  cron: { enabled: false }, plugins: { enabled: false },
}));
const cli = [path.join(root, 'openclaw.mjs')];
const transport = ['--url', `ws://127.0.0.1:${port}`, '--token', token];
const seed = [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', path.join(root, 'tsconfig.json'),
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'message-id-seed.mjs'), root];
let gateway;
async function run(label, args, quiet = false) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  if (!quiet) await writeFile(path.join(receiptDir, `${label}.json`), JSON.stringify(result, null, 2));
  return result;
}
function json(result) { assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout); }
try {
  const before = json(await run('sqlite-before', seed));
  gateway = spawn(process.execPath, [...cli, 'gateway', 'run', '--allow-unconfigured'],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  gateway.stdout.pipe(createWriteStream(path.join(receiptDir, 'gateway.stdout')));
  gateway.stderr.pipe(createWriteStream(path.join(receiptDir, 'gateway.stderr')));
  let launchError;
  gateway.on('error', (error) => { launchError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = await run('ready', [...cli, 'gateway', 'call', 'health', '--json', ...transport], true);
    if (probe.code === 0) { ready = true; break; }
    if (launchError || gateway.exitCode !== null) throw launchError ?? new Error('Gateway exited before readiness');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(ready, 'Gateway readiness failed; setup failure is never parent-red');
  const observations = [];
  for (const entry of before) {
    const result = json(await run(`history-${entry.name}`, [...cli, 'gateway', 'call', 'chat.history',
      '--params', JSON.stringify({ sessionKey: entry.sessionKey, limit: 10, offset: 0 }), '--json', ...transport]));
    assert.equal(result.messages.length, 1, `${entry.name}: exactly one visible message`);
    const message = result.messages[0];
    const text = typeof message.content === 'string' ? message.content :
      message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    const expectedProduct = entry.expected ?? entry.text;
    observations.push({ name: entry.name, rawText: entry.text, expectedProduct, observed: text,
      productBytesPreserved: text === expectedProduct });
    await writeFile(path.join(receiptDir, 'observations.json'), JSON.stringify(observations, null, 2));
    const expected = mode === 'parent' ? entry.red ?? expectedProduct : expectedProduct;
    assert.equal(text, expected, `${entry.name}: precise ${mode} behavior`);
  }
  const productViolations = observations.filter((entry) => !entry.productBytesPreserved).length;
  assert.equal(productViolations, mode === 'parent' ? 3 : 0);
  const after = json(await run('sqlite-after', [...seed, 'readback']));
  assert.deepEqual(after, before, 'history reads must not modify raw transcript bytes');
  await writeFile(path.join(receiptDir, 'SUMMARY.json'), JSON.stringify({ sha, mode,
    realGateway: true, cases: before.length, expectedViolations: mode === 'parent' ? 3 : 0,
    observedViolations: productViolations, controlsPassed: true,
    scope: 'Canonical seeded transcript -> real chat.history RPC -> raw SQLite readback; no provider or live Feishu send.' }, null, 2));
} catch (error) {
  console.error(error);
  console.error('[message-id-proof] FAILED (exit 1)');
  process.exitCode = 1;
} finally {
  if (gateway && gateway.exitCode === null) {
    gateway.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => gateway.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (gateway.exitCode === null) gateway.kill('SIGKILL');
  }
}
