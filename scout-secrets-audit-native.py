#!/usr/bin/env python3
import argparse,os,sys,json,time,pathlib,subprocess,hashlib,pty,select,signal
p=argparse.ArgumentParser();p.add_argument('--worktree',required=True);p.add_argument('--node',required=True);p.add_argument('--out',required=True);a=p.parse_args()
w=pathlib.Path(a.worktree).resolve();out=pathlib.Path(a.out).resolve();out.mkdir(parents=True,exist_ok=False)
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['git','-C',str(w),*args],text=True).strip()
head=git('rev-parse','HEAD');dirty=git('status','--porcelain','--untracked-files=no');assert not dirty
stamp=json.loads((w/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean']
rows=[]
for case in ['success','error','no-allow-exec','pending-int','pending-term']:
 d=out/case;d.mkdir(mode=0o700);home=d/'home';home.mkdir();state=d/'state';state.mkdir();tmp=d/'tmp';tmp.mkdir();events=d/'events.jsonl';provider=d/'provider.py'
 provider.write_text('''#!/usr/bin/python3
import os,sys,time,json,signal
log=sys.argv[1];mode=sys.argv[2]
def event(kind,**kw):
 with open(log,'a') as f:f.write(json.dumps(dict(kind=kind,time=time.monotonic(),pid=os.getpid(),ppid=os.getppid(),**kw))+'\\n')
def stop(signum,frame):
 event('signal',signal=signum);sys.exit(128+signum)
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
r=json.loads(sys.stdin.read());event('request',ids=r.get('ids'),protocolVersion=r.get('protocolVersion'))
if mode=='error':sys.exit(7)
if mode=='pending':
 while True:time.sleep(.1)
print(json.dumps({'protocolVersion':1,'values':{i:'SYNTHETIC_TEST_ONLY' for i in r['ids']}}))
event('response')
''');provider.chmod(0o700)
 mode='pending' if case.startswith('pending') else 'error' if case=='error' else 'success'
 config={'secrets':{'providers':{'fixture':{'source':'exec','command':str(provider),'args':[str(events),mode],'timeoutMs':120000,'noOutputTimeoutMs':120000,'jsonOnly':True}}},'models':{'providers':{'openai':{'baseUrl':'http://127.0.0.1:1/v1','api':'openai-completions','apiKey':{'source':'exec','provider':'fixture','id':'synthetic'},'models':[{'id':'synthetic','name':'synthetic'}]}}}}
 cp=state/'openclaw.json';cp.write_text(json.dumps(config));cp.chmod(0o600);before=sha(cp)
 env={'PATH':str(pathlib.Path(a.node).parent)+':/usr/bin:/bin','HOME':str(home),'USERPROFILE':str(home),'XDG_CONFIG_HOME':str(home/'config'),'XDG_CACHE_HOME':str(home/'cache'),'XDG_DATA_HOME':str(home/'data'),'XDG_STATE_HOME':str(home/'state'),'TMPDIR':str(tmp),'TMP':str(tmp),'TEMP':str(tmp),'OPENCLAW_STATE_DIR':str(state),'OPENCLAW_CONFIG_PATH':str(cp),'NO_COLOR':'1','TERM':'xterm','LANG':'C.UTF-8'}
 cmd=[a.node,str(w/'openclaw.mjs'),'secrets','audit','--json']+([] if case=='no-allow-exec' else ['--allow-exec'])
 start=time.monotonic();pid,fd=pty.fork()
 if pid==0:
  os.chdir(w);os.execve(a.node,cmd,env)
 os.set_blocking(fd,False);data=b'';sent=None;status=None;watchdog=False;observed=[]
 while time.monotonic()-start<40:
  ready,_,_=select.select([fd],[],[],.05)
  if ready:
   try:data+=os.read(fd,65536)
   except OSError:pass
  if events.exists():
   observed=[json.loads(x) for x in events.read_text().splitlines() if x]
  if case.startswith('pending') and sent is None and any(x['kind']=='request' for x in observed):
   sent=time.monotonic()
   if case=='pending-int':os.write(fd,b'\x03')
   else:os.killpg(pid,signal.SIGTERM)
  done,st=os.waitpid(pid,os.WNOHANG)
  if done:status=st;break
  if sent and time.monotonic()-sent>7:
   watchdog=True;os.killpg(pid,signal.SIGKILL);_,status=os.waitpid(pid,0);break
 else:
  watchdog=True;os.killpg(pid,signal.SIGKILL);_,status=os.waitpid(pid,0)
 end=time.monotonic()
 for _ in range(3):
  try:data+=os.read(fd,65536)
  except OSError:break
 os.close(fd);(d/'terminal.bin').write_bytes(data);(d/'terminal.txt').write_text(data.decode('utf8','replace'))
 provider_pids=sorted({x['pid'] for x in observed});alive=[]
 for child in provider_pids:
  try:os.kill(child,0);alive.append(child)
  except ProcessLookupError:pass
 # Collector cleanup is explicitly after the observation and never a GREEN oracle.
 for child in alive:
  try:os.killpg(child,signal.SIGTERM)
  except ProcessLookupError:pass
 time.sleep(.15)
 row={'case':case,'command':cmd,'exitCode':os.waitstatus_to_exitcode(status),'elapsedSeconds':round(end-start,3),'interruptToExitSeconds':round(end-sent,3) if sent else None,'harnessWatchdog':watchdog,'providerPids':provider_pids,'providerAliveAtCliExit':alive,'eventsObserved':observed,'configUnchanged':sha(cp)==before,'configSHA256':before,'providerSHA256':sha(provider),'terminalSHA256':sha(d/'terminal.bin'),'output':data.decode('utf8','replace'),'harnessPostObservationCleanup':bool(alive)}
 rows.append(row);print(json.dumps({k:v for k,v in row.items() if k not in ['output','command','eventsObserved']}),flush=True)
receipt={'head':head,'buildStamp':stamp,'trackedCleanBefore':not dirty,'trackedCleanAfter':not git('status','--porcelain','--untracked-files=no'),'collectorSHA256':sha(__file__),'rows':rows,'limits':'Normal public CLI with synthetic local exec provider only; no real credentials/provider/network requests. Provider cleanup after recorded exit is collector-owned.'}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
