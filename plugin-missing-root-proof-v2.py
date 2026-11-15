"""Built plugin entry points retain actionable missing-root errors."""
from pathlib import Path
import hashlib, json, subprocess, sys
w, out, node = map(lambda value: Path(value).resolve(), sys.argv[1:4])
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
missing = out / 'fixtures/absent'
r = {'head': head, 'buildStamp': stamp, 'collectorSHA256': sha(Path(__file__).read_bytes()), 'mode': mode, 'cases': [], 'result': 'RUNNING'}
def save():
    (out / 'receipt.json').write_text(json.dumps(r, indent=2) + '\n')
try:
    for label, args in [('build', ['build']), ('validate', ['validate']), ('validate-json', ['validate', '--json']), ('pack', ['pack', '--json']), ('runtime-lint-control', ['lint', '--json'])]:
        command = [str(node), str(w / 'openclaw.mjs'), 'plugins', *args, '--root', str(missing)]
        value = subprocess.run(command, cwd=w, env=env, capture_output=True, timeout=90)
        row = {'label': label, 'command': command, 'exitCode': value.returncode}
        for kind, content in [('stdout', value.stdout), ('stderr', value.stderr)]:
            (out / (label + '.' + kind)).write_bytes(content)
            row[kind] = content.decode(errors='replace')
            row[kind + 'SHA256'] = sha(content)
        r['cases'].append(row)
        save()
        if label == 'runtime-lint-control':
            assert value.returncode == 0
            report = json.loads(row['stdout'])
            assert not report['complete'] and report['warnings'][0]['ruleId'] == 'scan-incomplete'
            assert 'Inspect installed dependencies and retry' in report['warnings'][0]['message']
        else:
            assert value.returncode == 1, row
            visible = row['stdout'] + row['stderr']
            if mode == 'green':
                assert 'Plugin root not found:' in visible and str(missing) in visible and 'Set --root to an existing plugin project directory' in visible, row
            else:
                assert 'Set --root to an existing plugin project directory' not in visible, row
        assert not missing.exists()
    assert list((out / 'fixtures').iterdir()) == []
    r['result'] = 'GREEN4_ACTIONABLE_ROOT_ERRORS_AND_WARNING_CONTROL' if mode == 'green' else 'BASE4_ROOT_DIAGNOSTIC_REGRESSIONS_AND_WARNING_CONTROL'
except Exception as error:
    r['result'] = 'BLOCKED_OR_UNEXPECTED'
    r['error'] = repr(error)
    save()
    raise
finally:
    r['cleanup'] = {'productionStateTouched': False, 'externalNetwork': False, 'missingRootCreated': missing.exists(), 'isolatedFixturesRetained': True}
    save()
