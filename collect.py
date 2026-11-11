import hashlib,json,os,pathlib,queue,select,signal,subprocess,sys,threading,time
checkout,output,node=(pathlib.Path(value).resolve() for value in sys.argv[1:4])
expectation=sys.argv[4]
assert expectation in ('red','green')
fixture=pathlib.Path(__file__).with_suffix('.mts')
sha=lambda data:hashlib.sha256(data).hexdigest()
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=checkout).strip()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=checkout,text=True).strip()
stamp=json.loads((checkout/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean']
output.mkdir()
for name in ('home','state','workspace','tmp'):(output/name).mkdir()
config=output/'config.json';config.write_text(json.dumps({'gateway':{'mode':'local','auth':{'mode':'none'}},'agents':{'defaults':{'workspace':str(output/'workspace')},'entries':{'main':{'workspace':str(output/'workspace')}}}}));config.chmod(0o600)
config_sha=sha(config.read_bytes())
store=output/'state/agents/main/agent/openclaw-agent.sqlite'
env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(output/'home'),'USERPROFILE':str(output/'home'),'OPENCLAW_STATE_DIR':str(output/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(output/'tmp'),'OPENCLAW_DISABLE_BUNDLED_PLUGINS':'1','NO_COLOR':'1','TERM':'dumb'}
receipt={'head':head,'buildStamp':stamp,'expectation':expectation,'collectorSHA256':sha(pathlib.Path(__file__).read_bytes()),'fixtureSHA256':sha(fixture.read_bytes()),'normalEntry':str(checkout/'openclaw.mjs'),'scope':'Normal registered sessions tail entry. Canonical source fixture writers create legal isolated SQLite data only; no Gateway, channel, provider, host credentials or real sessions. Output-close is an actual closed OS pipe. Signals are actual process-group SIGINT/SIGTERM.','configSHA256Before':config_sha,'cases':[],'fixtureEvents':[],'result':'RUNNING'}
def save():(output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
fixture_out=open(output/'fixture.stdout','w');fixture_err=open(output/'fixture.stderr','w');events=queue.Queue()
writer=subprocess.Popen([str(node),'--import',str(checkout/'scripts/tsx.mjs'),str(fixture),str(checkout)],cwd=checkout,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=fixture_err,text=True,bufsize=1,start_new_session=True)
def collect_fixture():
 for line in writer.stdout:
  fixture_out.write(line);fixture_out.flush()
  try:value=json.loads(line)
  except (ValueError,TypeError):continue
  if isinstance(value,dict) and value.get('protocol')=='sessions-tail-native-fixture-v1':
   value['observedAtMonotonic']=time.monotonic();events.put(value)
thread=threading.Thread(target=collect_fixture,daemon=True);thread.start()
def fixture_event(expected,request_id=None,timeout=80):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  value=events.get(timeout=max(.01,deadline-time.monotonic()));receipt['fixtureEvents'].append(value)
  if value['event']=='error':raise AssertionError(value)
  if value['event']==expected and (request_id is None or value.get('requestId')==request_id):return value
 raise AssertionError('fixture event timeout')
sequence=0
def append(label,seq):
 global sequence
 sequence+=1;request_id=str(sequence);marker=f'synthetic-{label}-{seq}'
 message={'op':'append','requestId':request_id,'storePath':str(store),'sessionKey':f'agent:main:tail-proof-{label}','sessionId':f'tail-proof-session-{label}','seq':seq,'marker':marker}
 writer.stdin.write(json.dumps(message)+'\n');writer.stdin.flush();return marker,fixture_event('appended',request_id)
def process_snapshot(root,known):
 facts={}
 for entry in pathlib.Path('/proc').iterdir():
  if not entry.name.isdigit():continue
  try:
   data=(entry/'stat').read_text();fields=data[data.rfind(')')+2:].split();pid=int(entry.name);facts[pid]={'pid':pid,'ppid':int(fields[1]),'processGroup':int(fields[2]),'state':fields[0]}
  except (OSError,ValueError,IndexError):continue
 selected={pid for pid,item in facts.items() if pid==root or pid in known or item['processGroup']==root}
 while True:
  children={pid for pid,item in facts.items() if item['ppid'] in selected}
  if children<=selected:break
  selected|=children
 known.update(selected)
 rows=[]
 for pid in sorted(selected):
  row=facts.get(pid)
  if not row:continue
  try:row['commandLine']=(pathlib.Path('/proc')/str(pid)/'cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace').strip()
  except OSError:row['commandLine']='<already exited>'
  rows.append(row)
 return rows
def live(rows):return [row for row in rows if row['state']!='Z']
def cleanup_owned(process,known):
 before=process_snapshot(process.pid,known);sent=[]
 if live(before):
  try:os.killpg(process.pid,signal.SIGTERM);sent.append({'processGroup':process.pid,'signal':'SIGTERM'})
  except ProcessLookupError:pass
  for row in live(before):
   if row['pid']==process.pid or row['processGroup']==process.pid:continue
   try:os.kill(row['pid'],signal.SIGTERM);sent.append({'pid':row['pid'],'signal':'SIGTERM'})
   except ProcessLookupError:pass
 try:process.wait(timeout=5)
 except subprocess.TimeoutExpired:pass
 deadline=time.monotonic()+2
 while live(process_snapshot(process.pid,known)) and time.monotonic()<deadline:time.sleep(.05)
 remaining=live(process_snapshot(process.pid,known))
 for row in remaining:
  try:os.kill(row['pid'],signal.SIGKILL);sent.append({'pid':row['pid'],'signal':'SIGKILL'})
  except ProcessLookupError:pass
 try:process.wait(timeout=5)
 except subprocess.TimeoutExpired:pass
 return {'before':before,'signals':sent,'after':process_snapshot(process.pid,known),'exitCodeAfterCleanup':process.poll(),'usedSIGKILL':any(item['signal']=='SIGKILL' for item in sent)}
def command(label):return [str(node),str(checkout/'openclaw.mjs'),'sessions','tail','--store',str(store),'--session-key',f'agent:main:tail-proof-{label}','--tail','1']
def run_finite(label,path,marker,prefix="finite"):
 cmd=command(label);result=subprocess.run(cmd,cwd=checkout,env=env,capture_output=True,timeout=25)
 (path/(prefix+'.stdout')).write_bytes(result.stdout);(path/(prefix+'.stderr')).write_bytes(result.stderr)
 row={'command':cmd,'exitCode':result.returncode,'stdout':result.stdout.decode(errors='replace'),'stderr':result.stderr.decode(errors='replace'),'markerReadBack':marker.encode() in result.stdout}
 assert result.returncode==0 and row['markerReadBack'],row
 return row
def read_until(process,marker,timeout=20):
 data=bytearray();deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  if not select.select([process.stdout],[],[],max(.01,deadline-time.monotonic()))[0]:break
  part=os.read(process.stdout.fileno(),65536)
  if not part:break
  data.extend(part)
  if marker.encode() in data:return bytes(data)
 raise AssertionError({'expectedMarker':marker,'output':data.decode(errors='replace'),'exitCode':process.poll()})
try:
 fixture_event('ready')
 for label,kind in [('continue-term','SIGTERM'),('continue-int','SIGINT'),('closed-consumer','CLOSED_PIPE')]:
  case=output/label;case.mkdir();first_marker,first_ack=append(label,1)
  finite=run_finite(label,case,first_marker)
  errors=open(case/'diagnostics.log','wb');cmd=command(label)+['--follow'];process=subprocess.Popen(cmd,cwd=checkout,env=env,stdout=subprocess.PIPE,stderr=errors,start_new_session=True,bufsize=0)
  known=set();row={'label':label,'kind':kind,'command':cmd,'finiteControl':finite,'pid':process.pid,'snapshots':[],'result':'RUNNING'};receipt['cases'].append(row);data=bytearray();cleanup=None
  try:
   row['snapshots'].append({'stage':'started','processes':process_snapshot(process.pid,known)})
   data.extend(read_until(process,first_marker));row['snapshots'].append({'stage':'initialRecord','processes':process_snapshot(process.pid,known)})
   if kind=='CLOSED_PIPE':
    process.stdout.close();row['consumerClosedAtMonotonic']=time.monotonic()
   second_marker,ack=append(label,2);after_append=time.monotonic();row['secondAppendAcknowledgedAtMonotonic']=ack['observedAtMonotonic'];row['secondAppendFixtureReceipt']=ack
   if kind!='CLOSED_PIPE':
    data.extend(read_until(process,second_marker));row['secondRecordObserved']=True
    accepted=time.monotonic();os.killpg(process.pid,getattr(signal,kind));row['signalSentAtMonotonic']=accepted
    try:code=process.wait(timeout=5)
    except subprocess.TimeoutExpired:code=None
    row['signalToExitMs']=round((time.monotonic()-accepted)*1000,2);row['naturalExitCode']=code
    row['snapshots'].append({'stage':'afterSignalBeforeCleanup','processes':process_snapshot(process.pid,known)})
    expected_code=143 if kind=='SIGTERM' else 130
    assert code==expected_code,row
    assert not live(row['snapshots'][-1]['processes']),row
    row['result']='GREEN_CONTINUING_FOLLOW_AND_SIGNAL_CONTROL'
   else:
    try:code=process.wait(timeout=6)
    except subprocess.TimeoutExpired:code=None
    row['postSecondAppendObservationMs']=round((time.monotonic()-after_append)*1000,2);row['naturalExitCode']=code
    row['snapshots'].append({'stage':'decisionBeforeHarnessCleanup','processes':process_snapshot(process.pid,known)})
    row['outputCloseSettledNaturally']=code==0 and not live(row['snapshots'][-1]['processes'])
    if expectation=='red':
     assert code is None and live(row['snapshots'][-1]['processes']),row
     row['result']='RED_PRODUCER_LIVES_AFTER_CLOSED_PIPE_AND_COMMITTED_NEW_EVENT'
    else:
     assert row['outputCloseSettledNaturally'],row
     row['result']='GREEN_CLOSED_PIPE_EXIT_0_AND_EXTINCTION'
  finally:
   row['naturalStateRecordedBeforeCleanup']=True;cleanup=cleanup_owned(process,known);row['harnessCleanup']=cleanup;errors.close()
   if not process.stdout.closed:
    data.extend(process.stdout.read());process.stdout.close()
   (case/'stdout.raw').write_bytes(data);row['observedStdout']=data.decode(errors='replace');row['diagnostics']=(case/'diagnostics.log').read_text();row['configSHA256After']=sha(config.read_bytes());row['configUnchanged']=row['configSHA256After']==config_sha;save()
  assert not live(cleanup['after']),row
  assert row['configUnchanged'],row
  row['nativeSecondEventReadback']=run_finite(label,case,second_marker,prefix='second-readback');save()
 receipt['result']='RED_WITH_CONTINUING_AND_FINITE_CONTROLS' if expectation=='red' else 'GREEN_WITH_CONTINUING_AND_FINITE_CONTROLS'
except BaseException as error:
 receipt['result']='BLOCKED_OR_UNEXPECTED';receipt['error']=repr(error);raise
finally:
 try:
  if writer.poll() is None:
   writer.stdin.write(json.dumps({'op':'close','requestId':'close'})+'\n');writer.stdin.flush();writer.stdin.close()
   try:writer.wait(timeout=10)
   except subprocess.TimeoutExpired:pass
 finally:
  receipt['fixtureCleanup']=cleanup_owned(writer,set());thread.join(timeout=3);fixture_out.close();fixture_err.close()
  receipt['configSHA256After']=sha(config.read_bytes());receipt['configUnchanged']=receipt['configSHA256After']==config_sha
  receipt['trackedInputsStillClean']=not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=checkout).strip()
  receipt['collectorUnchanged']=sha(pathlib.Path(__file__).read_bytes())==receipt['collectorSHA256'];receipt['fixtureUnchanged']=sha(fixture.read_bytes())==receipt['fixtureSHA256'];save()
print(json.dumps({'result':receipt['result'],'receipt':str(output/'receipt.json')}))
