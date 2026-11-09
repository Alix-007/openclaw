import email.parser
import email.policy
import hashlib
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import wave

checkout, output, node = (Path(value).resolve() for value in sys.argv[1:4])
expectation = sys.argv[4]
assert expectation in ('red', 'green')
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=checkout).strip()
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip()
script = checkout / 'skills/openai-whisper-api/scripts/transcribe.sh'
sha = lambda data: hashlib.sha256(data).hexdigest()
output.mkdir()
receipt = {'head': head, 'scriptSHA256': sha(script.read_bytes()), 'collectorSHA256': sha(Path(__file__).read_bytes()), 'expectation': expectation, 'entry': 'Actual bundled transcribe.sh via bash, normal curl executable, existing OPENAI_BASE_URL loopback compatible-endpoint option', 'boundary': 'Real multipart HTTP receiver -> response -> output-file readback; synthetic receiver only, no actual OpenAI transcription accuracy/service is claimed', 'cases': [], 'result': 'RUNNING'}
try:
    for kind in ['ordinary-control', 'model-alias-no-local-file', 'model-file-marker', 'language-file-marker', 'model-form-delimiter', 'literal-prompt-control']:
        case = output / kind
        case.mkdir()
        for name in ['home', 'tmp']:
            (case / name).mkdir()
        audio = case / 'input.wav'
        with wave.open(str(audio), 'wb') as stream:
            stream.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
            stream.writeframes(b'\0\0' * 80)
        audio_digest = sha(audio.read_bytes())
        private = case / 'synthetic-private-field.txt'
        marker = 'SYNTHETIC_PRIVATE_FIELD_MUST_NOT_BE_UPLOADED'
        private.write_text(marker)
        target = case / 'transcript.txt'
        target.write_text('original transcript')
        model = '@local/whisper' if kind == 'model-alias-no-local-file' else '@' + str(private) if kind == 'model-file-marker' else 'custom;type=application/json' if kind == 'model-form-delimiter' else 'gpt-4o-transcribe'
        language = '<' + str(private) if kind == 'language-file-marker' else 'en'
        prompt = '@' + str(case / 'nonexistent-literal-prompt') if kind == 'literal-prompt-control' else 'ordinary hint'
        calls = []
        class Receiver(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def do_POST(self):
                self.connection.settimeout(3)
                if self.headers.get('Transfer-Encoding', '').lower() == 'chunked':
                    chunks = []
                    complete = False
                    try:
                        while True:
                            line = self.rfile.readline(8192)
                            if not line:
                                break
                            count = int(line.split(b';', 1)[0].strip(), 16)
                            if count == 0:
                                while self.rfile.readline(8192).strip():
                                    pass
                                complete = True
                                break
                            data = self.rfile.read(count)
                            chunks.append(data)
                            if len(data) != count or self.rfile.read(2) != b'\r\n':
                                break
                    except (TimeoutError, ConnectionResetError):
                        pass
                    body = b''.join(chunks)
                    if not complete:
                        calls.append({'method': 'POST', 'path': self.path, 'complete': False, 'rawBodySHA256': sha(body), 'syntheticPrivateBytesObserved': marker.encode() in body})
                        return
                else:
                    body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                parsed = email.parser.BytesParser(policy=email.policy.default).parsebytes(('Content-Type: ' + self.headers['Content-Type'] + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
                parts = [{'name': p.get_param('name', header='content-disposition'), 'filename': p.get_filename(), 'contentType': p.get_content_type(), 'text': p.get_payload(decode=True).decode(errors='replace') if p.get_filename() is None else None, 'bodySHA256': sha(p.get_payload(decode=True))} for p in parsed.iter_parts()]
                calls.append({'method': 'POST', 'path': self.path, 'complete': True, 'parts': parts, 'rawBodySHA256': sha(body), 'syntheticPrivateBytesObserved': marker.encode() in body})
                response = b'{"text":"synthetic transcription readback"}'
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)
            def log_message(self, *_args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        command = ['bash', str(script), str(audio), '--model', model, '--language', language, '--prompt', prompt, '--out', str(target)]
        environment = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(case / 'home'), 'TMPDIR': str(case / 'tmp'), 'OPENAI_API_KEY': 'synthetic-local-transcription-token', 'OPENAI_BASE_URL': 'http://127.0.0.1:' + str(server.server_port) + '/v1'}
        started = time.monotonic()
        try:
            process = subprocess.run(command, cwd=case, env=environment, capture_output=True, timeout=15)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        row = {'label': kind, 'command': command, 'exitCode': process.returncode, 'seconds': round(time.monotonic() - started, 3), 'calls': calls, 'stdout': process.stdout.decode(errors='replace'), 'stderr': process.stderr.decode(errors='replace'), 'outputReadback': target.read_text(), 'inputUnchanged': sha(audio.read_bytes()) == audio_digest, 'privateFixtureUnchanged': private.read_text() == marker}
        receipt['cases'].append(row)
        if kind == 'model-alias-no-local-file' and expectation == 'red':
            assert process.returncode == 26 and not any(call['complete'] for call in calls) and row['outputReadback'] == 'original transcript', row
            row['result'] = 'RED_MODEL_ALIAS_OPENED_AS_LOCAL_FILE_BEFORE_HTTP'
            continue
        assert process.returncode == 0 and len(calls) == 1 and calls[0]['path'] == '/v1/audio/transcriptions', row
        assert row['inputUnchanged'] and row['privateFixtureUnchanged'], row
        parts = {part['name']: part for part in calls[0]['parts']}
        assert parts['file']['bodySHA256'] == audio_digest, row
        literal = parts['model']['text'] == model and parts['language']['text'] == language
        assert parts['prompt']['text'] == prompt, row
        if kind.endswith('control') or expectation == 'green':
            assert literal and not calls[0]['syntheticPrivateBytesObserved'], row
            if model.startswith('gpt-4o-transcribe'):
                assert row['outputReadback'] == 'synthetic transcription readback', row
            else:
                assert json.loads(row['outputReadback'])['text'] == 'synthetic transcription readback', row
            row['result'] = 'GREEN_CONTROL' if kind.endswith('control') else 'GREEN'
        else:
            assert not literal, row
            if kind.endswith('file-marker'):
                assert calls[0]['syntheticPrivateBytesObserved'], row
            row['result'] = 'RED_TEXT_FIELD_PARSED_AS_CURL_FORM_SYNTAX'
    receipt['result'] = 'RED_WITH_LEGAL_CONTROLS' if expectation == 'red' else 'GREEN'
except Exception as error:
    receipt['result'] = 'BLOCKED_OR_UNEXPECTED'
    receipt['error'] = repr(error)
    raise
finally:
    receipt['cleanup'] = {'isolatedFilesOnly': True, 'ownedReceiverJoined': True, 'noRealProviderOrChannelRequests': True, 'syntheticCredentialOnly': True, 'fixturesRetained': True}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
