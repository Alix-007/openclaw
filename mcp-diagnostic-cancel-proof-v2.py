#!/usr/bin/env python3
import argparse,os,json,time,pathlib,subprocess,hashlib,pty,select,signal
p=argparse.ArgumentParser();p.add_argument('--worktree',required=True);p.add_argument('--node',required=True);p.add_argument('--out',required=True);a=p.parse_args();w=pathlib.Path(a.worktree).resolve();out=pathlib.Path(a.out).resolve();out.mkdir(parents=True,exist_ok=False)
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(*v):return subprocess.check_output(['git','-C',str(w),*v],text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no');stamp=json.loads((w/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];rows=[]
scenes=[('probe-normal','probe','normal',None,True),('probe-error','probe','error',None,True),('doctor-static','doctor','normal',None,True),('probe-int','probe','pending','SIGINT',True),('probe-term-human','probe','pending','SIGTERM',False),('doctor-int','doctor','pending','SIGINT',True),('configure-success','configure','normal',None,False),('configure-error','configure','error',None,False)]
for case,entry,mode,interrupt,js in scenes:
 d=out/case;d.mkdir(mode=0o700);home=d/'home';home.mkdir();state=d/'state';state.mkdir();tmp=d/'tmp';tmp.mkdir();ev=d/'events.jsonl';server=d/'server.py'
 server.write_text('''#!/usr/bin/python3
import json,os,sys,time,signal
log=sys.argv[1];mode=sys.argv[2]
def event(kind,**kw):
 with open(log,'a') as f:f.write(json.dumps(dict(kind=kind,pid=os.getpid(),ppid=os.getppid(),time=time.monotonic(),**kw))+'\\n')
def stop(n,frame):event('signal',signal=n);sys.exit(0)
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
event('start')
for line in sys.stdin:
 msg=json.loads(line);event('request',method=msg.get('method'),id=msg.get('id'))
 if msg.get('method')=='initialize':
  if mode=='pending':continue
  if mode=='error':sys.exit(7)
  response={'protocolVersion':msg['params']['protocolVersion'],'capabilities':{'tools':{}},'serverInfo':{'name':'synthetic-local-fixture','version':'1'}}
 elif msg.get('method')=='tools/list':response={'tools':[{'name':'synthetic_ping','description':'Synthetic control only','inputSchema':{'type':'object'},'annotations':{'readOnlyHint':True}}]}
 else:continue
 print(json.dumps({'jsonrpc':'2.0','id':msg['id'],'result':response}),flush=True);event('response',method=msg['method'])
event('eof')
''');server.chmod(0o700)
 config={'mcp':{'servers':{'fixture':{'command':str(server),'args':[str(ev),mode],'connectionTimeoutMs':60000,'requestTimeoutMs':60000}}}};cp=state/'openclaw.json';cp.write_text(json.dumps(config));cp.chmod(0o600);before=sha(cp)
 env={'PATH':str(pathlib.Path(a.node).parent)+':/usr/bin:/bin','HOME':str(home),'USERPROFILE':str(home),'XDG_CONFIG_HOME':str(home/'config'),'XDG_CACHE_HOME':str(home/'cache'),'XDG_DATA_HOME':str(home/'data'),'XDG_STATE_HOME':str(home/'state'),'TMPDIR':str(tmp),'TMP':str(tmp),'TEMP':str(tmp),'OPENCLAW_STATE_DIR':str(state),'OPENCLAW_CONFIG_PATH':str(cp),'NO_COLOR':'1','TERM':'xterm','LANG':'C.UTF-8'}
 cmd=[a.node,str(w/'openclaw.mjs'),'mcp',entry,'fixture']+(['--probe'] if entry=='doctor' and interrupt else [])+(['--timeout','61','--probe'] if entry=='configure' else [])+(['--json'] if js else [])
 begin=time.monotonic();pid,fd=pty.fork()
 if pid==0:os.chdir(w);os.execve(a.node,cmd,env)
 os.set_blocking(fd,False);data=b'';sent=None;status=None;events=[];watchdog=False
 while time.monotonic()-begin<40:
  if select.select([fd],[],[],.05)[0]:
   try:data+=os.read(fd,65536)
   except OSError:pass
  if ev.exists():events=[json.loads(x) for x in ev.read_text().splitlines() if x]
  if interrupt and sent is None and any(e['kind']=='request' and e.get('method')=='initialize' for e in events):
   sent=time.monotonic()
   if interrupt=='SIGINT':os.write(fd,b'\x03')
   else:os.killpg(pid,signal.SIGTERM)
  done,st=os.waitpid(pid,os.WNOHANG)
  if done:status=st;break
  if sent and time.monotonic()-sent>7:watchdog=True;os.killpg(pid,signal.SIGKILL);_,status=os.waitpid(pid,0);break
 else:watchdog=True;os.killpg(pid,signal.SIGKILL);_,status=os.waitpid(pid,0)
 end=time.monotonic()
 for _ in range(3):
  try:data+=os.read(fd,65536)
  except OSError:break
 os.close(fd);(d/'terminal.bin').write_bytes(data);(d/'terminal.txt').write_text(data.decode('utf8','replace'))
 pids=sorted({e['pid'] for e in events});alive=[]
 for child in pids:
  try:os.kill(child,0);alive.append(child)
  except ProcessLookupError:pass
 for child in alive:
  try:os.killpg(child,signal.SIGTERM)
  except ProcessLookupError:pass
 time.sleep(.15)
 row={'case':case,'command':cmd,'exitCode':os.waitstatus_to_exitcode(status),'elapsedSeconds':round(end-begin,3),'interruptToExitSeconds':round(end-sent,3) if sent else None,'harnessWatchdog':watchdog,'providerPids':pids,'providerAliveAtCliExit':alive,'observedEvents':events,'configUnchanged':before==sha(cp),'configSHA256':before,'configAfterSHA256':sha(cp),'configReadback':json.loads(cp.read_text()),'serverSHA256':sha(server),'terminalSHA256':sha(d/'terminal.bin'),'harnessPostObservationCleanup':bool(alive),'output':data.decode('utf8','replace')};rows.append(row);print(json.dumps({k:v for k,v in row.items() if k not in ['output','command','observedEvents']}),flush=True)
r={'head':head,'buildStamp':stamp,'trackedCleanAfter':not git('status','--porcelain','--untracked-files=no'),'collectorSHA256':sha(__file__),'rows':rows,'revisionNote':'V1 failed native helper admission before peer. V2 synthetic pending initialize withholds response while keeping stdin reader alive and honors normal EOF; adds actual config write/preflight controls before production edits.','limits':'Normal CLI with compatible local synthetic stdio MCP server only. Combined PTY output; direct synthetic child PIDs, not arbitrary descendants. Post-observation collector cleanup distinguished.'};(out/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
