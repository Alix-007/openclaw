import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import subprocess
import struct
import sys
import threading
import termios
import time

checkout,output,node=(Path(arg).resolve() for arg in sys.argv[1:4])
expectation=sys.argv[4]
assert expectation in ('red','green')
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=checkout).strip()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=checkout,text=True).strip()
stamp=json.loads((checkout/'dist/.buildstamp').read_text())
assert stamp['head']==head and stamp['inputsClean']
output.mkdir()
peer_helper=Path(__file__).with_name('models-catalog-cancel-proof-v4.mjs')
sha=lambda value:hashlib.sha256(value).hexdigest()
receipt={'head':head,'buildStamp':stamp,'expectation':expectation,'collectorSHA256':sha(Path(__file__).read_bytes()),'peerSHA256':sha(peer_helper.read_bytes()),'entry':'Normal openclaw.mjs models list / models status / doctor --lint --only core/doctor/model-references / models list --refresh --json 2>diagnostics.log; PTY VINTR SIGINT / owned process-group SIGTERM; normal respawn policy','boundary':'Native loopback WebSocket challenge/connect/models.list read and peer lifecycle; synthetic peer is explicit, no real Gateway/provider is claimed','scope':'Actual public catalog reads plus explicit catalog-refresh response control. Compatible loopback protocol recorder only; no real Gateway storage/effect, provider, or service lifecycle claim.','outputContract':{'version':4,'readAbort':'No result/error/cancellation JSON or new failure banner after accepted raw CLI interruption; only PTY echo, terminal restoration, and existing cleanup notice are allowed.','refresh':'Admitted refresh response remains publishable after interruption.','source':'https://github.com/openclaw/openclaw/pull/197110#issuecomment-6790934424; maintainer cites #197019'},'cases':[],'result':'RUNNING'}
def owned_processes(group):
 rows=[]
 for line in subprocess.check_output(['ps','-eo','pid=,ppid=,pgid=,stat='],text=True).splitlines():
  fields=line.split()
  if len(fields)==4 and int(fields[2])==group:rows.append(dict(zip(['pid','ppid','pgid','stat'],fields)))
 return rows
def save():
 (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
try:
 for kind,phase,interrupt,exit_signal in [('models-list','connect',False,'SIGINT'),('models-list','rpc',False,'SIGINT'),('models-list','connect',True,'SIGINT'),('models-list','rpc',True,'SIGINT'),('models-list','connect',True,'SIGTERM'),('models-list','rpc',True,'SIGTERM'),('models-status','rpc',False,'SIGINT'),('models-status','rpc',True,'SIGINT'),('models-status','rpc',True,'SIGTERM'),('models-refresh','rpc',False,'SIGINT'),('models-refresh','rpc',True,'SIGINT'),('doctor-model-reference','rpc',False,'SIGINT'),('doctor-model-reference','rpc',True,'SIGINT'),('doctor-model-reference','rpc',True,'SIGTERM')]:
  label=kind+'-'+phase+('-'+exit_signal.lower()+'-interrupt' if interrupt else '-control');case=output/label;case.mkdir()
  for name in ['home','state','workspace','tmp']:(case/name).mkdir()
  config=case/'config.json';config.write_text(json.dumps({'gateway':{'mode':'local','auth':{'mode':'none'}},'agents':{'defaults':{'workspace':str(case/'workspace')},'entries':{'main':{'workspace':str(case/'workspace')}}}}));config.chmod(0o600);before=sha(config.read_bytes())
  environment={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(case/'home'),'USERPROFILE':str(case/'home'),'OPENCLAW_STATE_DIR':str(case/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(case/'tmp'),'OPENCLAW_DISABLE_BUNDLED_PLUGINS':'1','NO_COLOR':'1','TERM':'xterm-256color'}
  if kind=='doctor-model-reference':environment.pop('OPENCLAW_DISABLE_BUNDLED_PLUGINS')
  peer=subprocess.Popen([str(node),str(peer_helper),str(checkout),phase,str(interrupt).lower(),kind],cwd=checkout,env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  first=json.loads(peer.stdout.readline());assert first['event']=='listening'
  cfg=json.loads(config.read_text());cfg['gateway']={'mode':'remote','remote':{'url':first['url'],'token':'synthetic-devices-proof-token'}};config.write_text(json.dumps(cfg));before=sha(config.read_bytes())
  events=[{**first,'observedAt':time.monotonic()}];held=threading.Event();closed=threading.Event()
  def record():
   for line in peer.stdout:
    value=json.loads(line);events.append({**value,'observedAt':time.monotonic()})
    if value['event']=='read-held':held.set()
    if value['event']=='peer-closed':closed.set()
  thread=threading.Thread(target=record);thread.start()
  command_args=['models','status'] if kind=='models-status' else ['doctor','--lint','--only','core/doctor/model-references'] if kind=='doctor-model-reference' else ['models','list','--refresh'] if kind=='models-refresh' else ['models','list']
  command=[str(node),str(checkout/'openclaw.mjs')]+command_args+['--json']
  started=time.monotonic();pid,master=pty.fork()
  if pid==0:
   fcntl.ioctl(0,termios.TIOCSWINSZ,struct.pack('HHHH',24,100,0,0))
   errors=os.open(case/'diagnostics.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.dup2(errors,2);os.close(errors)
   os.chdir(checkout);os.execve(str(node),command,environment)
  data=bytearray();sent=None;status=None;exited=None;eof=False;watchdog=False;at_interrupt=[];stdout_at_interrupt=None;diagnostics_at_interrupt=None
  try:
   while time.monotonic()-started<40:
    if interrupt and sent is None and held.is_set():
     sent=time.monotonic();at_interrupt=owned_processes(pid);stdout_at_interrupt=len(data);diagnostics_at_interrupt=(case/'diagnostics.log').stat().st_size
     if exit_signal=='SIGINT':os.write(master,b'\x03')
     else:os.killpg(pid,signal.SIGTERM)
    ready,_,_=select.select([master],[],[],.03)
    if ready:
     try:
      chunk=os.read(master,65536)
      if chunk:data.extend(chunk)
      else:eof=True
     except OSError as error:
      if error.errno!=errno.EIO:raise
      eof=True
    if status is None:
     got,value=os.waitpid(pid,os.WNOHANG)
     if got:status=value;exited=time.monotonic()
    if status is not None and eof:break
   if status is None:
    watchdog=True;os.killpg(pid,signal.SIGKILL);_,status=os.waitpid(pid,0);exited=time.monotonic()
   if interrupt and sent is not None:
    closed.wait(max(0,sent+1.5-time.monotonic()))
  finally:
   cleanup_started=time.monotonic();before_cleanup=owned_processes(pid)
   os.close(master);peer.terminate();peer.wait(timeout=5);thread.join(timeout=5)
  peer_errors=peer.stderr.read();text=data.decode(errors='replace');diagnostics=(case/'diagnostics.log').read_text();(case/'terminal.raw').write_bytes(data);(case/'peer-events.json').write_text(json.dumps(events,indent=2)+'\n');(case/'peer.stderr').write_text(peer_errors)
  peer_closes=[event for event in events if event['event']=='peer-closed' and event['observedAt']<cleanup_started]
  plain=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',text)
  payload=json.loads(plain[plain.index('{'):].strip()) if '{' in plain else None
  has_status_json=isinstance(payload,dict) and ((payload.get('count')==1 and payload.get('models',[{}])[0].get('key')=='catalog-proof/sample') if kind in ('models-list','models-refresh') else 'resolvedDefault' in payload if kind=='models-status' else payload.get('checksRun')==1 and 'findings' in payload)
  error_json=isinstance(payload,dict) and (payload.get('ok') is False or isinstance(payload.get('error'),dict))
  has_status_json=has_status_json and not error_json
  cancellation_json=error_json and isinstance(payload.get('error'),dict) and payload['error'].get('type')=='cli_error' and payload['error'].get('message')=='CLI stopping ('+exit_signal+')'
  stdout_tail=data[stdout_at_interrupt:] if stdout_at_interrupt is not None else b''
  diagnostics_tail=(case/'diagnostics.log').read_bytes()[diagnostics_at_interrupt:] if diagnostics_at_interrupt is not None else b''
  visible_stdout_tail=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',stdout_tail.decode(errors='replace')).removeprefix('^C').strip()
  expected_notice='Command interrupted by '+exit_signal+'. Waiting for cleanup before exiting.'
  quiet_read_abort=bool(interrupt and payload is None and not visible_stdout_tail and diagnostics_tail.decode(errors='replace').strip()==expected_notice)
  payload_kind='cancellation-error' if cancellation_json else 'error' if error_json else 'status' if has_status_json else 'other-json' if payload is not None else 'none'
  row={'cliPid':pid,'cliProcessGroup':pid,'ownedProcessesAtInterrupt':at_interrupt,'ownedProcessesBeforeHarnessCleanup':before_cleanup,'peerCleanupStartedAt':cleanup_started,'peerClosedBeforeHarnessCleanup':bool(peer_closes),'interruptToPeerCloseMs':round((peer_closes[0]['observedAt']-sent)*1000,2) if sent is not None and peer_closes else None,'statusJSONPublished':has_status_json,'cancellationJSONPublished':cancellation_json,'lateStatusJSONAfterAcceptedInterrupt':bool(interrupt and has_status_json),'lateErrorJSONAfterAcceptedInterrupt':bool(interrupt and error_json),'payloadKind':payload_kind,'quietReadAbort':quiet_read_abort,'stdoutBytesAtInterrupt':stdout_at_interrupt,'diagnosticsBytesAtInterrupt':diagnostics_at_interrupt,'stdoutAfterInterruptSHA256':sha(stdout_tail),'diagnosticsAfterInterruptSHA256':sha(diagnostics_tail),'stdoutAfterInterrupt':stdout_tail.decode(errors='replace'),'diagnosticsAfterInterrupt':diagnostics_tail.decode(errors='replace'),'label':label,'exitSignal':exit_signal if interrupt else None,'command':command,'stderrRedirection':'diagnostics.log (regular file; stdin/stdout remain controlling PTY)','exitCode':os.waitstatus_to_exitcode(status),'seconds':round(exited-started,3),'interruptSent':sent is not None,'interruptToExitMs':round((exited-sent)*1000,2) if sent else None,'interruptAcknowledged':('Command interrupted by '+exit_signal+'.') in diagnostics,'watchdogKill':watchdog,'ptyEofDrained':eof,'events':events,'rawOutputSHA256':sha(data),'diagnosticsSHA256':sha(diagnostics.encode()),'configUnchanged':sha(config.read_bytes())==before,'output':text,'diagnostics':diagnostics}
  receipt['cases'].append(row);save()
  assert not peer_errors,peer_errors
  assert row['configUnchanged'] and not watchdog and not before_cleanup
  if not interrupt:
   assert row['exitCode']==0,text
   assert has_status_json,text
   assert [event['method'] for event in events if event['event']=='request']==['connect','models.list']
   row['result']='GREEN_CONTROL'
  elif kind=='models-refresh':
   assert sent is not None and row['interruptAcknowledged'],text
   assert row['exitCode']==130 and row['interruptToExitMs']<1500,json.dumps(row)
   assert has_status_json and row['peerClosedBeforeHarnessCleanup'],json.dumps(row)
   assert [event['method'] for event in events if event['event']=='request']==['connect','models.list'],json.dumps(row)
   assert any(event['event']=='held-response-released' for event in events),json.dumps(row)
   row['result']='GREEN_ADMITTED_WRITE_RECEIPT_CONTROL'
  else:
   assert sent is not None and row['interruptAcknowledged'],text
   transport_acceptance=row['exitCode']==(130 if exit_signal=='SIGINT' else 143) and row['interruptToExitMs']<1500 and row['peerClosedBeforeHarnessCleanup'] and row['interruptToPeerCloseMs']<1500 and not row['lateStatusJSONAfterAcceptedInterrupt']
   acceptance=transport_acceptance and quiet_read_abort
   if expectation=='green':assert acceptance and not error_json and payload is None,json.dumps(row)
   else:
    assert not acceptance,json.dumps(row)
    assert row['interruptToExitMs']>=1500 and row['exitCode'] in (-9,137),json.dumps(row)
    assert not any(event['event']=='held-response-released' for event in events),json.dumps(row)
   row['result']='GREEN' if expectation=='green' else 'RED_PENDING_MODEL_CATALOG_REQUIRES_PROXY_SIGKILL_AFTER_ACCEPTED_INTERRUPT'
  save()
 receipt['result']='RED_WITH_LEGAL_CONTROLS' if expectation=='red' else 'GREEN'
except Exception as error:
 receipt['result']='BLOCKED_OR_UNEXPECTED';receipt['error']=repr(error);raise
finally:
 receipt['cleanup']={'onlyIsolatedTestConfiguration':True,'noRealGatewayServiceMutation':True,'noRemoteProviderOrChannel':True,'ownedPeerAndCLIWaited':True,'fixturesRetained':True};save()
