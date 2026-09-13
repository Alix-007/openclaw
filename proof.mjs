// Exact-source availability proof. Fixtures are inspected, never executed.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [repoArg, outArg] = process.argv.slice(2);
if (!repoArg || !outArg) throw new Error('Usage: proof.mjs CHECKOUT OUTPUT.json');
const repo = path.resolve(repoArg);
const out = path.resolve(outArg);
const expectedHead = '501e289e4acef40a68f171b3e2666d8a00241fbc';
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const files = ['src/infra/detect-binary.ts', 'src/infra/executable-path.ts', 'src/infra/detect-binary.test.ts', 'pnpm-lock.yaml'];
const source = async () => ({ head: git('rev-parse', 'HEAD'), files: Object.fromEntries(await Promise.all(files.map(async f => [f, hash(await fs.readFile(path.join(repo, f)))]))) });
const before = await source();
if (before.head !== expectedHead) throw new Error('Wrong product revision');
const { isSupportedOpenClawNodeVersion } = await import(pathToFileURL(path.join(repo, 'node-version.mjs')).href);
if (!isSupportedOpenClawNodeVersion(process.versions.node)) throw new Error('Unsupported Node');
git('diff', '--exit-code');
const { detectBinary } = await import(pathToFileURL(path.join(repo, 'src/infra/detect-binary.ts')).href);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-binary-proof-'));
const fixture = name => path.join(root, name);
const marker = fixture('MUST_NOT_EXECUTE');
const content = `#!/bin/sh\nprintf unexpected > '${marker}'\n`;
const records = [];
const report = { schema: 1, pr: 146988, testedHead: before.head, node: process.version, platform: process.platform, startedAt: new Date().toISOString(), entry: 'actual detectBinary -> actual isExecutableFile -> native filesystem', sourceBefore: before, records, limitations: ['Availability only; fixture binaries are not executed.', 'No channel setup, installed application bootstrap, or race-free future execution is claimed.', 'Synthetic temporary files and process-local PATHEXT changes; no production settings.'] };
const priorCwd = process.cwd();
const oldPathExt = process.env.PATHEXT;
let exit = 1;
async function check(name, input, expected) {
  const actual = await detectBinary(input);
  let isFile = false;
  let errorCode = null;
  try { const st = await fs.stat(input); isFile = st.isFile(); if (isFile && process.platform !== 'win32') await fs.access(input, fs.constants.X_OK); }
  catch (e) { errorCode = e.code; }
  records.push({ name, expected, actual, pass: actual === expected, filesystem: { isFile, errorCode } });
}
try {
  process.chdir(repo);
  await fs.mkdir(fixture('directory'));
  await check('native-runtime', process.execPath, true);
  await check('directory', fixture('directory'), false);
  await check('absent', fixture('absent'), false);
  if (process.platform === 'win32') {
    process.env.PATHEXT = '.EXE;.CMD;.BAT;.COM';
    for (const ext of ['exe', 'cmd', 'bat', 'com']) {
      await fs.writeFile(fixture(`tool.${ext}`), 'fixture is never executed\r\n');
      await check(`native-suffix:${ext}`, fixture(`tool.${ext}`), true);
    }
    await fs.mkdir(fixture('directory.exe'));
    await check('directory-with-native-suffix', fixture('directory.exe'), false);
    await fs.writeFile(fixture('tool'), 'fixture is never executed\r\n');
    await check('extensionless-file', fixture('tool'), true);
    await fs.writeFile(fixture('tool.ocproof'), 'fixture is never executed\r\n');
    await check('non-native-suffix-not-in-PATHEXT', fixture('tool.ocproof'), false);
    process.env.PATHEXT = '.EXE;.OCPROOF';
    await check('non-native-suffix-in-PATHEXT', fixture('tool.ocproof'), true);
    await check('native-CMD-despite-narrow-PATHEXT', fixture('tool.cmd'), true);
    process.env.PATHEXT = '.EXE';
    await check('PATHEXT-change-observed-without-cache', fixture('tool.ocproof'), false);
    const unchanged = (await fs.readFile(fixture('tool.ocproof'), 'utf8')) === 'fixture is never executed\r\n';
    records.push({ name: 'fixture-bytes-preserved', actual: unchanged, expected: true, pass: unchanged });
  } else {
    await fs.writeFile(fixture('tool'), content, { mode: 0o755 });
    await fs.writeFile(fixture('plain'), 'not executable\n', { mode: 0o644 });
    await fs.symlink(fixture('tool'), fixture('tool-link'));
    await fs.symlink(fixture('directory'), fixture('directory-link'));
    await fs.symlink(fixture('absent'), fixture('dangling'));
    for (const [n, expected] of [['tool', true], ['plain', false], ['tool-link', true], ['directory-link', false], ['dangling', false]]) await check(n, fixture(n), expected);
    for (const n of ['tool', 'tool-link']) for (const suffix of ['/', '//', '/.', '/../tool']) await check(`invalid-suffix:${n}${suffix}`, `${fixture(n)}${suffix}`, false);
    await fs.mkdir(fixture('configured'));
    await fs.mkdir(fixture('actual/bin'), { recursive: true });
    await fs.symlink(fixture('actual/bin'), fixture('configured/alias'));
    await fs.writeFile(fixture('actual/tool'), content, { mode: 0o755 });
    const input = `${fixture('configured')}/alias/../tool`;
    await check('symlink-parent-absolute', input, true);
    await check('symlink-parent-relative', `${path.relative(repo, fixture('configured'))}/alias/../tool`, true);
    await fs.writeFile(fixture('configured/tool'), content, { mode: 0o755 });
    await fs.unlink(fixture('actual/tool'));
    await check('lexical-decoy-missing-target', input, false);
    await fs.writeFile(fixture('actual/tool'), content, { mode: 0o644 });
    await check('lexical-decoy-non-executable-target', input, false);
    await fs.chmod(fixture('tool'), 0o644);
    await check('permission-removed', fixture('tool'), false);
    await fs.chmod(fixture('tool'), 0o755);
    await check('permission-restored', fixture('tool'), true);
    const unchanged = hash(await fs.readFile(fixture('tool'))) === hash(content);
    records.push({ name: 'fixture-bytes-preserved', actual: unchanged, expected: true, pass: unchanged });
  }
  const markerAbsent = await fs.stat(marker).then(() => false, e => { if (e.code !== 'ENOENT') throw e; return true; });
  records.push({ name: 'execution-marker-absent', actual: markerAbsent, expected: true, pass: markerAbsent });
  report.sourceAfter = await source();
  report.sourceStable = JSON.stringify(report.sourceAfter) === JSON.stringify(before);
  git('diff', '--exit-code');
  exit = records.every(r => r.pass) && report.sourceStable ? 0 : 1;
} catch (error) {
  report.failure = String(error.message).split(root).join('<fixture>').split(repo).join('<checkout>');
} finally {
  process.chdir(priorCwd);
  if (oldPathExt === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = oldPathExt;
  await fs.rm(root, { recursive: true, force: true });
  report.scratchRemoved = await fs.stat(root).then(() => false, e => e.code === 'ENOENT');
  report.status = exit === 0 && report.scratchRemoved ? 'PASS' : 'FAIL';
  report.finishedAt = new Date().toISOString();
  report.exitCode = report.status === 'PASS' ? 0 : 1;
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.exitCode;
}
