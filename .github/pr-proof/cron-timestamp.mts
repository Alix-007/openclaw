import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceRoot, receiptDir, mode] = process.argv.slice(2);
assert(sourceRoot && receiptDir && ['parent', 'product'].includes(mode));
const sourceImport = (file: string) => import(pathToFileURL(path.join(sourceRoot, file)).href);
const { CronService } = await sourceImport('src/cron/service.ts');
const { getChildLogger, flushLogger } = await sourceImport('src/logging/logger.ts');
const logFile = path.join(receiptDir, 'runtime.log');
const events: unknown[] = [];
let unexpectedExecution = 0;
const rejectExecution = () => { unexpectedExecution++; throw new Error('Future job unexpectedly executed'); };
const deps = {
  storePath: path.join(receiptDir, 'state', 'cron', 'jobs.json'),
  cronEnabled: true,
  defaultAgentId: 'proof',
  log: getChildLogger({ module: 'cron' }),
  enqueueSystemEvent: rejectExecution,
  requestHeartbeat: rejectExecution,
  runIsolatedAgentJob: async () => rejectExecution(),
  onEvent: (event: unknown) => events.push(event),
};
const service = new CronService(deps);
const readRecords = async () => {
  await flushLogger();
  return (await fs.readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
};
const message = (record: any) => record.message ?? Object.values(record).find(v => v === 'cron: timer armed');
const fields = (record: any) => Object.values(record).find((v: any) => v && typeof v === 'object' && typeof v.nextAt === 'number') as any;
const receipts: unknown[] = [];
try {
  await service.start();
  assert(!(await readRecords()).some((r: any) => message(r) === 'cron: timer armed'), 'Empty scheduler must not log a nextAt');
  for (const [label, delay, clamped] of [['far', 600_000, true], ['near', 50_000, false]] as const) {
    const scheduledAt = Date.now() + delay;
    const job = await service.add({ name: `timestamp-proof-${label}`, agentId: 'proof', enabled: true,
      schedule: { kind: 'at', at: new Date(scheduledAt).toISOString() },
      sessionTarget: 'main', wakeMode: 'next-heartbeat', payload: { kind: 'systemEvent', text: 'future timestamp proof' } });
    const records = await readRecords();
    const armed = records.filter((r: any) => message(r) === 'cron: timer armed').at(-1);
    assert(armed, 'Real debug transport did not persist timer log');
    const actual = fields(armed);
    assert.equal(actual.nextAt, scheduledAt);
    assert.equal(actual.clamped, clamped);
    assert.equal(typeof actual.delayMs, 'number');
    const reader = new CronService(deps);
    const durable = await reader.readJob(job.id);
    reader.stop();
    assert.equal(durable.state.nextRunAtMs, scheduledAt);
    if (mode === 'parent') {
      assert.equal(actual.nextAtIso, undefined, 'Parent no longer exhibits the selected gap');
    } else {
      assert.equal(typeof actual.nextAtIso, 'string');
      assert.match(actual.nextAtIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
      assert.equal(Date.parse(actual.nextAtIso), actual.nextAt);
      assert(actual.nextAtIso.endsWith(process.env.TZ === 'Asia/Shanghai' ? '+08:00' : '+00:00'));
    }
    assert(!JSON.stringify(durable).includes('nextAtIso'), 'Readable projection leaked into job storage');
    receipts.push({ label, jobId: job.id, nextRunAtMs: durable.state.nextRunAtMs, log: armed });
    await service.remove(job.id);
  }
  assert.equal(unexpectedExecution, 0);
  assert(!JSON.stringify(events).includes('nextAtIso'), 'Readable projection leaked into events');
  await fs.writeFile(path.join(receiptDir, 'OBSERVATIONS.json'), JSON.stringify({ mode, timezone: process.env.TZ,
    acceptance: mode === 'parent' ? 'RED: readable nextAtIso absent' : 'GREEN: readable nextAtIso matches numeric timestamp',
    realLogger: true, unexpectedExecution, receipts, events }, null, 2));
} finally {
  service.stop();
  await flushLogger();
}
