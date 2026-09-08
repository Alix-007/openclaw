import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, operation = 'seed'] = process.argv.slice(2);
const source = (file) => import(pathToFileURL(path.join(root, 'src', file)).href);
const { appendTranscriptMessage, loadTranscriptEvents, upsertSessionEntryCore } =
  await source('config/sessions/session-accessor.ts');
const { resolveSessionStorePathCore } = await source('config/sessions/paths.ts');
const { formatSqliteSessionFileMarker } = await source('config/sessions/legacy-sqlite-marker.ts');
const storePath = resolveSessionStorePathCore(undefined, { agentId: 'main' });
const literal = '[message_id: example-42]';
const cases = [
  { name: 'fenced', text: `Explain this template:\n\n\`\`\`text\n${literal}\n\`\`\``, red: 'Explain this template:\n\n```text\n```' },
  { name: 'indented', text: `Explain this template:\n\n    ${literal}\n\nKeep the example.`, red: 'Explain this template:\n\n\nKeep the example.' },
  { name: 'inline', text: `Explain \`${literal}\` without changing it.` },
  { name: 'blockquote', text: `Explain this template:\n\n> \`\`\`text\n> ${literal}\n> \`\`\`` },
  { name: 'quoted-indent', text: `Explain this template:\n\n> Example\n>\n>     ${literal}` },
  { name: 'generated-prefix', text: '[message_id: generated-42]\nAlice: Hello', expected: 'Alice: Hello' },
  { name: 'generated-plus-fence', text: `[message_id: generated-42]\nAlice: Explain this template:\n\n\`\`\`text\n${literal}\n\`\`\``, expected: `Alice: Explain this template:\n\n\`\`\`text\n${literal}\n\`\`\``, red: 'Alice: Explain this template:\n\n```text\n```' },
  { name: 'generated-suffix', text: 'Hello\n[message_id: generated-42]', expected: 'Hello' },
  { name: 'assistant-code', role: 'assistant', text: `Example:\n\n\`\`\`text\n${literal}\n\`\`\`` },
];
const receipt = [];
for (const fixture of cases) {
  const sessionId = `message-id-${fixture.name}`;
  const sessionKey = `agent:main:proof:${sessionId}`;
  const target = { agentId: 'main', sessionId, sessionKey, storePath };
  if (operation === 'seed') {
    await upsertSessionEntryCore({ agentId: 'main', sessionKey, storePath }, {
      sessionId, sessionFile: formatSqliteSessionFileMarker(target), updatedAt: Date.now(),
    });
    const role = fixture.role ?? 'user';
    // Canonical transcript writer, no raw SQLite or replacement gateway handler.
    await appendTranscriptMessage(target, { cwd: process.cwd(), message: {
      role, content: [{ type: 'text', text: fixture.text }], timestamp: Date.now(),
      ...(role === 'assistant' ? {
        api: 'openai-responses', provider: 'openai', model: 'gpt-5.5', stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      } : {}),
    } });
  }
  const messages = (await loadTranscriptEvents(target)).filter((event) => event.type === 'message');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.content[0].text, fixture.text, 'raw transcript must preserve source bytes');
  receipt.push({ ...fixture, sessionKey, raw: messages[0].message });
}
console.log(JSON.stringify(receipt));
