from pathlib import Path
import hashlib, json, os, subprocess, sys

w, out, node = map(lambda v: Path(v).resolve(), sys.argv[1:4])
mode = sys.argv[4]
assert mode in ('red', 'green')
out.mkdir()
sha = lambda b: hashlib.sha256(b).hexdigest()
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=w, text=True).strip()
stamp = json.loads((w / 'dist/.buildstamp').read_text())
assert stamp['head'] == head and stamp['inputsClean']
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=w).strip()
for leaf in ['home', 'state', 'tmp', 'fixtures']:
    (out / leaf).mkdir()
config = out / 'openclaw.json'
config.write_text(json.dumps({'plugins': {'allow': [], 'slots': {'memory': 'none'}}}))
env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(out / 'home'), 'OPENCLAW_STATE_DIR': str(out / 'state'), 'OPENCLAW_CONFIG_PATH': str(config), 'TMPDIR': str(out / 'tmp'), 'NO_COLOR': '1', 'OPENCLAW_NO_RESPAWN': '1'}
root = out / 'fixtures/project'
root.mkdir()
(root / 'node_modules').mkdir()
(root / 'node_modules/esbuild').symlink_to(w / 'node_modules/esbuild', target_is_directory=True)
(root / 'package.json').write_text(json.dumps({'name': 'openclaw-plugin-entry-proof', 'version': '1.0.0', 'type': 'module', 'openclaw': {'extensions': ['./index.ts']}}))
(root / 'index.ts').write_text('import {defineToolPlugin}from"openclaw/plugin-sdk/tool-plugin";export default defineToolPlugin({id:"entry-proof",name:"Entry Proof",description:"Synthetic",tools:(tool)=>[tool({name:"proof_echo",description:"Synthetic",parameters:{type:"object",properties:{}},execute:async()=>({ok:true})})]});\n')
r = {'head': head, 'buildStamp': stamp, 'collectorSHA256': sha(Path(__file__).read_bytes()), 'mode': mode, 'cases': [], 'result': 'RUNNING'}
def save():
    (out / 'receipt.json').write_text(json.dumps(r, indent=2) + '\n')
def run(label, args, code):
    command = [str(node), str(w / 'openclaw.mjs'), 'plugins', *args, '--root', str(root)]
    value = subprocess.run(command, cwd=w, env=env, capture_output=True, timeout=90)
    row = {'label': label, 'command': command, 'exitCode': value.returncode}
    for kind, data in [('stdout', value.stdout), ('stderr', value.stderr)]:
        (out / (label + '.' + kind)).write_bytes(data)
        row[kind] = data.decode(errors='replace')
        row[kind + 'SHA256'] = sha(data)
    r['cases'].append(row)
    save()
    assert value.returncode == code, row
    return row
try:
    run('valid-build-control', ['build'], 0)
    before = {name: sha((root / name).read_bytes()) for name in ['package.json', 'index.ts', 'openclaw.plugin.json']}
    assert json.loads((root / 'openclaw.plugin.json').read_text())['id'] == 'entry-proof'
    for label, args in [('build', ['build']), ('validate', ['validate']), ('validate-json', ['validate', '--json'])]:
        row = run(label + '-file-component', [*args, '--entry', 'package.json/index.js'], 1)
        visible = row['stdout'] + row['stderr']
        assert ('plugin entry not found: ./package.json/index.js' in visible) == (mode == 'green'), row
    row = run('missing-entry-control', ['validate', '--entry', 'missing.js'], 1)
    assert 'plugin entry not found: ./missing.js' in row['stderr'], row
    row = run('valid-validate-control', ['validate', '--json'], 0)
    assert json.loads(row['stdout'])['valid'] and json.loads(row['stdout'])['pluginId'] == 'entry-proof'
    after = {name: sha((root / name).read_bytes()) for name in before}
    assert before == after
    r['readback'] = {'before': before, 'after': after, 'pluginId': 'entry-proof', 'fileComponentStillAFile': (root / 'package.json').is_file()}
    r['result'] = 'GREEN3_ENTRY_DIAGNOSTICS_AND3_CONTROLS' if mode == 'green' else 'BASE3_GENERIC_ENTRY_FAILURES_AND3_CONTROLS'
except Exception as error:
    r['result'] = 'BLOCKED_OR_UNEXPECTED'
    r['error'] = repr(error)
    raise
finally:
    r['cleanup'] = {'productionStateTouched': False, 'externalNetwork': False, 'isolatedFixturesRetained': True}
    save()
