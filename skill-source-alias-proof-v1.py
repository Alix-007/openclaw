"""Normal CLI source selection keeps no--as fallback naming stable."""
from pathlib import Path
import hashlib, json, subprocess, sys, time

w, out, node = map(lambda x: Path(x).resolve(), sys.argv[1:4])
mode = sys.argv[4]
assert mode in ('red', 'green')
out.mkdir()
sha = lambda value: hashlib.sha256(value).hexdigest()
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=w, text=True).strip()
stamp = json.loads((w / 'dist/.buildstamp').read_text())
assert stamp['head'] == head and stamp['inputsClean']
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=w).strip()
r = {'head': head, 'buildStamp': stamp, 'collectorSHA256': sha(Path(__file__).read_bytes()), 'mode': mode, 'cases': [], 'result': 'RUNNING'}
def save():
    (out / 'receipt.json').write_text(json.dumps(r, indent=2) + '\n')
try:
    for label, physical_name in [('invalid-physical-label', 'release.1'), ('valid-physical-label', 'different-name'), ('ordinary-control', 'ordinary-guide')]:
        fixture = out / label
        for leaf in ['home', 'state', 'workspace', 'tmp', 'fixtures']:
            (fixture / leaf).mkdir(parents=True)
        source = fixture / 'fixtures' / physical_name
        source.mkdir()
        markdown = '---\nname: Display name with spaces\ndescription: Synthetic naming control\n---\nSelected instructions\n'
        (source / 'SKILL.md').write_text(markdown)
        (source / 'asset.txt').write_text(label + '\n')
        selected = source if label == 'ordinary-control' else fixture / 'fixtures/my-guide'
        if selected != source:
            selected.symlink_to(source, target_is_directory=True)
        expected_slug = selected.name
        config = fixture / 'openclaw.json'
        config.write_text(json.dumps({'gateway': {'mode': 'local'}, 'agents': {'defaults': {'workspace': str(fixture / 'workspace')}, 'entries': {'main': {}}}, 'plugins': {'allow': [], 'slots': {'memory': 'none'}}}))
        config.chmod(0o600)
        env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(fixture / 'home'), 'OPENCLAW_STATE_DIR': str(fixture / 'state'), 'OPENCLAW_CONFIG_PATH': str(config), 'TMPDIR': str(fixture / 'tmp'), 'NO_COLOR': '1', 'OPENCLAW_NO_RESPAWN': '1'}
        command = [str(node), str(w / 'openclaw.mjs'), 'skills', 'install', str(selected), '--agent', 'main']
        start = time.monotonic()
        value = subprocess.run(command, cwd=w, env=env, capture_output=True, timeout=120)
        row = {'label': label, 'command': command, 'exitCode': value.returncode, 'seconds': round(time.monotonic() - start, 3), 'expectedSlug': expected_slug}
        for kind, content in [('stdout', value.stdout), ('stderr', value.stderr)]:
            (out / (label + '.' + kind)).write_bytes(content)
            row[kind] = content.decode(errors='replace')
            row[kind + 'SHA256'] = sha(content)
        r['cases'].append(row)
        save()
        installed = fixture / 'workspace/skills'
        if mode == 'red' and label == 'invalid-physical-label':
            assert value.returncode == 1 and 'Invalid skill slug' in row['stderr'], row
            assert not (installed / expected_slug).exists()
            row['readback'] = {'selectedAliasAbsent': True}
        else:
            assert value.returncode == 0, row
            slug = physical_name if mode == 'red' else expected_slug
            target = installed / slug
            assert (target / 'SKILL.md').read_text() == markdown
            assert (target / 'asset.txt').read_text() == label + '\n'
            origin = json.loads((target / '.openclaw/source-origin.json').read_text())
            assert origin['slug'] == slug and origin['spec'] == str(selected)
            if slug != expected_slug:
                assert not (installed / expected_slug).exists()
            row['readback'] = {'actualSlug': slug, 'path': str(target), 'instructionsSHA256': sha((target / 'SKILL.md').read_bytes()), 'assetSHA256': sha((target / 'asset.txt').read_bytes()), 'origin': origin}
        assert (source / 'SKILL.md').read_text() == markdown and (source / 'asset.txt').read_text() == label + '\n'
        save()
    r['result'] = 'GREEN3_DEFAULT_ALIASES_AND_CONTROL' if mode == 'green' else 'BASE_ALIAS_REJECTED_OR_RENAMED_ORDINARY_CONTROL_PASS'
except Exception as error:
    r['result'] = 'BLOCKED_OR_UNEXPECTED'
    r['error'] = repr(error)
    save()
    raise
finally:
    r['cleanup'] = {'productionStateTouched': False, 'externalNetwork': False, 'isolatedFixturesRetained': True}
    save()
