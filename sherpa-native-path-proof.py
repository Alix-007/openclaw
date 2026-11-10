#!/usr/bin/env python3
"""Replay wrapper-owned runtime/model directory paths at one clean Git head."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import wave
from datetime import datetime, timezone
from pathlib import Path

TASK_ROOT = Path(__file__).resolve().parent
OWNER = 'skills/sherpa-onnx-tts/bin/sherpa-onnx-tts'
ENV_KEYS = {
    'runtime-dir': 'SHERPA_ONNX_RUNTIME_DIR',
    'model-dir': 'SHERPA_ONNX_MODEL_DIR',
}
RESOURCES = {
    'runtime': {
        'archive': 'sherpa-onnx-v1.13.8-linux-x64-shared.tar.bz2',
        'sha256': 'c0bdb7907d3a74bba1d55d22bf4d9fa75586cf1530614ebe88a27b9118e015c4',
        'directory': 'sherpa-onnx-v1.13.8-linux-x64-shared',
    },
    'model': {
        'archive': 'vits-piper-en_US-lessac-high.tar.bz2',
        'sha256': '8619d204c7005866fe4f420181dfa79622af6a6222389f0b0818d2af31e0db0e',
        'directory': 'vits-piper-en_US-lessac-high',
    },
}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(checkout, *args):
    env = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1'}
    return subprocess.run(['git', *args], cwd=checkout, env=env,
                          check=True, capture_output=True).stdout

def checkout_binding(checkout):
    head = git(checkout, 'rev-parse', 'HEAD').decode().strip()
    tree = git(checkout, 'rev-parse', 'HEAD^{tree}').decode().strip()
    tracked_status = git(checkout, 'status', '--porcelain=v1', '--untracked-files=no').decode()
    if tracked_status:
        raise RuntimeError('Checkout has tracked changes; no exact-head proof can run')
    files = {}
    for relative in ['package.json', OWNER, 'skills/sherpa-onnx-tts/SKILL.md']:
        actual = (checkout / relative).read_bytes()
        committed = git(checkout, 'show', f'{head}:{relative}')
        if actual != committed:
            raise RuntimeError(f'Worktree bytes do not match HEAD: {relative}')
        files[relative] = {
            'git_blob': git(checkout, 'rev-parse', f'{head}:{relative}').decode().strip(),
            'sha256': sha(actual), 'bytes': len(actual), 'matches_head': True,
        }
    return {'head': head, 'tree': tree, 'tracked_clean': True,
            'untracked_files_excluded': True, 'files': files}

def wave_readback(output):
    if not output.exists():
        return {'exists': False}
    data = output.read_bytes()
    result = {'exists': True, 'bytes': len(data), 'sha256': sha(data),
              'riff': data[:4].decode('ascii', errors='replace')}
    try:
        with wave.open(str(output), 'rb') as audio:
            frames = audio.readframes(audio.getnframes())
            result.update(channels=audio.getnchannels(), sample_width=audio.getsampwidth(),
                          sample_rate=audio.getframerate(), frames=audio.getnframes(),
                          duration_seconds=audio.getnframes()/audio.getframerate(),
                          contains_nonzero_pcm=any(frames))
        result['valid_pcm_wave'] = result['frames'] > 0 and result['contains_nonzero_pcm']
    except (wave.Error, EOFError) as error:
        result['valid_pcm_wave'] = False
        result['wave_error'] = str(error)
    return result

def expected_path_failure(field, altered_path, stderr):
    if field == 'runtime-dir':
        return f'TTS binary not found: {altered_path / "bin/sherpa-onnx-offline-tts"}' in stderr
    if field == 'model-dir':
        return stderr.startswith('Model directory is missing required files.')
    return False

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--expect', choices=['red', 'green'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--resources', type=Path, default=TASK_ROOT / 'native-sherpa')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    proof_root, source_root = args.output.resolve(), args.checkout.resolve()
    resource_root, node = args.resources.resolve(), args.node.resolve()
    receipt_path = proof_root / 'receipt.json'
    receipt = {
        'started_at': datetime.now(timezone.utc).isoformat(), 'expect': args.expect,
        'status': 'BLOCKED_SETUP', 'verdict': 'FAIL', 'source_root': str(source_root),
        'collector_sha256': sha(Path(__file__).read_bytes()), 'node': str(node),
        'contract': {
            'id': 'wrapper-runtime-and-model-directories-v3',
            'path_probes': 4, 'controls': 3,
            'covered': ['runtime-dir via flags/env', 'model-dir via flags/env'],
            'excluded': 'Trailing whitespace on explicit model-file, tokens-file and data-dir values is trimmed by the native Sherpa parser even when the wrapper forwards it. These six historical failed HEAD scenes remain retained, not relabeled PASS. No workaround or fix for them is claimed.',
        },
        'proof_boundary': 'clean exact-head bundled Node wrapper -> official native sherpa-onnx-offline-tts -> WAV file -> Python PCM readback; offline synthetic text only',
        'text': 'OpenClaw path proof.', 'resources': {}, 'cases': [],
    }
    lock_path, lock_owned = resource_root / '.path-proof-active.lock', False
    def save():
        receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    try:
        receipt['source_before'] = checkout_binding(source_root)
        receipt['product_head'] = receipt['source_before']['head']
        receipt['product_tree'] = receipt['source_before']['tree']
        receipt['node_version'] = subprocess.run([str(node), '--version'], check=True,
                                                capture_output=True, text=True).stdout.strip()
        resource_root.mkdir(parents=True, exist_ok=True)
        lock_fd = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        lock_owned = True
        with os.fdopen(lock_fd, 'w') as lock:
            lock.write(str(os.getpid()) + '\n')
        paths = {}
        for kind, spec in RESOURCES.items():
            archive = resource_root / spec['archive']
            actual_hash = sha(archive.read_bytes())
            if actual_hash != spec['sha256']:
                raise RuntimeError(f'Official {kind} archive digest mismatch')
            directory = resource_root / kind / spec['directory']
            if not directory.is_dir():
                raise RuntimeError(f'Missing extracted {kind} directory')
            paths[kind] = directory
            receipt['resources'][kind] = {
                'archive': spec['archive'], 'bytes': archive.stat().st_size,
                'sha256': actual_hash, 'expected_sha256': spec['sha256'],
                'digest_matches': True, 'directory': str(directory),
            }
        runtime, model = paths['runtime'], paths['model']
        model_files = list(model.glob('*.onnx'))
        if len(model_files) != 1:
            raise RuntimeError('Documented native fixture must have exactly one ONNX model')
        targets = {
            'runtime-dir': runtime, 'model-dir': model,
        }
        for target in [*targets.values(), model_files[0], model / 'tokens.txt',
                       model / 'espeak-ng-data', runtime / 'bin/sherpa-onnx-offline-tts']:
            if not target.exists():
                raise RuntimeError(f'Missing native fixture resource: {target}')
        base_env = {k:v for k,v in os.environ.items() if not k.startswith('SHERPA_ONNX_')}
        base_env.update(HOME=str(proof_root/'home'), XDG_CACHE_HOME=str(proof_root/'cache'),
                        OMP_NUM_THREADS='1')
        Path(base_env['HOME']).mkdir()
        wrapper = source_root / OWNER
        def run_case(name, style='flags', padded=None, output_padded=False):
            output = proof_root / (name + (' .wav' if output_padded else '.wav'))
            active, renamed = dict(targets), None
            if padded:
                original = targets[padded]
                padded_path = original.with_name(original.name + ' ')
                if padded_path.exists():
                    raise RuntimeError(f'Fixture padded path already exists: {padded_path}')
                original.rename(padded_path)
                renamed, active[padded] = (padded_path, original), padded_path
            env, command = dict(base_env), [str(node), str(wrapper)]
            try:
                selected_exists = bool(active[padded].exists()) if padded else True
                altered_path = Path(str(active[padded]).strip()) if padded else None
                altered_exists = altered_path.exists() if padded else None
                if padded and (not selected_exists or altered_exists):
                    raise RuntimeError('Fixture does not isolate the intended literal path boundary')
                fields = ['runtime-dir', 'model-dir']
                for field in fields:
                    if style == 'flags':
                        command += ['--' + field, str(active[field])]
                    else:
                        env[ENV_KEYS[field]] = str(active[field])
                command += ['--output', str(output), receipt['text']]
                started = time.monotonic()
                try:
                    process = subprocess.run(command, env=env, cwd=proof_root,
                                             capture_output=True, timeout=45)
                    stdout, stderr, code = process.stdout, process.stderr, process.returncode
                    timed_out = False
                except subprocess.TimeoutExpired as error:
                    stdout, stderr, code = error.stdout or b'', error.stderr or b'', None
                    timed_out = True
                elapsed = round(time.monotonic() - started, 4)
                for stream, data in [('stdout', stdout), ('stderr', stderr)]:
                    (proof_root / (name + '.' + stream)).write_bytes(data)
                wave_result = wave_readback(output)
                stderr_text = stderr.decode('utf-8', errors='replace')
                observation = {
                    'name': name, 'style': style, 'padded_input': padded,
                    'command': command,
                    'selected_env': {k:env[k] for k in ENV_KEYS.values() if k in env},
                    'path_exists_before_call': selected_exists,
                    'trimmed_neighbor_exists': altered_exists,
                    'exit_code': code, 'timed_out': timed_out, 'elapsed_seconds': elapsed,
                    'stdout_file': name + '.stdout', 'stdout_sha256': sha(stdout),
                    'stderr_file': name + '.stderr', 'stderr_sha256': sha(stderr),
                    'stderr_tail': stderr_text[-1800:], 'wave': wave_result,
                    'acceptance': code == 0 and bool(wave_result.get('valid_pcm_wave')),
                    'expected_path_failure': bool(padded and not timed_out and code == 1
                        and not wave_result['exists']
                        and expected_path_failure(padded, altered_path, stderr_text)),
                }
                receipt['cases'].append(observation)
                save()
                print(json.dumps({k:observation[k] for k in ['name','exit_code','elapsed_seconds','acceptance','expected_path_failure','wave']}), flush=True)
                return observation
            finally:
                if renamed:
                    renamed[0].rename(renamed[1])
        receipt['status'] = 'RUNNING'
        for name, style in [('ordinary-flags-control','flags'), ('ordinary-env-control','env')]:
            if not run_case(name, style)['acceptance']:
                receipt['status'] = 'BLOCKED_NATIVE_CONTROL'
                return 1
        for field in ENV_KEYS:
            for style in ['flags', 'env']:
                run_case(f'{field}-{style}-trailing-space', style, field)
        run_case('literal-output-path-control', output_padded=True)
        receipt['source_after'] = checkout_binding(source_root)
        if receipt['source_before'] != receipt['source_after']:
            raise RuntimeError('Checkout binding changed during native proof')
        controls = [c for c in receipt['cases'] if not c['padded_input']]
        probes = [c for c in receipt['cases'] if c['padded_input']]
        controls_pass = len(controls) == 3 and all(c['acceptance'] for c in controls)
        red = len(probes) == 4 and all(c['expected_path_failure'] for c in probes)
        green = len(probes) == 4 and all(c['acceptance'] for c in probes)
        receipt['summary'] = {
            'total': len(receipt['cases']), 'controls': len(controls),
            'passing_controls': sum(c['acceptance'] for c in controls),
            'path_probes': len(probes), 'specific_path_failures': sum(c['expected_path_failure'] for c in probes),
            'successful_path_probes': sum(c['acceptance'] for c in probes),
            'native_elapsed_seconds_sum': round(sum(c['elapsed_seconds'] for c in receipt['cases']),4),
        }
        receipt['status'] = 'RED' if controls_pass and red else 'GREEN' if controls_pass and green else 'MISMATCH'
        receipt['verdict'] = 'PASS' if receipt['status'].lower() == args.expect else 'FAIL'
        return 0 if receipt['verdict'] == 'PASS' else 1
    except Exception as error:
        receipt['error'] = {'type': type(error).__name__, 'message': str(error)}
        if receipt['status'] == 'RUNNING':
            receipt['status'] = 'BLOCKED_EXECUTION'
        return 1
    finally:
        if lock_owned:
            lock_path.unlink()
        receipt['finished_at'] = datetime.now(timezone.utc).isoformat()
        receipt['cleanup'] = 'Temporarily renamed resource entries restored in finally blocks; exclusive resource lock released. Isolated logs and WAVs intentionally retained. No product source, Git refs/index/worktree, production configuration, channel, account or system installation changed.'
        save()
        print(json.dumps({'status':receipt['status'], 'verdict':receipt['verdict'],
                          'head':receipt.get('product_head'), 'receipt':str(receipt_path)}),flush=True)

if __name__ == '__main__':
    sys.exit(main())
