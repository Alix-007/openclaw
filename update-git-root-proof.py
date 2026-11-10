import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

checkout = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
node = Path(sys.argv[3]).resolve()
expectation = sys.argv[4]
assert expectation in ('control', 'red', 'green')
assert expectation == 'control' or str(checkout).endswith((' ', '\t', '\n', '\r'))
output.mkdir()
sha256 = lambda b: hashlib.sha256(b).hexdigest()
head = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
tracked = subprocess.check_output(['git', '-C', str(checkout), 'status', '--porcelain', '--untracked-files=no'])
assert not tracked, 'Product source must be clean'
stamp = json.loads((checkout / 'dist/.buildstamp').read_text())
assert stamp['head'] == head and stamp['inputsClean'], 'A normal exact-source build is required'
raw_top = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', '--show-toplevel'])
assert raw_top == os.fsencode(str(checkout)) + b'\n', repr(raw_top)
source_paths = ['src/infra/update-check.ts', 'src/infra/update-install-root.ts', 'src/infra/git-exec.ts', 'src/cli/update-cli/shared.ts', 'src/cli/update-cli/status.ts']
source_hashes = {p: sha256((checkout / p).read_bytes()) for p in source_paths}
for name in ['home', 'state', 'workspace', 'tmp']:
    (output / name).mkdir()
probe = socket.socket()
probe.bind(('127.0.0.1', 0))
closed_gateway_port = probe.getsockname()[1]
probe.close()
config = output / 'config.json'
config.write_text(json.dumps({'gateway': {'mode': 'local', 'port': closed_gateway_port, 'auth': {'mode': 'none'}}, 'agents': {'defaults': {'workspace': str(output / 'workspace')}, 'entries': {'main': {'workspace': str(output / 'workspace')}}}}))
config.chmod(0o600)
config_before = sha256(config.read_bytes())
environment = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(output / 'home'), 'USERPROFILE': str(output / 'home'), 'OPENCLAW_STATE_DIR': str(output / 'state'), 'OPENCLAW_CONFIG_PATH': str(config), 'TMPDIR': str(output / 'tmp'), 'OPENCLAW_DISABLE_BUNDLED_PLUGINS': '1', 'NO_COLOR': '1', 'TERM': 'dumb'}
command = [str(node), str(checkout / 'openclaw.mjs'), '--profile', 'update-git-root-proof', 'update', 'status', '--json', '--timeout', '3']
receipt = {'head': head, 'buildStamp': stamp, 'collectorSHA256': sha256(Path(__file__).read_bytes()), 'sourceHashes': source_hashes, 'expectation': expectation, 'entry': 'Normal openclaw.mjs --profile update-git-root-proof update status --json --timeout 3', 'boundary': 'Real CLI installation discovery -> real Git --show-toplevel -> canonical update.installKind and actual git SHA in JSON stdout', 'checkoutPath': str(checkout), 'nativeGitTopLevel': {'command': ['git', '-C', str(checkout), 'rev-parse', '--show-toplevel'], 'stdoutHex': raw_top.hex(), 'stdoutSHA256': sha256(raw_top)}, 'result': 'RUNNING'}
(output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
try:
    started = time.monotonic()
    process = subprocess.Popen(command, cwd=checkout, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    killed = False
    try:
        stdout, stderr = process.communicate(timeout=35)
    except subprocess.TimeoutExpired:
        killed = True
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate()
    (output / 'stdout.txt').write_bytes(stdout)
    (output / 'stderr.txt').write_bytes(stderr)
    receipt.update({'command': command, 'exitCode': process.returncode, 'seconds': round(time.monotonic()-started, 3), 'watchdogKill': killed, 'configUnchanged': sha256(config.read_bytes()) == config_before, 'stdoutSHA256': sha256(stdout), 'stderrSHA256': sha256(stderr), 'stdout': stdout.decode(errors='replace'), 'stderr': stderr.decode(errors='replace')})
    assert not killed and receipt['configUnchanged'], 'CLI failed to settle or modified isolated input config'
    payload = json.loads(stdout)
    update = payload['update']
    receipt['observation'] = {'root': update.get('root'), 'installKind': update.get('installKind'), 'gitSha': update.get('git', {}).get('sha'), 'packageManager': update.get('packageManager'), 'registry': update.get('registry'), 'inspectionErrors': payload.get('inspectionErrors', [])}
    assert process.returncode == 0, receipt['observation']
    assert Path(update['root']).resolve() == checkout, receipt['observation']
    if expectation == 'red':
        assert update['installKind'] == 'package' and 'git' not in update, receipt['observation']
        receipt['result'] = 'RED_REAL_GIT_CHECKOUT_MISCLASSIFIED_AS_PACKAGE'
    else:
        assert update['installKind'] == 'git' and update['git']['sha'] == head, receipt['observation']
        receipt['result'] = 'GREEN_CONTROL' if expectation == 'control' else 'GREEN_REAL_GIT_CHECKOUT_RETAINED'
except Exception as error:
    receipt['result'] = 'BLOCKED_OR_UNEXPECTED'
    receipt['error'] = repr(error)
    raise
finally:
    receipt['limitations'] = ['No update/install/checkout/service mutation requested; this validates read-only installation classification, not real update completion or updater Git-metadata paths.', 'The default public npm registry diagnostic and closed isolated Gateway inspection are separate observations and are not claimed as successful live provider/channel verification.', 'Collector uses an actual physical checkout name; symlink aliases alone do not reproduce the path loss.', 'No Windows filesystem or live production Gateway proof.']
    receipt['cleanup'] = {'ownCLIWaited': True, 'isolatedConfigUnchanged': receipt.get('configUnchanged'), 'fixturesRetained': True, 'productionChannelsUntouched': True}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'result': receipt['result'], 'head': head, 'seconds': receipt.get('seconds'), 'observation': receipt.get('observation')}))
