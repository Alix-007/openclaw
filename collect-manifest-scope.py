#!/usr/bin/env python3
"""Exercise shipped manifest commands and read back their real gzip/JSON outputs."""
import argparse
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--checkout', type=Path, required=True)
parser.add_argument('--node', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
checkout, node, out = args.checkout.resolve(), args.node.resolve(), args.out.resolve()
out.mkdir(parents=True, exist_ok=False)
scratch = out / 'scratch'
home = out / 'home'
scratch.mkdir()
home.mkdir()
script = checkout / 'extensions/knowledge/skills/knowledge-source-ingest/scripts/source-manifest.mjs'
environment = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(home),
               'TMPDIR': str(scratch), 'TMP': str(scratch), 'TEMP': str(scratch), 'LANG': 'C.UTF-8'}
commands = []

def run(arguments):
    result = subprocess.run([str(node), str(script), *map(str, arguments)], cwd=out,
                            env=environment, text=True, capture_output=True, timeout=15)
    commands.append({'argv': [str(node), str(script), *map(str, arguments)],
                     'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    assert result.returncode == 0, commands[-1]

def snapshot(name, rows, start, end, observed, completeness='complete'):
    source = out / (name + '.jsonl')
    destination = out / (name + '.manifest.jsonl.gz')
    source.write_text(''.join(json.dumps(row) + '\n' for row in rows))
    run(['snapshot', '--provider', 'fixture', '--source-key', 'fixture:overlap',
         '--coverage-start', start, '--coverage-end', end, '--observed-at', observed,
         '--completeness', completeness, '--input', source, '--output', destination])
    with gzip.open(destination, 'rt') as handle:
        retained = [json.loads(line) for line in handle if line.strip()]
    assert retained[0]['item_count'] == len(rows)
    assert {row['id'] for row in retained[1:]} == {row['id'] for row in rows}
    return destination

prior_rows = [
    {'id': 'before-window', 'occurred_at': '2026-11-01T23:59:59.999999999Z'},
    {'id': 'at-start', 'occurred_at': '2026-11-02T00:00:00.000000000Z'},
    {'id': 'inside-window', 'occurred_at': '2026-11-02T12:00:00Z'},
    {'id': 'at-end', 'occurred_at': '2026-11-03T00:00:00.000000000Z'},
    {'id': 'after-window', 'occurred_at': '2026-11-03T00:00:00.000000001Z'},
    {'id': 'undated'},
    {'id': 'retained', 'occurred_at': '2026-11-02T13:00:00Z'},
]
for row in prior_rows:
    row['payload'] = {'text': 'synthetic ' + row['id']}
prior = snapshot('prior', prior_rows, '2026-11-01T00:00:00Z', '2026-11-04T00:00:00Z',
                 '2026-11-05T00:00:00Z')
current_rows = [prior_rows[-1], {'id': 'added', 'occurred_at': '2026-11-02T14:00:00Z',
                               'payload': {'text': 'synthetic added'}}]
plans, comparisons = {}, {}
for completeness in ('partial', 'unknown', 'complete'):
    current = snapshot(completeness, current_rows, '2026-11-02T00:00:00Z',
                       '2026-11-03T00:00:00Z', '2026-11-06T00:00:00Z', completeness)
    output = out / (completeness + '.plan.json')
    run(['plan', '--current', current, '--previous', prior, '--output', output])
    plans[completeness] = json.loads(output.read_text())
    expected = {'added': ['added'], 'changed': [], 'unchanged': ['retained'],
                'deleted': ['at-start', 'inside-window'] if completeness == 'complete' else [],
                'unresolved_missing': ['undated'] if completeness == 'complete'
                                      else ['at-start', 'inside-window', 'undated']}
    comparisons[completeness] = {'expected': expected,
                                'actual': plans[completeness]['items'],
                                'pass': expected == plans[completeness]['items']}
    assert plans[completeness]['items']['added'] == ['added']
    assert plans[completeness]['items']['unchanged'] == ['retained']
    assert plans[completeness]['items']['changed'] == []
    assert plans[completeness]['items']['deleted'] == expected['deleted']
assert not list(scratch.iterdir()), list(scratch.iterdir())
receipt = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip(),
           'tracked_status': subprocess.check_output(['git', 'status', '--porcelain', '-uno'], cwd=checkout, text=True),
           'source_sha256': hashlib.sha256(script.read_bytes()).hexdigest(),
           'collector_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
           'node_version': subprocess.check_output([str(node), '--version'], text=True).strip(),
           'node_sha256': hashlib.sha256(node.read_bytes()).hexdigest(),
           'commands': commands, 'comparisons': comparisons, 'scratch_remaining': [],
           'pass': all(c['pass'] for c in comparisons.values())}
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({key: receipt[key] for key in ('head', 'source_sha256', 'collector_sha256', 'comparisons', 'pass')}, indent=2))
