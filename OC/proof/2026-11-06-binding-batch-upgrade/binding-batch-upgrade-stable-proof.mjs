import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepare} from './native-cli.mjs';
const [checkout, packageArg, out] = process.argv.slice(2);
const stablePackage = path.resolve(packageArg);
const stable = JSON.parse(fs.readFileSync(path.join(stablePackage, 'package.json'), 'utf8'));
assert.equal(stable.name, 'openclaw');
assert.equal(stable.version, '2026.11.1');
const f = prepare(checkout, out);
try {
  const args = [path.join(stablePackage, 'openclaw.mjs'), 'agents', 'bind', '--agent', 'main', '--bind', 'discord:legacy', '--json'];
  const seeded = spawnSync(process.execPath, args, {cwd: stablePackage, env: f.env, encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024});
  fs.writeFileSync(path.join(f.out, 'stable-seed.stdout.log'), seeded.stdout ?? '');
  fs.writeFileSync(path.join(f.out, 'stable-seed.stderr.log'), seeded.stderr ?? '');
  f.receipt.stableSeed = {version: stable.version, command: [process.execPath, ...args], exitCode: seeded.status, signal: seeded.signal, stdout: seeded.stdout, stderr: seeded.stderr}; f.save();
  assert.equal(seeded.error, undefined, 'Released CLI setup failure is not product proof');
  assert.equal(seeded.status, 0, seeded.stderr); assert.equal(seeded.signal, null);
  const before = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
  const existing = {type: 'route', agentId: 'main', match: {channel: 'discord', accountId: 'legacy'}};
  assert.deepEqual(before.bindings, [existing]);
  assert.equal(before.meta.lastTouchedVersion, stable.version);
  f.receipt.releasedReadback = before; f.save();
  const bound = await f.run(['agents', 'bind', '--agent', 'main', '--bind', 'telegram', '--bind', 'telegram:ops', '--json'], 'candidate-bind');
  assert.deepEqual(bound.exit, {code: 0, signal: null}, bound.stderr);
  assert.deepEqual(JSON.parse(bound.stdout).added, ['telegram accountId=ops']);
  const desired = [existing, {type: 'route', agentId: 'main', match: {channel: 'telegram', accountId: 'ops'}}];
  const after = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
  assert.deepEqual(after.bindings, desired);
  // The current config metadata owner stamps these exact migrations.
  // No user-authored field or unknown metadata is excluded from equality.
  const expectedConfig = {...before, bindings: desired, meta: {...before.meta,
    migrations: {...before.meta.migrations, skillWorkshopPlugin: true, skillLibraryToolSplit: true}}};
  assert.deepEqual(after, expectedConfig);
  assert.equal(after.meta.lastTouchedVersion, stable.version);
  assert.equal(Object.hasOwn(after.meta, 'lastTouchedAt'), false);
  const listed = await f.run(['agents', 'bindings', '--agent', 'main', '--json'], 'candidate-readback');
  assert.deepEqual(listed.exit, {code: 0, signal: null}, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).map(x => ({agentId: x.agentId, match: x.match})), desired.map(x => ({agentId: x.agentId, match: x.match})));
  f.receipt.candidateReadback = after;
  f.receipt.observation = 'Published 2026.11.1 CLI created the existing binding and config metadata. The candidate loaded it, added only the requested scoped Telegram route, retained the existing Discord route and all other authored config, and the independent CLI list confirmed both.';
  f.receipt.metadataChanges = {owner: 'src/config/io.meta.ts', keys: ['meta.migrations.skillWorkshopPlugin=true', 'meta.migrations.skillLibraryToolSplit=true'], contract: 'AUTO_MANAGED_CONFIG_META_PATHS and stampConfigWriteMetadata; lastTouchedAt now belongs to machine state, not authored config' };
  f.receipt.result = 'PASS';
} catch (error) {
  f.receipt.result = 'BLOCKED'; f.receipt.failure = error.stack; throw error;
} finally {
  for (const leaf of ['home', 'state', 'workspace']) fs.rmSync(path.join(f.out, leaf), {recursive: true, force: true});
  f.receipt.cleanup = 'Task-owned private HOME/state/workspace removed; synthetic config/native logs retained. No external model calls or channel messages.';
  f.save();
  console.log(JSON.stringify({result: f.receipt.result, head: f.receipt.sha, observation: f.receipt.observation, receipt: path.join(f.out, 'receipt.json'), failure: f.receipt.failure}));
}
