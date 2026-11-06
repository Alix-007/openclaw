import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepare} from './native-cli.mjs';
const [checkout, outArg, expected] = process.argv.slice(2);
assert.ok(['base', 'head'].includes(expected));
const out = path.resolve(outArg);
assert.equal(fs.existsSync(out), false, 'Use a fresh proof output directory');
fs.mkdirSync(out);
const receipt = {at: new Date().toISOString(), expected, cases: [], modelsCalled: false, channelMessagesSent: false, result: 'RUNNING'};
const save = () => fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
receipt.collectorSha256 = createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex');
const route = accountId => ({channel: 'telegram', ...(accountId ? {accountId} : {})});
try {
  for (const [name, batches, desired] of [
    ['batch', [['telegram', 'telegram:ops']], expected === 'base' ? [route(), route('ops')] : [route('ops')]],
    ['sequential', [['telegram'], ['telegram:ops']], [route('ops')]],
    ['explicit-default-control', [['telegram:default', 'telegram:ops']], [route('default'), route('ops')]],
  ]) {
    const f = prepare(checkout, path.join(out, name));
    receipt.productHead ??= f.receipt.sha;
    assert.equal(f.receipt.sha, receipt.productHead);
    if (expected === 'base') assert.equal(f.receipt.sha, '5bd69e0a3365a3095df1d34576a6885de6fdf5d3');
    const row = {name, sha: f.receipt.sha, runs: [], readbacks: []};
    receipt.cases.push(row); save();
    async function bind(specs, label) {
      const run = await f.run(['agents', 'bind', '--agent', 'main', ...specs.flatMap(spec => ['--bind', spec]), '--json'], label);
      assert.deepEqual(run.exit, {code: 0, signal: null}, run.stderr);
      const payload = JSON.parse(run.stdout);
      assert.deepEqual(payload.conflicts, []);
      row.runs.push({command: run.command, exit: run.exit, payload}); save();
      return payload;
    }
    async function readback(label) {
      const disk = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
      const run = await f.run(['agents', 'bindings', '--agent', 'main', '--json'], label);
      assert.deepEqual(run.exit, {code: 0, signal: null}, run.stderr);
      const listed = JSON.parse(run.stdout);
      assert.deepEqual(disk.bindings.map(x => x.match), desired);
      assert.deepEqual(listed.map(x => x.match), desired);
      for (const key of ['gateway', 'plugins', 'agents']) assert.deepEqual(disk[key], f.config[key]);
      row.readbacks.push({diskBindings: disk.bindings, command: run.command, exit: run.exit, listed}); save();
    }
    try {
      for (const [i, specs] of batches.entries()) await bind(specs, `${name}-bind-${i}`);
      await readback(`${name}-readback`);
      if (name === 'batch') {
        const first = row.runs[0].payload;
        assert.deepEqual(first.added, expected === 'base' ? ['telegram', 'telegram accountId=ops'] : ['telegram accountId=ops']);
        assert.deepEqual(first.updated, []);
        const repeated = await bind(batches[0], 'batch-repeat');
        await readback('batch-repeat-readback');
        assert.deepEqual(repeated.added, []);
        assert.deepEqual(repeated.updated, []);
        row.repeatedBatchDidNotExpandRouting = true;
      }
      f.receipt.result = 'PASS'; f.save();
    } finally {
      for (const leaf of ['home', 'state', 'workspace']) fs.rmSync(path.join(f.out, leaf), {recursive: true, force: true});
    }
  }
  receipt.observation = expected === 'base'
    ? 'RED: one repeated-option batch retains implicit default plus ops; the same two commands in sequence retain only ops.'
    : 'GREEN: the batch and sequential commands both retain only ops, repeating the batch is idempotent, and explicit default plus ops still retains both.';
  receipt.result = 'PASS';
} catch (error) {
  receipt.result = 'FAIL'; receipt.failure = error.stack; throw error;
} finally {
  receipt.cleanup = 'Task-owned private HOME/state/workspace directories removed; synthetic config and native stdout/stderr retained for inspection. No production environment, model call or channel message.';
  save();
  console.log(JSON.stringify({result: receipt.result, productHead: receipt.productHead, observation: receipt.observation, receipt: path.join(out, 'receipt.json'), failure: receipt.failure}));
}
