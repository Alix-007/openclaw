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
peer_helper=Path(__file__).with_name('health-cancel-peer.mjs')
sha=lambda value:hashlib.sha256(value).hexdigest()
receipt={'head':head,'buildStamp':stamp,'expectation':expectation,'collectorSHA256':sha(Path(__file__).read_bytes()),'peerSHA256':sha(peer_helper.read_bytes()),'entry':'Normal openclaw.mjs health / gateway health --json 2>diagnostics.log; actual PTY VINTR, normal configured remote target or explicit --url; no direct signal injection/no-respawn override','boundary':'Native loopback WebSocket challenge/connect/status read and peer lifecycle; synthetic peer is explicit, no real Gateway/provider/channel is claimed','scope':'Actual health read only, synthetic compatible Gateway peer; no hosted channel/provider or real service lifecycle claim.','cases':[],'result':'RUNNING'}
def save():
 (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
try:
 for kind,phase,interrupt in [('health','rpc',False),('gateway-health','rpc',False),('health','connect',True),('health','rpc',True),('gateway-health','connect',True),('gateway-health','rpc',True)]:
  label=kind+'-'+phase+('-interrupt' if interrupt else '-control');case=output/label;case.mkdir()
  for name in ['home','state','workspace','tmp']:(case/name).mkdir()
  config=case/'config.json';config.write_text(json.dumps({'gateway':{'mode':'local','auth':{'mode':'none'}},'agents':{'defaults':{'workspace':str(case/'workspace')},'entries':{'main':{'workspace':str(case/'workspace')}}}}));config.chmod(0o600);before=sha(config.read_bytes())
  environment={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(case/'home'),'USERPROFILE':str(case/'home'),'OPENCLAW_STATE_DIR':str(case/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(case/'tmp'),'OPENCLAW_DISABLE_BUNDLED_PLUGINS':'1','NO_COLOR':'1','TERM':'xterm-256color'}
  peer=subprocess.Popen([str(node),str(peer_helper),str(checkout),phase,str(interrupt).lower()],cwd=checkout,env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  first=json.loads(peer.stdout.readline());assert first['event']=='listening'
  cfg=json.loads(config.read_text());cfg['gateway']={'mode':'remote','remote':{'url':first['url'],'token':'synthetic-health-proof-token'}};config.write_text(json.dumps(cfg));before=sha(config.read_bytes())
  events=[{**first,'observedAt':time.monotonic()}];held=threading.Event();closed=threading.Event()
  def record():
   for line in peer.stdout:
    value=json.loads(line);events.append({**value,'observedAt':time.monotonic()})
    if value['event']=='read-held':held.set()
    if value['event']=='peer-closed':closed.set()
  thread=threading.Thread(target=record);thread.start()
  command=[str(node),str(checkout/'openclaw.mjs')]+(['health'] if kind=='health' else ['gateway','health','--url',first['url'],'--token','synthetic-health-proof-token'])+['--timeout','30000','--json']
  started=time.monotonic();pid,master=pty.fork()
  if pid==0:
   fcntl.ioctl(0,termios.TIOCSWINSZ,struct.pack('HHHH',24,100,0,0))
   errors=os.open(case/'diagnostics.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.dup2(errors,2);os.close(errors)
   os.chdir(checkout);os.execve(str(node),command,environment)
  data=bytearray();sent=None;status=None;exited=None;eof=False;watchdog=False
  try:
   while time.monotonic()-started<40:
    if interrupt and sent is None and held.is_set():sent=time.monotonic();os.write(master,b'\x03')
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
   cleanup_started=time.monotonic()
   os.close(master);peer.terminate();peer.wait(timeout=5);thread.join(timeout=5)
  peer_errors=peer.stderr.read();text=data.decode(errors='replace');diagnostics=(case/'diagnostics.log').read_text();(case/'terminal.raw').write_bytes(data);(case/'peer-events.json').write_text(json.dumps(events,indent=2)+'\n');(case/'peer.stderr').write_text(peer_errors)
  peer_closes=[event for event in events if event['event']=='peer-closed' and event['observedAt']<cleanup_started]
  plain=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',text)
  payload=json.loads(plain[plain.index('{'):].strip()) if '{' in plain else None
  has_status_json=isinstance(payload,dict) and payload.get('proofMarker')=='synthetic-health-proof'
  row={'peerClosedBeforeHarnessCleanup':bool(peer_closes),'interruptToPeerCloseMs':round((peer_closes[0]['observedAt']-sent)*1000,2) if sent is not None and peer_closes else None,'statusJSONPublished':has_status_json,'lateStatusJSONAfterAcceptedInterrupt':bool(interrupt and has_status_json),'label':label,'command':command,'stderrRedirection':'diagnostics.log (regular file; stdin/stdout remain controlling PTY)','exitCode':os.waitstatus_to_exitcode(status),'seconds':round(exited-started,3),'interruptSent':sent is not None,'interruptToExitMs':round((exited-sent)*1000,2) if sent else None,'interruptAcknowledged':'Command interrupted by SIGINT.' in diagnostics,'watchdogKill':watchdog,'ptyEofDrained':eof,'events':events,'rawOutputSHA256':sha(data),'diagnosticsSHA256':sha(diagnostics.encode()),'configUnchanged':sha(config.read_bytes())==before,'output':text,'diagnostics':diagnostics}
  receipt['cases'].append(row);save()
  assert not peer_errors,peer_errors
  assert row['configUnchanged'] and not watchdog
  if not interrupt:
   assert row['exitCode']==0,text
   assert payload['ok'] is True and payload['proofMarker']=='synthetic-health-proof',text
   assert any(event['event']=='request' and event['method']=='health' for event in events)
   row['result']='GREEN_CONTROL'
  else:
   assert sent is not None and row['interruptAcknowledged'],text
   acceptance=row['exitCode']==130 and row['interruptToExitMs']<1500 and row['peerClosedBeforeHarnessCleanup'] and row['interruptToPeerCloseMs']<1500 and not row['lateStatusJSONAfterAcceptedInterrupt']
   if expectation=='green':assert acceptance,json.dumps(row)
   else:
    assert not acceptance,json.dumps(row)
    assert row['interruptToExitMs']>=1500 and row['exitCode'] in (-9,137),json.dumps(row)
    assert not any(event['event']=='held-response-released' for event in events),json.dumps(row)
   row['result']='GREEN' if expectation=='green' else 'RED_PENDING_HEALTH_REQUIRES_PROXY_SIGKILL_AFTER_ACCEPTED_INTERRUPT'
  save()
 receipt['result']='RED_WITH_LEGAL_CONTROLS' if expectation=='red' else 'GREEN'
except Exception as error:
 receipt['result']='BLOCKED_OR_UNEXPECTED';receipt['error']=repr(error);raise
finally:
 receipt['cleanup']={'onlyIsolatedTestConfiguration':True,'noRealGatewayServiceMutation':True,'noRemoteProviderOrChannel':True,'ownedPeerAndCLIWaited':True,'fixturesRetained':True};save()
