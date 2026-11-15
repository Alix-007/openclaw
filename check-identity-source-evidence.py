"""Verify the inspectable config/output readbacks, independently of CLI exit claims."""
from pathlib import Path
import hashlib,json,sys
r=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent
sha=lambda s:hashlib.sha256(s.encode()).hexdigest()
for mode in ['BASE','HEAD']:
 receipt=json.loads((r/(mode+'.json')).read_text());readbacks=json.loads((r/(mode+'-readbacks.json')).read_text());assert len(receipt['cases'])==len(readbacks)==20
 assert receipt['verdict']==('EXPECTED-RED' if mode=='BASE' else 'GREEN')
 for c in receipt['cases']:
  b=readbacks[c['label']];before=json.loads(b['beforeText']);after=json.loads(b['afterText']);assert sha(c['stdout'])==c['publicStdoutSHA256'] and sha(c['stderr'])==c['publicStderrSHA256']
  assert before['agents']['entries']['main']['workspace']==after['agents']['entries']['main']['workspace'] and before['agents']['entries']['other']['workspace']==after['agents']['entries']['other']['workspace']
  for name,value in b['sources'].items():assert sha(value['text'])==value['sha256'] and value['text'] in ['- Name: Selected physical identity\n','- Name: Wrong lexical neighbor\n','ordinary file\n']
  negative=c['role']=='refusal-control' or (mode=='HEAD' and c['role']=='regression-refusal')
  if negative:
   assert c['exitCode']!=0 and b['beforeText']==b['afterText'] and c['configBeforeSHA256']==c['configAfterSHA256']
  elif mode=='BASE' and c['role'].startswith('regression'):
   assert c['exitCode']==0 and any(e['identity']['name']=='Wrong lexical neighbor' for e in after['agents']['entries'].values())
  else:
   expected='Explicit unchanged' if c['form']=='no-import' else 'Selected physical identity'
   assert c['exitCode']==0 and after['agents']['entries']['main']['identity']['name']==expected and after['agents']['entries']['other']['identity']['name']=='Initial other'
base=json.loads((r/'BASE.json').read_text());head=json.loads((r/'HEAD.json').read_text());assert base['collectorSHA256']==head['collectorSHA256']==hashlib.sha256((r/'identity-source-proof-v1.py').read_bytes()).hexdigest()
print('PASS: both20case actual-output/config/source readbacks;11repaired cases,9controls; identical collector')
