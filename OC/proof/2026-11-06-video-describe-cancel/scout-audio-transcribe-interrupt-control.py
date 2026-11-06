#!/usr/bin/env python3
"""External native discovery only: normal CLI, real PTY VINTR, loopback HTTP."""
import base64
import wave
import io
from email.parser import BytesParser
from email import policy
import errno
import hashlib
import http.server
import json
import os
import pathlib
import pty
import select
import signal
import subprocess
import sys
import threading
import time

checkout = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]).resolve()
node = pathlib.Path(sys.argv[3]).resolve()
assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=checkout).strip() == b''
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip()
build = json.loads((checkout / 'dist/.buildstamp').read_text())
assert build['head'] == head and build['inputsClean'] is True
out.mkdir()
for name in ['home', 'state', 'workspace', 'tmp']:
    (out / name).mkdir()
audio = io.BytesIO()
with wave.open(audio, 'wb') as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(b'\0' * 16000)
video = audio.getvalue()
video_path = out / 'clip.wav'
video_path.write_bytes(video)
sha = lambda data: hashlib.sha256(data).hexdigest()
receipt = {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'head': head, 'buildStamp': build,
           'collectorSha256': sha(pathlib.Path(__file__).read_bytes()), 'entry': 'openclaw.mjs',
           'boundary': 'Normal shipped CLI in controlling PTY -> OpenAI real HTTP multipart upload -> OS VINTR/SIGINT -> process status and passive peer-close recorder',
           'noRespawnOverride': False, 'videoBytes': len(video), 'videoSha256': sha(video), 'cases': [], 'result': 'RUNNING'}
active = None
lock = threading.Lock()
def save():
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        started = time.monotonic()
        body = self.rfile.read(int(self.headers.get('content-length', '0')))
        multipart = BytesParser(policy=policy.default).parsebytes(('Content-Type: ' + self.headers['content-type'] + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
        fields = {part.get_param('name', header='content-disposition'): part for part in multipart.iter_parts()}
        uploaded = fields['file'].get_payload(decode=True)
        model = fields['model'].get_payload(decode=True).decode()
        row = {'path': self.path, 'method': 'POST', 'receivedAt': time.time(), 'receivedMonotonic': started,
               'headers': {k: ('[SYNTHETIC_AUTH_REDACTED]' if k.lower() == 'authorization' else v) for k,v in self.headers.items()},
               'authMatchesSynthetic': self.headers.get('authorization') == 'Bearer synthetic-video-proof-key',
               'bodySha256': sha(body), 'model': model, 'videoBytes': len(uploaded), 'videoSha256': sha(uploaded),
               'prompt': None, 'responseCompleted': False, 'peerClosed': False}
        assert self.path == '/v1/audio/transcriptions'
        assert uploaded == video and row['authMatchesSynthetic']
        with lock:
            current = active
            current['requests'].append(row)
            current['requestReceived'].set()
        deadline = started + current['delaySeconds']
        while time.monotonic() < deadline:
            readable, _, _ = select.select([self.connection], [], [], max(0, min(0.05, deadline - time.monotonic())))
            if readable and self.connection.recv(1, __import__('socket').MSG_PEEK) == b'':
                row['peerClosed'] = True
                row['peerClosedMonotonic'] = time.monotonic()
                row['peerClosedAt'] = time.time()
                return
        payload = json.dumps({'text': 'Synthetic audio transcript.'}).encode()
        try:
            self.send_response(200)
            self.send_header('content-type', 'application/json')
            self.send_header('content-length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            self.wfile.flush()
            row['responseCompleted'] = True
            row['responseCompletedAt'] = time.time()
        except (BrokenPipeError, ConnectionResetError):
            row['peerClosed'] = True
            row['peerClosedMonotonic'] = time.monotonic()
            row['peerClosedAt'] = time.time()

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
server.daemon_threads = False
thread = threading.Thread(target=server.serve_forever)
thread.start()
origin = f'http://127.0.0.1:{server.server_port}/v1'
cfg = {'gateway': {'mode': 'local'},
       'agents': {'defaults': {'workspace': str(out / 'workspace')}, 'entries': {'main': {}}},
       'models': {'providers': {'openai': {'baseUrl': origin, 'apiKey': 'synthetic-video-proof-key', 'api': 'openai-completions', 'models': [], 'request': {'allowPrivateNetwork': True}}}},
       'tools': {'media': {'models': [{'provider': 'openai', 'model': 'gpt-4o-transcribe', 'capabilities': ['audio']}], 'audio': {'enabled': True}}}}
config = out / 'config.json'
config.write_text(json.dumps(cfg))
config.chmod(0o600)
config_before = sha(config.read_bytes())
env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(out / 'home'), 'USERPROFILE': str(out / 'home'),
       'OPENCLAW_STATE_DIR': str(out / 'state'), 'OPENCLAW_CONFIG_PATH': str(config), 'TMPDIR': str(out / 'tmp'),
       'NO_COLOR': '1', 'TERM': 'xterm-256color'}
command = [str(node), str(checkout / 'openclaw.mjs'), 'infer', 'audio', 'transcribe', '--file', str(video_path), '--agent', 'main', '--model', 'openai/gpt-4o-transcribe', '--json']
def run(label, interrupt):
    global active
    active = {'label': label, 'requests': [], 'requestReceived': threading.Event(), 'delaySeconds': 10 if interrupt else 0.2}
    current = active
    started = time.monotonic()
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(checkout)
        os.execve(str(node), command, env)
    output = bytearray()
    sent = None
    safety = False
    status = None
    eof = False
    process_before = None
    while time.monotonic() - started < 35:
        now = time.monotonic()
        if interrupt and sent is None and current['requests'] and now - current['requests'][0]['receivedMonotonic'] >= 0.5:
            foreground = os.tcgetpgrp(master)
            stat = pathlib.Path(f'/proc/{pid}/status').read_text()
            process_before = {'pid': pid, 'foregroundProcessGroup': foreground, 'status': stat,
                              'children': pathlib.Path(f'/proc/{pid}/task/{pid}/children').read_text().strip()}
            sent = now
            os.write(master, b'\x03')
        ready, _, _ = select.select([master], [], [], 0.03)
        if ready:
            try:
                data = os.read(master, 65536)
                if data: output.extend(data)
                else: eof = True
            except OSError as error:
                if error.errno != errno.EIO: raise
                eof = True
        if status is None:
            got, value = os.waitpid(pid, os.WNOHANG)
            if got:
                status = value
                exited = time.monotonic()
        if status is not None and eof: break
    if status is None:
        safety = True
        os.killpg(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
        exited = time.monotonic()
    os.close(master)
    time.sleep(0.1)
    row = {'label': label, 'command': command, 'normalLauncherEnvironment': True,
           'seconds': round(exited-started, 4), 'exitCode': os.waitstatus_to_exitcode(status),
           'signalNumber': os.WTERMSIG(status) if os.WIFSIGNALED(status) else None,
           'safetyKill': safety, 'ptyEofDrained': eof, 'interruptSent': sent is not None,
           'interruptToExitMs': round(1000*(exited-sent), 2) if sent else None,
           'interruptToPeerCloseMs': [round(1000*(q['peerClosedMonotonic']-sent), 2) if sent and q.get('peerClosedMonotonic') else None for q in current['requests']],
           'output': output.decode(errors='replace'), 'processBeforeInterrupt': process_before,
           'requests': current['requests']}
    (out / f'{label}.pty.log').write_bytes(output)
    receipt['cases'].append(row)
    save()
    assert not safety and eof, 'No native verdict on a harness kill or undrained PTY'
    assert len(current['requests']) == 1, 'Expected one actual video provider POST'
    return row

try:
    control = run('uninterrupted-control', False)
    assert control['exitCode'] == 0 and control['requests'][0]['responseCompleted']
    assert 'Synthetic audio transcript.' in control['output'] and 'audio.transcribe' in control['output']
    canceled = run('real-pty-interrupt', True)
    assert canceled['interruptSent'] and canceled['requests'][0]['peerClosed']
    assert not canceled['requests'][0]['responseCompleted']
    assert 'Synthetic audio transcript.' not in canceled['output']
    assert canceled['exitCode'] == 130 and canceled['signalNumber'] is None, 'Existing audio owner should cancel cooperatively'
    receipt['result'] = 'PASS_AUDIO_SIBLING_NATIVE_CANCEL_CONTROL'
    receipt['configUnchanged'] = sha(config.read_bytes()) == config_before
    receipt['sourceStatusAfter'] = subprocess.check_output(['git', 'status', '--porcelain'], cwd=checkout, text=True)
    assert receipt['configUnchanged'] and receipt['sourceStatusAfter'] == ''
except BaseException as error:
    receipt['result'] = 'BLOCKED_OR_FAILED_SETUP'
    receipt['error'] = repr(error)
    raise
finally:
    server.shutdown()
    server.server_close()
    thread.join()
    receipt['cleanup'] = {'httpServerStopped': True, 'directCliProcessesWaited': True, 'productionServicesTouched': False, 'externalModelOrChannelCalls': False, 'syntheticStateRetained': True}
    save()
print(json.dumps({'head': head, 'result': receipt['result'], 'cases': [{k:c[k] for k in ['label','seconds','exitCode','signalNumber','safetyKill','interruptToExitMs','interruptToPeerCloseMs']} for c in receipt['cases']]}, indent=2))
