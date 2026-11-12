import os,sys,json,hashlib,time,signal,subprocess,pty,select,errno,fcntl,termios,struct,socket,re,urllib.request
from pathlib import Path
checkout,out,node=map(lambda x:Path(x).resolve(),sys.argv[1:4]);expect=sys.argv[4];assert expect in ('red','green');out.mkdir();base=Path(__file__).parent
sha=lambda x:hashlib.sha256(x).hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=checkout,text=True).strip();stamp=json.loads((checkout/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=checkout).strip()
receipt={'head':head,'stamp':stamp,'expectation':expect,'hashes':{p.name:sha(p.read_bytes()) for p in [Path(__file__),base/'sessions-read-fixture.mts']},'boundary':'normally built sessions list CLI in controlling PTY; real isolated SQLite and real Gateway; only task-owned Gateway process group is suspended to hold a real TCP/WS connection','cases':[],'result':'RUNNING'}
def save():(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
def owned(group):
 return [line for line in subprocess.check_output(['ps','-eo','pid=,ppid=,pgid=,stat='],text=True).splitlines() if len(line.split())==4 and int(line.split()[2])==group]
def sockets(group,port):
 inodes={}
 for name in ['/proc/net/tcp','/proc/net/tcp6']:
  for line in Path(name).read_text().splitlines()[1:]:
   cols=line.split()
   if cols[3]=='01' and int(cols[2].split(':')[-1],16)==port:inodes[cols[9]]=cols[:4]
 matches=[]
 for process in owned(group):
  pid=int(process.split()[0])
  try:
   for fd in (Path('/proc')/str(pid)/'fd').iterdir():
    try:target=fd.readlink().as_posix()
    except OSError:continue
    if target.startswith('socket:[') and target[8:-1] in inodes:matches.append({'pid':pid,'fd':fd.name,'inode':target[8:-1],'tcp':inodes[target[8:-1]]})
  except (FileNotFoundError,PermissionError):pass
 return matches
for name in ['home','state','workspace','tmp']:(out/name).mkdir()
s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
config=out/'config.json';cfg={'gateway':{'mode':'local','bind':'loopback','port':port,'controlUi':{'enabled':False},'auth':{'mode':'token','token':'synthetic-cli-read-proof-token'},'openclawId':{'enabled':False}},'agents':{'defaults':{'workspace':str(out/'workspace')},'entries':{'main':{'workspace':str(out/'workspace')}}},'cron':{'enabled':False},'models':{'providers':{'ollama':{'baseUrl':'http://127.0.0.1:9','api':'ollama','models':[{'id':'synthetic-read-model','name':'Synthetic read model','contextWindow':8192,'maxTokens':2048}]}}}};config.write_text(json.dumps(cfg));config.chmod(0o600)
env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(out/'home'),'USERPROFILE':str(out/'home'),'OPENCLAW_STATE_DIR':str(out/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(out/'tmp'),'NO_COLOR':'1','TERM':'xterm-256color','OPENCLAW_DISABLE_BUNDLED_PLUGINS':'1','OPENCLAW_SKIP_CHANNELS':'1','OPENCLAW_SKIP_PROVIDERS':'1','OPENCLAW_SKIP_GMAIL_WATCHER':'1','OPENCLAW_SKIP_CRON':'1','OPENCLAW_SKIP_BROWSER_CONTROL_SERVER':'1','OPENCLAW_SKIP_CANVAS_HOST':'1'}
fixture=subprocess.run([str(node),'--import',str(checkout/'scripts/tsx.mjs'),str(base/'sessions-read-fixture.mts'),str(checkout),str(config),'sessions'],cwd=checkout,env=env,capture_output=True,text=True,timeout=180);(out/'fixture.stdout').write_text(fixture.stdout);(out/'fixture.stderr').write_text(fixture.stderr);assert fixture.returncode==0,fixture.stderr
facts=[json.loads(x) for x in fixture.stdout.splitlines() if x.startswith('{')][-1];assert len(facts['entries'])==1;receipt['fixtureReadback']=facts;before=sha(config.read_bytes());gateway=None;stopped=False
try:
 gwout=open(out/'gateway.stdout','wb');gwerr=open(out/'gateway.stderr','wb');gateway=subprocess.Popen([str(node),str(checkout/'openclaw.mjs'),'gateway','run','--bind','loopback','--port',str(port),'--allow-unconfigured'],cwd=checkout,env=env,stdout=gwout,stderr=gwerr,start_new_session=True);receipt['gatewayPid']=gateway.pid
 deadline=time.monotonic()+50
 while True:
  assert gateway.poll() is None,'Gateway exited; inspect gateway logs'
  try:
   with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:'+str(port)+'/healthz',timeout=.5) as response:
    if response.status==200:break
  except Exception:pass
  if time.monotonic()>deadline:raise RuntimeError('Gateway readiness deadline')
  time.sleep(.1)
 receipt['gatewayHealthy']=True
 for label,human,exit_signal,store in [('json-control',False,None,False),('human-control',True,None,False),('catalog-json-int',False,'SIGINT',False),('catalog-human-term',True,'SIGTERM',False),('store-control',False,None,True)]:
  case=out/label;case.mkdir()
  if exit_signal or store:os.killpg(gateway.pid,signal.SIGSTOP);stopped=True
  command=[str(node),str(checkout/'openclaw.mjs'),'sessions','list']+([] if human else ['--json'])+(['--store',facts['storePath']] if store else [])
  started=time.monotonic();pid,master=pty.fork()
  if pid==0:
   fcntl.ioctl(0,termios.TIOCSWINSZ,struct.pack('HHHH',24,120,0,0));fd=os.open(case/'stderr.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.dup2(fd,2);os.close(fd);os.chdir(checkout);os.execve(str(node),command,env)
  data=bytearray();sent=None;status=None;eof=False;watchdog=False;connected=[];closed_at=None;stdout_at_interrupt=None;stderr_at_interrupt=None
  try:
   while time.monotonic()-started<35:
    connections=sockets(pid,port)
    if connections and not connected:connected=connections;connected_at=time.monotonic()
    if exit_signal and sent is None and connections:
     sent=time.monotonic();stdout_at_interrupt=len(data);stderr_at_interrupt=(case/'stderr.log').stat().st_size
     if exit_signal=='SIGINT':os.write(master,b'\x03')
     else:os.killpg(pid,signal.SIGTERM)
    if sent and not connections and closed_at is None:closed_at=time.monotonic()
    ready,_,_=select.select([master],[],[],.025)
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
   if status is None:watchdog=True;os.killpg(pid,signal.SIGKILL);_,status=os.waitpid(pid,0);exited=time.monotonic()
  finally:
   os.close(master)
   if status is None:os.killpg(pid,signal.SIGKILL);os.waitpid(pid,0)
   if stopped:os.killpg(gateway.pid,signal.SIGCONT);stopped=False
  raw=bytes(data);err=(case/'stderr.log').read_bytes();(case/'stdout.raw').write_bytes(raw);tail=raw[stdout_at_interrupt:] if sent else b'';plain=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',tail.decode(errors='replace')).removeprefix('^C').strip();errtail=err[stderr_at_interrupt:] if sent else b'';notice='Command interrupted by '+str(exit_signal)+'. Waiting for cleanup before exiting.';quiet=sent is not None and not plain and errtail.decode(errors='replace').strip()==notice
  row={'label':label,'command':command,'human':human,'signal':exit_signal,'explicitStore':store,'exitCode':os.waitstatus_to_exitcode(status),'seconds':round(exited-started,3),'connectedSocketReadback':connected,'interruptSent':sent is not None,'interruptToExitMs':round((exited-sent)*1000,2) if sent else None,'interruptToSocketCloseMs':round((closed_at-sent)*1000,2) if closed_at else None,'watchdog':watchdog,'ptyEof':eof,'quiet':quiet,'configUnchanged':sha(config.read_bytes())==before,'survivorsBeforeHarnessCleanup':owned(pid),'stdoutSHA256':sha(raw),'stderrSHA256':sha(err),'stdout':raw.decode(errors='replace'),'stderr':err.decode(errors='replace')};receipt['cases'].append(row);save();print(json.dumps({k:v for k,v in row.items() if k not in ['command','stdout','stderr']}),flush=True)
  assert not watchdog and not owned(pid) and row['configUnchanged'] and eof
  if not exit_signal:
   assert row['exitCode']==0,(label,raw,err)
   if human:assert 'synthetic-read-model' in raw.decode() and 'catalog-proof' in raw.decode(),raw
   else:
    obj=json.JSONDecoder().raw_decode(raw.decode().lstrip())[0];assert len(obj['sessions'])==1 and obj['sessions'][0]['sessionId']==facts['sessionId'];row['sessionReadback']=obj['sessions'][0]
   if store:assert not connected
   row['result']='GREEN_EXISTING_CONTROL'
  else:
   assert row['interruptSent'] and connected,(label,raw,err)
   accepted=row['exitCode']==(130 if exit_signal=='SIGINT' else 143) and row['interruptToExitMs']<1500 and closed_at is not None and row['interruptToSocketCloseMs']<1500 and quiet
   assert accepted if expect=='green' else not accepted,(label,row)
   row['result']='GREEN_READ_ABORT' if expect=='green' else 'RED_READ_PENDING'
  save()
 receipt['result']='GREEN' if expect=='green' else 'RED_WITH_REAL_GATEWAY_AND_LEGAL_CONTROLS'
except Exception as error:
 receipt['result']='BLOCKED_OR_UNEXPECTED';receipt['error']=repr(error);save();raise
finally:
 if gateway is not None:
  if stopped:os.killpg(gateway.pid,signal.SIGCONT)
  if gateway.poll() is None:
   os.killpg(gateway.pid,signal.SIGTERM)
   try:gateway.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(gateway.pid,signal.SIGKILL);gateway.wait()
  gwout.close();gwerr.close()
 receipt['cleanup']={'gatewayExit':gateway.returncode if gateway else None,'gatewayOwnedSurvivors':owned(gateway.pid) if gateway else [],'configUnchanged':sha(config.read_bytes())==before,'isolatedStateRetained':True};save()
