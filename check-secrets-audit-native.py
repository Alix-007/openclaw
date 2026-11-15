#!/usr/bin/env python3
import argparse,pathlib,json,hashlib,re
p=argparse.ArgumentParser();p.add_argument('receipt');p.add_argument('--expect',choices=['red','green'],required=True);a=p.parse_args();file=pathlib.Path(a.receipt);r=json.loads(file.read_text());root=file.parent
assert len(r['rows'])==5 and [x['case'] for x in r['rows']]==['success','error','no-allow-exec','pending-int','pending-term']
assert r['trackedCleanBefore'] and r['trackedCleanAfter'] and r['buildStamp']['inputsClean'] and r['buildStamp']['head']==r['head']
assert r['collectorSHA256']=='939ba49b8ed68addbeda7ce3996f75dd25bcb593ddf491f47c912f141c3575b8'
result=[]
for x in r['rows']:
 name=x['case'];d=root/name;terminal=(d/'terminal.bin').read_bytes();assert hashlib.sha256(terminal).hexdigest()==x['terminalSHA256'];assert x['configUnchanged'];assert hashlib.sha256((d/'state/openclaw.json').read_bytes()).hexdigest()==x['configSHA256'];assert not x['harnessWatchdog'];assert x['command'][-1]=='--allow-exec' if name!='no-allow-exec' else x['command'][-1]=='--json'
 assert x['command'][1].endswith('/openclaw.mjs') and x['command'][2:5]==['secrets','audit','--json']
 s=terminal.decode('utf8').replace('\r','');events=x['eventsObserved'];requests=[e for e in events if e['kind']=='request']
 if name.startswith('pending'):
  signame='SIGINT' if name=='pending-int' else 'SIGTERM';assert 'Command interrupted by '+signame+'. Waiting for cleanup before exiting.' in s
  assert '"status"' not in s and '"ok"' not in s and 'Secrets audit:' not in s and 'Secrets audit failed:' not in s
  assert len(requests)==1 and requests[0]['ids']==['synthetic']
  if a.expect=='red':assert x['exitCode']==-9 and x['providerAliveAtCliExit']==x['providerPids'] and x['harnessPostObservationCleanup']
  else:assert x['exitCode']==(130 if signame=='SIGINT' else 143) and not x['providerAliveAtCliExit'] and not x['harnessPostObservationCleanup'] and x['interruptToExitSeconds']<1.5
 else:
  obj=json.JSONDecoder().raw_decode(s)[0]
  if name=='success':assert x['exitCode']==0 and obj['status']=='clean' and obj['resolution']=={'refsChecked':1,'skippedExecRefs':0,'resolvabilityComplete':True} and len(requests)==1
  elif name=='error':assert x['exitCode']==2 and obj['status']=='unresolved' and obj['summary']['unresolvedRefCount']==1 and len(requests)==1 and 'exited with code 7' in obj['findings'][0]['message']
  else:assert x['exitCode']==0 and obj['status']=='clean' and obj['resolution']=={'refsChecked':0,'skippedExecRefs':1,'resolvabilityComplete':False} and not requests and not x['providerPids']
 result.append({'case':name,'result':'RED' if name.startswith('pending') and a.expect=='red' else 'PASS'})
print(json.dumps({'expected':a.expect,'head':r['head'],'cells':result,'result':'EXPECTED_BASE_RED_WITH_CONTROLS' if a.expect=='red' else 'PASS'}))
