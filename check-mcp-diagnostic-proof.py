import argparse,json,pathlib,hashlib,re
p=argparse.ArgumentParser();p.add_argument('receipt');p.add_argument('--expect',choices=['red','green'],required=True);a=p.parse_args();file=pathlib.Path(a.receipt);r=json.loads(file.read_text());assert r['collectorSHA256']=='9db9bdb63092be935a90afa14c646bd99b21fc496054d5262fbc275a73d788de';assert r['trackedCleanAfter'] and r['buildStamp']['inputsClean'] and r['buildStamp']['head']==r['head'];expected=['probe-normal','probe-error','doctor-static','probe-int','probe-term-human','doctor-int','configure-success','configure-error'];assert [x['case'] for x in r['rows']]==expected
rows=[]
for c in r['rows']:
 name=c['case'];assert not c['harnessWatchdog'];folder=file.parent/name;terminal=(folder/'terminal.bin').read_bytes();assert hashlib.sha256(terminal).hexdigest()==c['terminalSHA256'];events=c['observedEvents'];init=[e for e in events if e['kind']=='request' and e.get('method')=='initialize'];s=terminal.decode('utf8').replace('\r','');assert c['command'][1].endswith('/openclaw.mjs')
 if name in ['probe-int','probe-term-human','doctor-int']:
  assert len(init)==1 and c['interruptToExitSeconds'] is not None;assert 'Command interrupted by SIG' in s;assert c['configUnchanged']
  if a.expect=='red':assert c['exitCode']==-9
  else:
   assert c['exitCode']==(143 if name=='probe-term-human' else 130);assert c['interruptToExitSeconds']<1.5 and not c['providerAliveAtCliExit'] and not c['harnessPostObservationCleanup'];assert not any(x in s for x in ['"servers"','"diagnostics"','"ok"','MCP check failed','MCP doctor found errors','MCP check (','MCP doctor ('])
 elif name=='doctor-static':assert c['exitCode']==0 and not c['providerPids'] and not events and c['configUnchanged'];obj=json.JSONDecoder().raw_decode(s)[0];assert obj['ok'] is True
 elif name in ['probe-normal','configure-success']:
  assert c['exitCode']==0 and len(init)==1 and any(e.get('method')=='tools/list' for e in events)
  if name=='probe-normal':assert c['configUnchanged'];obj=json.JSONDecoder().raw_decode(s[s.index('{'):])[0];assert obj['servers']['fixture']['tools']==1 and obj['diagnostics']==[]
  else:assert not c['configUnchanged'] and c['configReadback']['mcp']['servers']['fixture']['requestTimeoutMs']==61000 and 'Updated MCP server' in s
 else:assert c['exitCode']==1 and len(init)==1 and c['configUnchanged']
 rows.append({'case':name,'result':'EXPECTED_RED' if name in ['probe-int','probe-term-human','doctor-int'] and a.expect=='red' else 'PASS'})
print(json.dumps({'head':r['head'],'expected':a.expect,'result':'BASE3RED_CONTROLS5PASS' if a.expect=='red' else 'GREEN8PASS','rows':rows}))
