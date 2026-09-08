import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run only in secretless fork CI. The workflow places this reviewed control in
// .proof/ of an independently archived exact product revision.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { SessionManager } = await import(`${root}/src/agents/sessions/session-manager.ts`);
const { appendTranscriptMessage, loadTranscriptEvents, upsertSessionEntryCore } =
  await import(`${root}/src/config/sessions/session-accessor.ts`);
const { formatSqliteSessionFileMarker } =
  await import(`${root}/src/config/sessions/legacy-sqlite-marker.ts`);

if (process.argv[2] === '--read') {
  const target = JSON.parse(process.argv[3]);
  const events = await loadTranscriptEvents(target);
  const reopened = SessionManager.open(target, process.argv[4]);
  assert.deepEqual(reopened.getEntries(), events);
  console.log(JSON.stringify(events));
} else {
  const receiptDir = process.argv[2];
  const mode = process.env.EXPECTATION_MODE;
  assert.ok(mode === 'parent-red' || mode === 'product');
  assert.match(process.env.PRODUCT_SHA ?? '', /^[a-f0-9]{40}$/);
  await fs.mkdir(receiptDir, { recursive: true });
  const dir = await fs.mkdtemp(path.join(receiptDir, 'transcript-'));
  const quoted = '> Example\n>\n>     print("a  b")';
  const cases = [
    { name: 'quoted-indented-code', body: quoted, red: '> Example\n>\n> print("a b")' },
    { name: 'standalone-indented-code', body: 'Example\n\n    print("a  b")' },
    { name: 'fenced-code', body: '```python\nprint("a  b")\n```' },
    { name: 'inline-code', body: 'Example `print("a  b")`' },
    { name: 'literal-directive-in-fence', body: '```text\n[[reply_to:literal-example]]\n```' },
    { name: 'plain-prose-normalization', body: 'Hello  world', expected: 'Hello world' },
    { name: 'no-directive-code', body: quoted, noDirective: true },
    { name: 'explicit-reply', body: 'Acknowledged', directive: '[[reply_to:operator-42]]', facts: { replyToId: 'operator-42' } },
  ];
  const observations = [];
  for (const fixture of cases) {
    const sessionId = fixture.name;
    const sessionKey = `agent:main:proof:${sessionId}`;
    const storePath = path.join(dir, 'sessions.json');
    const target = { agentId: 'main', sessionId, sessionKey, storePath };
    const marker = formatSqliteSessionFileMarker(target);
    await upsertSessionEntryCore({ agentId: 'main', sessionKey, storePath }, {
      sessionFile: marker, sessionId, updatedAt: Date.now(),
    });
    await appendTranscriptMessage(target, {
      cwd: dir, message: { role: 'user', content: 'Show this Python example as quoted indented code, preserving the string exactly.' },
    });
    const input = fixture.noDirective ? fixture.body : `${fixture.directive ?? '[[reply_to_current]]'}\n${fixture.body}`;
    const manager = SessionManager.open(target, dir);
    const id = manager.appendMessage({
      role: 'assistant', content: [{ type: 'text', text: input }],
      api: 'openai-responses', provider: 'openai', model: 'gpt-5.5',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    });
    manager.flushPendingPersistence();
    // A separate process prevents an in-memory message from masquerading as
    // persisted proof. It also opens a new manager over the same SQLite target.
    const read = spawnSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'),
      '--tsconfig', path.join(root, 'tsconfig.json'), fileURLToPath(import.meta.url),
      '--read', JSON.stringify(target), dir], { cwd: root, env: process.env, encoding: 'utf8', timeout: 60000 });
    assert.equal(read.status, 0, `fresh read failed: ${read.error ?? read.stderr}`);
    const events = JSON.parse(read.stdout);
    const stored = events.find((entry) => entry.id === id)?.message;
    assert.ok(stored, 'append id must resolve from persisted events');
    const wanted = fixture.expected ?? fixture.body;
    const expected = mode === 'parent-red' && fixture.red ? fixture.red : wanted;
    const actual = stored.content[0].text;
    const facts = fixture.noDirective ? undefined : fixture.facts ?? { replyToCurrent: true };
    observations.push({ name: fixture.name, input, expectedProductText: wanted, observedText: actual,
      persistedFacts: stored.openclawDelivery ?? null, productBytesPreserved: actual === wanted });
    await fs.writeFile(path.join(receiptDir, 'observations.json'), JSON.stringify({
      sourceSha: process.env.PRODUCT_SHA, mode, entry: 'SessionManager.open().appendMessage()',
      boundary: 'SQLite persistence plus fresh-process loadTranscriptEvents and SessionManager.open',
      limitations: 'No provider, gateway or channel delivery is exercised.', observations,
    }, null, 2));
    assert.deepEqual(stored.openclawDelivery, facts, `${fixture.name}: reply facts`);
    assert.equal(actual, expected, `${fixture.name}: exact text bytes`);
    assert.deepEqual(manager.getEntry(id)?.message, stored, 'live and persisted messages agree');
  }
  const violations = observations.filter((row) => !row.productBytesPreserved);
  assert.equal(violations.length, mode === 'parent-red' ? 1 : 0);
  console.log(JSON.stringify({ mode, cases: observations.length, expectedViolations: violations.length, passed: true }));
}
