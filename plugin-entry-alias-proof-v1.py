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
for name in ['home', 'state', 'tmp', 'fixtures']:
    (out / name).mkdir()
config = out / 'openclaw.json'
config.write_text(json.dumps({'plugins': {'allow': [], 'slots': {'memory': 'none'}}}))
env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(out / 'home'), 'OPENCLAW_STATE_DIR': str(out / 'state'), 'OPENCLAW_CONFIG_PATH': str(config), 'TMPDIR': str(out / 'tmp'), 'NO_COLOR': '1', 'OPENCLAW_NO_RESPAWN': '1'}
r = {'head': head, 'buildStamp': stamp, 'collectorSHA256': sha(Path(__file__).read_bytes()), 'mode': mode, 'cases': [], 'models': [], 'result': 'RUNNING'}
def save():
    (out / 'receipt.json').write_text(json.dumps(r, indent=2) + '\n')
def run(label, root, args, code):
    command = [str(node), str(w / 'openclaw.mjs'), 'plugins', *args, '--root', str(root)]
    v = subprocess.run(command, cwd=w, env=env, capture_output=True, timeout=90)
    row = {'label': label, 'command': command, 'exitCode': v.returncode}
    for key, data in [('stdout', v.stdout), ('stderr', v.stderr)]:
        (out / (label + '.' + key)).write_bytes(data)
        row[key] = data.decode(errors='replace')
        row[key + 'SHA256'] = sha(data)
    r['cases'].append(row)
    save()
    assert v.returncode == code, row
    return row
try:
    for kind in ['file-alias', 'directory-alias', 'ordinary-control']:
        root = out / 'fixtures' / kind
        (root / 'src/implementation').mkdir(parents=True)
        (root / 'node_modules').mkdir()
        (root / 'node_modules/esbuild').symlink_to(w / 'node_modules/esbuild', target_is_directory=True)
        impl = root / ('src/implementation/index.ts' if kind == 'directory-alias' else 'src/implementation.ts')
        impl.write_text('import {defineToolPlugin}from"openclaw/plugin-sdk/tool-plugin";export default defineToolPlugin({id:"alias-proof",name:"Alias Proof",description:"Synthetic",tools:(tool)=>[tool({name:"alias_echo",description:"Synthetic",parameters:{type:"object",properties:{}},execute:async()=>({ok:true})})]});\n')
        physical = './' + impl.relative_to(root).as_posix()
        runtime = ['./dist/selected.js', './dist/sibling.js']
        package = root / 'package.json'
        package.write_text(json.dumps({'name': 'openclaw-plugin-alias-proof', 'version': '1.0.0', 'type': 'module', 'openclaw': {'extensions': [physical, './src/sibling.ts'], 'runtimeExtensions': runtime, 'setupEntry': runtime[0]}}))
        run(kind + '-seed-build', root, ['build'], 0)
        if kind == 'file-alias':
            (root / 'src/alias.ts').symlink_to('implementation.ts')
            selected = './src/alias.ts'
        elif kind == 'directory-alias':
            (root / 'src/declared').symlink_to('implementation', target_is_directory=True)
            selected = './src/declared/index.ts'
        else:
            selected = physical
        legacy = json.loads(package.read_text())
        legacy['openclaw']['extensions'][0] = selected
        package.write_text(json.dumps(legacy, indent=2) + '\n')
        before = sha(impl.read_bytes())
        validation = run(kind + '-existing-data-validation', root, ['validate', '--json'], 1 if mode == 'red' and selected != physical else 0)
        report = json.loads(validation['stdout'])
        assert report['valid'] == (mode == 'green' or selected == physical)
        run(kind + '-build', root, ['build'], 0)
        persisted = json.loads(package.read_text())
        expected = [selected, './src/sibling.ts'] + ([physical] if mode == 'red' and selected != physical else [])
        assert persisted['openclaw']['extensions'] == expected, persisted
        assert persisted['openclaw']['runtimeExtensions'] == runtime
        assert persisted['openclaw']['setupEntry'] == runtime[0]
        run(kind + '-post-build-validation', root, ['validate', '--json'], 0)
        assert sha(impl.read_bytes()) == before
        if mode == 'green':
            assert persisted == legacy
        r['models'].append({'kind': kind, 'legacyPackage': legacy, 'persistedPackage': persisted, 'sourceUnchanged': before, 'selectedEntry': selected, 'physicalEntry': physical, 'duplicatePhysicalDeclarations': sum((root / e).resolve() == impl.resolve() for e in persisted['openclaw']['extensions']), 'manifestSHA256': sha((root / 'openclaw.plugin.json').read_bytes())})
        save()
    r['result'] = 'GREEN_EXISTING_FILE_AND_DIRECTORY_ALIASES_AND_CONTROL' if mode == 'green' else 'BASE2_EXISTING_DECLARATIONS_REJECTED_AND_DUPLICATED_WITH_CONTROL'
except Exception as error:
    r['result'] = 'BLOCKED_OR_UNEXPECTED'
    r['error'] = repr(error)
    raise
finally:
    r['cleanup'] = {'productionStateTouched': False, 'externalNetwork': False, 'isolatedFixturesRetained': True}
    save()
