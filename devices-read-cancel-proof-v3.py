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
peer_helper=Path(__file__).with_name('devices-read-cancel-proof-v3.mjs')
sha=lambda value:hashlib.sha256(value).hexdigest()
receipt={'head':head,'buildStamp':stamp,'expectation':expectation,'collectorSHA256':sha(Path(__file__).read_bytes()),'peerSHA256':sha(peer_helper.read_bytes()),'entry':'Normal openclaw.mjs devices list / approve --latest / remove synthetic-device-1 --timeout 30000 --json 2>diagnostics.log; PTY VINTR SIGINT / owned process-group SIGTERM; normal respawn policy','boundary':'Native loopback WebSocket challenge/connect/device.pair.list read and peer lifecycle; synthetic peer is explicit, no real Gateway/provider is claimed','scope':'Actual public devices reads plus one admitted-write receipt control. Compatible loopback protocol recorder only; no real Gateway storage/effect, provider, or service lifecycle claim.','cases':[],'result':'RUNNING'}
def owned_processes(group):
 rows=[]
 for line in subprocess.check_output(['ps','-eo','pid=,ppid=,pgid=,stat='],text=True).splitlines():
  fields=line.split()
  if len(fields)==4 and int(fields[2])==group:rows.append(dict(zip(['pid','ppid','pgid','stat'],fields)))
 return rows
def save():
 (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
try:
 for kind,phase,interrupt,exit_signal in [('devices-list','connect',False,'SIGINT'),('devices-list','rpc',False,'SIGINT'),('devices-list','connect',True,'SIGINT'),('devices-list','rpc',True,'SIGINT'),('devices-list','connect',True,'SIGTERM'),('devices-list','rpc',True,'SIGTERM'),('devices-preview','rpc',False,'SIGINT'),('devices-preview','rpc',True,'SIGINT'),('devices-preview','rpc',True,'SIGTERM'),('devices-remove','rpc',False,'SIGINT'),('devices-remove','rpc',True,'SIGINT')]:
  label=kind+'-'+phase+('-'+exit_signal.lower()+'-interrupt' if interrupt else '-control');case=output/label;case.mkdir()
  for name in ['home','state','workspace','tmp']:(case/name).mkdir()
  config=case/'config.json';config.write_text(json.dumps({'gateway':{'mode':'local','auth':{'mode':'none'}},'agents':{'defaults':{'workspace':str(case/'workspace')},'entries':{'main':{'workspace':str(case/'workspace')}}}}));config.chmod(0o600);before=sha(config.read_bytes())
  environment={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(case/'home'),'USERPROFILE':str(case/'home'),'OPENCLAW_STATE_DIR':str(case/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(case/'tmp'),'OPENCLAW_DISABLE_BUNDLED_PLUGINS':'1','NO_COLOR':'1','TERM':'xterm-256color'}
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
  command_args=['devices','approve','--latest'] if kind=='devices-preview' else ['devices','remove','synthetic-device-1'] if kind=='devices-remove' else ['devices','list']
  command=[str(node),str(checkout/'openclaw.mjs')]+command_args+['--timeout','30000','--json']
  started=time.monotonic();pid,master=pty.fork()
  if pid==0:
   fcntl.ioctl(0,termios.TIOCSWINSZ,struct.pack('HHHH',24,100,0,0))
   errors=os.open(case/'diagnostics.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.dup2(errors,2);os.close(errors)
   os.chdir(checkout);os.execve(str(node),command,environment)
  data=bytearray();sent=None;status=None;exited=None;eof=False;watchdog=False;at_interrupt=[]
  try:
   while time.monotonic()-started<40:
    if interrupt and sent is None and held.is_set():
     sent=time.monotonic();at_interrupt=owned_processes(pid)
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
  has_status_json=(payload=={'pending':[],'paired':[]} if kind=='devices-list' else isinstance(payload,dict) and payload.get('selected',{}).get('requestId')=='synthetic-request-1' if kind=='devices-preview' else payload=={'deviceId':'synthetic-device-1'})
  cancellation_json=payload=={'ok':False,'error':{'type':'cli_error','message':'CLI stopping ('+exit_signal+')'}}
  row={'cliPid':pid,'cliProcessGroup':pid,'ownedProcessesAtInterrupt':at_interrupt,'ownedProcessesBeforeHarnessCleanup':before_cleanup,'peerCleanupStartedAt':cleanup_started,'peerClosedBeforeHarnessCleanup':bool(peer_closes),'interruptToPeerCloseMs':round((peer_closes[0]['observedAt']-sent)*1000,2) if sent is not None and peer_closes else None,'statusJSONPublished':has_status_json,'cancellationJSONPublished':cancellation_json,'lateStatusJSONAfterAcceptedInterrupt':bool(interrupt and payload is not None and not cancellation_json),'label':label,'exitSignal':exit_signal if interrupt else None,'command':command,'stderrRedirection':'diagnostics.log (regular file; stdin/stdout remain controlling PTY)','exitCode':os.waitstatus_to_exitcode(status),'seconds':round(exited-started,3),'interruptSent':sent is not None,'interruptToExitMs':round((exited-sent)*1000,2) if sent else None,'interruptAcknowledged':('Command interrupted by '+exit_signal+'.') in diagnostics,'watchdogKill':watchdog,'ptyEofDrained':eof,'events':events,'rawOutputSHA256':sha(data),'diagnosticsSHA256':sha(diagnostics.encode()),'configUnchanged':sha(config.read_bytes())==before,'output':text,'diagnostics':diagnostics}
  receipt['cases'].append(row);save()
  assert not peer_errors,peer_errors
  assert row['configUnchanged'] and not watchdog and not before_cleanup
  if not interrupt:
   assert row['exitCode']==(1 if kind=='devices-preview' else 0),text
   assert has_status_json,text
   assert [event['method'] for event in events if event['event']=='request']==['connect','device.pair.remove' if kind=='devices-remove' else 'device.pair.list']
   row['result']='GREEN_CONTROL'
  elif kind=='devices-remove':
   assert sent is not None and row['interruptAcknowledged'],text
   assert row['exitCode']==130 and row['interruptToExitMs']<1500,json.dumps(row)
   assert payload=={'deviceId':'synthetic-device-1'} and row['peerClosedBeforeHarnessCleanup'],json.dumps(row)
   assert [event['method'] for event in events if event['event']=='request']==['connect','device.pair.remove'],json.dumps(row)
   assert any(event['event']=='held-response-released' for event in events),json.dumps(row)
   row['result']='GREEN_ADMITTED_WRITE_RECEIPT_CONTROL'
  else:
   assert sent is not None and row['interruptAcknowledged'],text
   acceptance=row['exitCode']==(130 if exit_signal=='SIGINT' else 143) and row['interruptToExitMs']<1500 and row['peerClosedBeforeHarnessCleanup'] and row['interruptToPeerCloseMs']<1500 and not row['lateStatusJSONAfterAcceptedInterrupt']
   if expectation=='green':assert acceptance and cancellation_json,json.dumps(row)
   else:
    assert not acceptance,json.dumps(row)
    assert row['interruptToExitMs']>=1500 and row['exitCode'] in (-9,137),json.dumps(row)
    assert not any(event['event']=='held-response-released' for event in events),json.dumps(row)
   row['result']='GREEN' if expectation=='green' else 'RED_PENDING_DEVICE_LIST_REQUIRES_PROXY_SIGKILL_AFTER_ACCEPTED_INTERRUPT'
  save()
 receipt['result']='RED_WITH_LEGAL_CONTROLS' if expectation=='red' else 'GREEN'
except Exception as error:
 receipt['result']='BLOCKED_OR_UNEXPECTED';receipt['error']=repr(error);raise
finally:
 receipt['cleanup']={'onlyIsolatedTestConfiguration':True,'noRealGatewayServiceMutation':True,'noRemoteProviderOrChannel':True,'ownedPeerAndCLIWaited':True,'fixturesRetained':True};save()
