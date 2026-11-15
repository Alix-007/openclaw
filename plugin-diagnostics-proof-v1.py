"""Actual built CLI checks validation diagnostic precedence and actionable init refusal."""
from pathlib import Path
import hashlib, json, os, subprocess, sys, time

w, out, node = map(lambda value: Path(value).resolve(), sys.argv[1:4])
mode = sys.argv[4]
assert mode in ('red', 'green')
out.mkdir()
sha = lambda value: hashlib.sha256(value).hexdigest()
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=w, text=True).strip()
stamp = json.loads((w / 'dist/.buildstamp').read_text())
assert stamp['head'] == head and stamp['inputsClean']
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=w).strip()
for leaf in ['home', 'state', 'tmp', 'fixtures']:
    (out / leaf).mkdir()
config = out / 'openclaw.json'
config.write_text(json.dumps({'plugins': {'allow': [], 'slots': {'memory': 'none'}}}))
env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(out / 'home'),
       'OPENCLAW_STATE_DIR': str(out / 'state'), 'OPENCLAW_CONFIG_PATH': str(config),
       'TMPDIR': str(out / 'tmp'), 'NO_COLOR': '1', 'OPENCLAW_DISABLE_BONJOUR': '1',
       'OPENCLAW_NO_RESPAWN': '1'}
r = {'head': head, 'buildStamp': stamp, 'collectorSHA256': sha(Path(__file__).read_bytes()),
     'mode': mode, 'cases': [], 'result': 'RUNNING'}
def save():
    (out / 'receipt.json').write_text(json.dumps(r, indent=2) + '\n')
def run(label, args, debug=False):
    command = [str(node), str(w / 'openclaw.mjs'), 'plugins', *args]
    start = time.monotonic()
    value = subprocess.run(command, cwd=w, env={**env, **({'OPENCLAW_DEBUG': '1'} if debug else {})}, capture_output=True, timeout=90)
    row = {'label': label, 'command': command, 'exitCode': value.returncode,
           'seconds': round(time.monotonic() - start, 3), 'debug': debug}
    for kind, content in [('stdout', value.stdout), ('stderr', value.stderr)]:
        (out / (label + '.' + kind)).write_bytes(content)
        row[kind] = content.decode(errors='replace')
        row[kind + 'SHA256'] = sha(content)
    r['cases'].append(row)
    save()
    assert value.returncode == 1, row
    return row
try:
    malformed = out / 'fixtures/malformed'
    malformed.mkdir()
    package = malformed / 'package.json'
    package.write_text('{\n  "name": "diagnostic-fixture",\n  "version":\n}\n')
    before = sha(package.read_bytes())
    for debug in [False, True]:
        row = run('malformed-debug-' + str(debug).lower(), ['validate', '--root', str(malformed), '--entry', './absent.js', '--json'], debug)
        errors = json.loads(row['stdout'])['errors']
        expected = 'plugin entry not found' if mode == 'red' else 'Malformed JSON in '
        assert len(errors) == 1 and expected in errors[0], row
        if mode == 'green':
            assert (' | ' in errors[0]) == debug, row
    missing = out / 'fixtures/missing-manifest'
    missing.mkdir()
    (missing / 'package.json').write_text('{"name":"diagnostic-fixture"}\n')
    row = run('missing-manifest', ['validate', '--root', str(missing), '--json'])
    errors = json.loads(row['stdout'])['errors']
    assert len(errors) == 1, row
    assert ('plugin entry not found' in errors[0]) if mode == 'red' else ('manifest not found' in errors[0]), row
    existing = out / 'fixtures/existing'
    existing.mkdir()
    sentinel = existing / 'keep.txt'
    sentinel.write_text('unchanged\n')
    row = run('unreachable-init', ['init', 'diagnostic-fixture', '--directory', str(out / 'fixtures/missing/../existing')])
    assert 'Plugin destination traverses a missing directory' in row['stderr'], row
    assert ('Create the missing parent directory' in row['stderr']) == (mode == 'green'), row
    row = run('no-force-control', ['init', 'diagnostic-fixture', '--directory', str(existing)])
    assert 'Refusing to overwrite existing path' in row['stderr'], row
    assert sentinel.read_text() == 'unchanged\n' and list(existing.iterdir()) == [sentinel]
    assert sha(package.read_bytes()) == before and list(malformed.iterdir()) == [package]
    assert not (out / 'fixtures/missing').exists()
    r['readback'] = {'malformedPackageUnchanged': before, 'existingSentinel': sha(sentinel.read_bytes()), 'unreachableParentAbsent': True}
    r['result'] = 'GREEN_METADATA_PRECEDENCE_AND_ACTIONABLE_REFUSAL_5PASS' if mode == 'green' else 'BASE_3_MASKED_METADATA_ERRORS_AND_NO_RECOVERY_CONTROL_PASS'
except Exception as error:
    r['result'] = 'BLOCKED_OR_UNEXPECTED'
    r['error'] = repr(error)
    save()
    raise
finally:
    r['cleanup'] = {'productionStateTouched': False, 'externalRequests': False, 'isolatedFixturesRetained': True}
    save()
