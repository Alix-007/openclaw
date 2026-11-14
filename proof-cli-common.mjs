import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';

export function fixture(name, checkoutArg, phase) {
  assert.ok(['red', 'green'].includes(phase));
  const checkout = path.resolve(checkoutArg);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `alix-${name}-`));
  for (const leaf of ['home', 'state', 'workspace', 'tmp']) fs.mkdirSync(path.join(root, leaf));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  // Read-only containers receive a host Git attestation before the bind mount.
  const head = process.env.PROOF_CHECKED_HEAD ?? execFileSync('git', ['rev-parse', 'HEAD'], {cwd: checkout, encoding: 'utf8'}).trim();
  const status = process.env.PROOF_CHECKED_STATUS ?? execFileSync('git', ['status', '--porcelain'], {cwd: checkout, encoding: 'utf8'}).trim();
  assert.match(head, /^[a-f0-9]{40}$/);
  const stamp = JSON.parse(fs.readFileSync(path.join(checkout, 'dist/.buildstamp')));
  assert.equal(status, ''); assert.equal(stamp.head, head); assert.equal(stamp.inputsClean, true);
  const configPath = path.join(root, 'openclaw.json');
  const config = {agents: {ownership: 'explicit', defaults: {systemAgent: {agentId: 'main'}}, entries: {main: {workspace: path.join(root, 'workspace')}}}, tools: {profile: 'minimal'}, plugins: {allow: [], slots: {memory: 'none'}}, logging: {level: 'warn', consoleLevel: 'warn', file: path.join(root, 'runtime.log')}};
  const receipt = {name, phase, head, time: new Date().toISOString(), root, runs: [], observations: []};
  const save = () => fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
  const writeConfig = () => fs.writeFileSync(configPath, JSON.stringify(config), {mode: 0o600});
  writeConfig();
  const env = {PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'), LANG: 'C.UTF-8', TZ: 'UTC', CI: '1', OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_STATE_DIR: path.join(root, 'state'), OPENCLAW_NO_RESPAWN: '1', OPENCLAW_DISABLE_BONJOUR: '1'};
  function run(label, args) {
    const result = spawnSync(process.execPath, [path.join(checkout, 'openclaw.mjs'), ...args], {cwd: path.join(root, 'workspace'), env, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024});
    const row = {label, args, code: result.status, stdout: result.stdout, stderr: result.stderr};
    receipt.runs.push(row); save();
    console.log(JSON.stringify({label, code: row.code}));
    assert.equal(result.error, undefined, 'Timeout/spawn errors are not product RED');
    assert.equal(result.signal, null);
    return row;
  }
  function finish() {receipt.result = 'PASS'; save(); console.log(JSON.stringify({result: 'PASS', receipt: path.join(root, 'receipt.json')}));}
  return {root, config, configPath, writeConfig, receipt, run, finish, hash, phase};
}
