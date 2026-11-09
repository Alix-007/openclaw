import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

checkout, output, node = (Path(value).resolve() for value in sys.argv[1:4])
expectation = sys.argv[4]
assert expectation in ('red', 'green')
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=checkout).strip()
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip()
stamp = json.loads((checkout / 'dist/.buildstamp').read_text())
assert stamp['head'] == head and stamp['inputsClean']
output.mkdir()
sha = lambda data: hashlib.sha256(data).hexdigest()
receipt = {'head': head, 'buildStamp': stamp, 'collectorSHA256': sha(Path(__file__).read_bytes()), 'expectation': expectation, 'entry': 'Normal openclaw.mjs update status --json --timeout <seconds>', 'boundary': 'Real CLI -> native Git inspection -> actual JSON stdout; default public npm diagnostic remains optional and is not claimed as successful; no running production Gateway/provider/channel', 'cases': [], 'result': 'RUNNING'}
try:
    for label, seconds in [('ordinary-control', '30'), ('long-timeout', '2147484')]:
        case = output / label
        case.mkdir()
        for name in ['home', 'state', 'workspace', 'tmp']:
            (case / name).mkdir()
        config = case / 'config.json'
        config.write_text(json.dumps({'gateway': {'mode': 'local', 'auth': {'mode': 'none'}}, 'agents': {'defaults': {'workspace': str(case / 'workspace')}, 'entries': {'main': {'workspace': str(case / 'workspace')}}}}))
        config.chmod(0o600)
        config_before = sha(config.read_bytes())
        environment = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(case / 'home'), 'USERPROFILE': str(case / 'home'), 'OPENCLAW_STATE_DIR': str(case / 'state'), 'OPENCLAW_CONFIG_PATH': str(config), 'TMPDIR': str(case / 'tmp'), 'OPENCLAW_DISABLE_BUNDLED_PLUGINS': '1', 'NO_COLOR': '1', 'TERM': 'dumb'}
        command = [str(node), str(checkout / 'openclaw.mjs'), 'update', 'status', '--json', '--timeout', seconds]
        started = time.monotonic()
        process = subprocess.Popen(command, cwd=checkout, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        killed = False
        try:
            stdout, stderr = process.communicate(timeout=35)
        except subprocess.TimeoutExpired:
            killed = True
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
        elapsed = time.monotonic() - started
        (case / 'stdout.txt').write_bytes(stdout)
        (case / 'stderr.txt').write_bytes(stderr)
        row = {'label': label, 'command': command, 'exitCode': process.returncode, 'seconds': round(elapsed, 3), 'watchdogKill': killed, 'configUnchanged': sha(config.read_bytes()) == config_before, 'stdoutSHA256': sha(stdout), 'stderrSHA256': sha(stderr), 'stdout': stdout.decode(errors='replace'), 'stderr': stderr.decode(errors='replace')}
        receipt['cases'].append(row)
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        assert not killed and row['configUnchanged'], row
        payload = json.loads(stdout)
        row['inspectionErrors'] = payload.get('inspectionErrors', [])
        row['registry'] = payload.get('update', {}).get('registry')
        if label == 'ordinary-control' or expectation == 'green':
            assert process.returncode == 0 and payload['update']['git']['sha'] == head and payload['update']['deps']['status'] == 'ok', row
            assert not any('Update status timed out' in error['message'] for error in row['inspectionErrors']), row
            assert 'TimeoutOverflowWarning' not in row['stderr'], row
            row['result'] = 'GREEN_CONTROL' if label == 'ordinary-control' else 'GREEN'
        else:
            assert 'TimeoutOverflowWarning' in row['stderr'] and any('Update status timed out' in error['message'] for error in row['inspectionErrors']), row
            assert row['registry'] is None, row
            row['result'] = 'RED_LONG_ALLOWANCE_EXPIRES_IMMEDIATELY'
    receipt['result'] = 'RED_WITH_LEGAL_CONTROL' if expectation == 'red' else 'GREEN'
except Exception as error:
    receipt['result'] = 'BLOCKED_OR_UNEXPECTED'
    receipt['error'] = repr(error)
    raise
finally:
    receipt['cleanup'] = {'ownCLIWaited': True, 'isolatedConfigurationOnly': True, 'noUpdateOrServiceMutationRequested': True, 'fixturesRetained': True}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
