import os,sys,json,hashlib,time,signal,subprocess,pty,select,errno,threading,fcntl,termios,struct,socket,re,urllib.request
from pathlib import Path
checkout,out,node=map(lambda x:Path(x).resolve(),sys.argv[1:4]);expect=sys.argv[4];lane=sys.argv[5];assert lane == 'skills';assert expect in ('red','green');out.mkdir()
base=Path(__file__).parent
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=checkout,text=True).strip();stamp=json.loads((checkout/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=checkout).strip()
sha=lambda x:hashlib.sha256(x).hexdigest()
receipt={'head':head,'stamp':stamp,'expectation':expect,'hashes':{p.name:sha(p.read_bytes()) for p in [Path(__file__),base/'read-fixture.mts',base/'read-proxy.mjs']},'boundary':'normal built CLI through controlling PTY and actual normal Gateway; canonical isolated SQLite state; transparent proxy holds successful real replies','cases':[],'result':'RUNNING'}
def save():(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
def owned(group):
 return [line for line in subprocess.check_output(['ps','-eo','pid=,ppid=,pgid=,stat='],text=True).splitlines() if len(line.split())==4 and int(line.split()[2])==group]
def port():
 s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p
for name in ['home','state','workspace','tmp']:(out/name).mkdir()
backend=port();frontend=port();config=out/'config.json';cfg={'gateway':{'mode':'local','bind':'loopback','port':backend,'controlUi':{'enabled':False},'auth':{'mode':'token','token':'synthetic-cli-read-proof-token'},'openclawId':{'enabled':False}},'agents':{'defaults':{'workspace':str(out/'workspace')},'entries':{'main':{'workspace':str(out/'workspace')}}},'hooks':{'internal':{'enabled':True,'entries':{'proof-skill':{'enabled':True}}}},'cron':{'enabled':False},'models':{'providers':{'ollama':{'baseUrl':'http://127.0.0.1:9','api':'ollama','models':[{'id':'synthetic-read-model','name':'Synthetic read model','contextWindow':8192,'maxTokens':2048}]}}}};config.write_text(json.dumps(cfg));config.chmod(0o600)
env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(out/'home'),'USERPROFILE':str(out/'home'),'OPENCLAW_STATE_DIR':str(out/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(out/'tmp'),'NO_COLOR':'1','TERM':'xterm-256color','OPENCLAW_DISABLE_BUNDLED_PLUGINS':'1','OPENCLAW_SKIP_CHANNELS':'1','OPENCLAW_SKIP_PROVIDERS':'1','OPENCLAW_SKIP_GMAIL_WATCHER':'1','OPENCLAW_SKIP_CRON':'1','OPENCLAW_SKIP_BROWSER_CONTROL_SERVER':'1','OPENCLAW_SKIP_CANVAS_HOST':'1'}
fixture=subprocess.run([str(node),'--import',str(checkout/'scripts/tsx.mjs'),str(base/'read-fixture.mts'),str(checkout),str(config),lane],cwd=checkout,env=env,capture_output=True,text=True,timeout=180);(out/'fixture.stdout').write_text(fixture.stdout);(out/'fixture.stderr').write_text(fixture.stderr);assert fixture.returncode==0,fixture.stderr
fixture_rows=[json.loads(x) for x in fixture.stdout.splitlines() if x.startswith('{')];facts=fixture_rows[-1];assert facts['lane']==lane;receipt['fixtureReadback']=facts;before=sha(config.read_bytes())
gateway=None;proxy=None;events=[];thread=None
try:
 gwout=open(out/'gateway.stdout','wb');gwerr=open(out/'gateway.stderr','wb');gateway=subprocess.Popen([str(node),str(checkout/'openclaw.mjs'),'gateway','run','--bind','loopback','--port',str(backend),'--allow-unconfigured'],cwd=checkout,env=env,stdout=gwout,stderr=gwerr,start_new_session=True);receipt['gatewayPid']=gateway.pid
 deadline=time.monotonic()+50
 while True:
  assert gateway.poll() is None,'Gateway exited; inspect gateway logs'
  try:
   with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:'+str(backend)+'/healthz',timeout=.5) as response:
    if response.status==200:break
  except Exception:pass
  if time.monotonic()>deadline:raise RuntimeError('Gateway readiness deadline')
  time.sleep(.1)
 receipt['gatewayHealthy']=True
 proxy=subprocess.Popen([str(node),str(base/'read-proxy.mjs'),str(checkout),str(backend),str(frontend)],cwd=checkout,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(out/'proxy.stderr','wb'),text=True,bufsize=1,start_new_session=True)
 first=json.loads(proxy.stdout.readline());assert first['event']=='listening';events.append({**first,'observedAt':time.monotonic()});assert first['port']==frontend;receipt['configuredProxyPort']=first['port'];receipt['proxyPid']=proxy.pid
 def record():
  for line in proxy.stdout:
   event=json.loads(line);events.append({**event,'observedAt':time.monotonic()})
 thread=threading.Thread(target=record);thread.start()
 specs=[('list-json-int','skills.status',False,'SIGINT'),('info-human-term','skills.status',True,'SIGTERM'),('check-json-int','skills.status',False,'SIGINT'),('list-control','normal',False,None),('info-control','normal',True,None),('check-control','normal',False,None),('missing-control','missing',False,None),('error-control','error',False,None)]
 for label,mode,follow,exit_signal in specs:
  case=out/label;case.mkdir();proxy.stdin.write(json.dumps({'op':'configure','mode':mode,'label':label})+'\n');proxy.stdin.flush()
  deadline=time.monotonic()+3
  while not any(e['event']=='configured' and e.get('label')==label for e in events):
   if time.monotonic()>deadline:raise RuntimeError('proxy configure deadline')
   time.sleep(.005)
  args=(['tools','usage','status'] if lane=='tools' else ['skills',('info' if label.startswith(('info','missing')) else 'check' if label.startswith('check') else 'list')]+(['missing-hook' if mode=='missing' else 'proof-skill'] if label.startswith(('info','missing')) else []))+([] if follow else ['--json'])
  cli_env={**env,'OPENCLAW_GATEWAY_URL':'ws://127.0.0.1:'+str(frontend),'OPENCLAW_GATEWAY_TOKEN':'synthetic-wrong-token' if mode=='error' else 'synthetic-cli-read-proof-token'}
  command=[str(node),str(checkout/'openclaw.mjs')]+args;started=time.monotonic();pid,master=pty.fork()
  if pid==0:
   fcntl.ioctl(0,termios.TIOCSWINSZ,struct.pack('HHHH',24,100,0,0));fd=os.open(case/'stderr.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.dup2(fd,2);os.close(fd);os.chdir(checkout);os.execve(str(node),command,cli_env)
  data=bytearray();sent=None;status=None;eof=False;watchdog=False;stdout_at_interrupt=None;stderr_at_interrupt=None
  try:
   while time.monotonic()-started<35:
    held=any(e['event']=='response-held' and e.get('label')==label for e in events)
    marker=b'selection-proof-marker ok' in data
    if exit_signal and sent is None and (held if mode!='normal' else marker):
     sent=time.monotonic();stdout_at_interrupt=len(data);stderr_at_interrupt=(case/'stderr.log').stat().st_size
     if exit_signal=='SIGINT':os.write(master,b'\x03')
     else:os.killpg(pid,signal.SIGTERM)
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
   close_deadline=time.monotonic()+.2
   while time.monotonic()<close_deadline:
    connected={e['connectionId'] for e in events if e['event']=='front-connected' and e.get('label')==label};closed={e['connectionId'] for e in events if e['event']=='front-closed' and e.get('label')==label}
    if connected<=closed:break
    time.sleep(.005)
  finally:
   os.close(master)
   if status is None:
    os.killpg(pid,signal.SIGKILL);os.waitpid(pid,0)
  raw=bytes(data);err=(case/'stderr.log').read_bytes();(case/'stdout.raw').write_bytes(raw);case_events=[e for e in events if e.get('label')==label];(case/'proxy-events.json').write_text(json.dumps(case_events,indent=2)+'\n')
  held_ids={e['connectionId'] for e in case_events if e['event']=='response-held'};closes=[e for e in case_events if e['event']=='front-closed' and (not held_ids or e['connectionId'] in held_ids)];tail=raw[stdout_at_interrupt:] if sent else b'';plain=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',tail.decode(errors='replace')).removeprefix('^C').strip();errtail=err[stderr_at_interrupt:] if sent else b'';notice='Command interrupted by '+str(exit_signal)+'. Waiting for cleanup before exiting.'
  quiet=sent is not None and not plain and errtail.decode(errors='replace').strip()==notice
  row={'label':label,'command':command,'lane':lane,'environment':{'OPENCLAW_GATEWAY_URL':cli_env['OPENCLAW_GATEWAY_URL'],'auth':'wrong synthetic token' if mode=='error' else 'isolated synthetic token'},'mode':mode,'follow':follow,'signal':exit_signal,'exitCode':os.waitstatus_to_exitcode(status),'seconds':round(exited-started,3),'interruptToExitMs':round((exited-sent)*1000,2) if sent else None,'interruptSent':sent is not None,'interruptToFrontCloseMs':round((closes[0]['observedAt']-sent)*1000,2) if sent and closes else None,'targetConnectionIds':sorted(held_ids),'frontClosedBeforeHarnessCleanup':bool(closes),'watchdog':watchdog,'ptyEof':eof,'quiet':quiet,'configUnchanged':sha(config.read_bytes())==before,'survivorsBeforeHarnessCleanup':owned(pid),'stdoutSHA256':sha(raw),'stderrSHA256':sha(err),'stdout':raw.decode(errors='replace'),'stderr':err.decode(errors='replace'),'events':case_events};receipt['cases'].append(row);save();print(json.dumps({k:v for k,v in row.items() if k not in ['command','stdout','stderr','events']}),flush=True)
  assert not watchdog and not owned(pid) and row['configUnchanged'] and eof
  methods=[e['method'] for e in case_events if e['event']=='request']
  if mode in ('normal','missing','error'):
   assert row['exitCode']==(1 if mode in ('missing','error') else 0),(label,raw,err)
   if mode=='normal':
    real=[e for e in case_events if e['event']=='real-response' and e.get('method')==('toolUsage.status' if lane=='tools' else 'skills.status') and e.get('ok')];assert real,(label,case_events)
    if lane=='tools':assert 'openclaw:core:read' in raw.decode() and 'main' in raw.decode(),(label,raw,err)
    else:assert 'proof-skill' in raw.decode(),(label,raw,err)
   row['result']='GREEN_EXISTING_CONTROL'

  else:
   assert row['interruptSent'] and any(e['event']=='response-held' and e['actualGatewaySuccess'] for e in case_events)
   accepted=row['exitCode']==(130 if exit_signal=='SIGINT' else 143) and row['interruptToExitMs']<1500 and row['frontClosedBeforeHarnessCleanup'] and row['interruptToFrontCloseMs']<1500 and quiet
   assert accepted if expect=='green' else not accepted,(label,row)
   row['result']='GREEN_READ_ABORT' if expect=='green' else 'RED_READ_PENDING'

  save()
 receipt['result']='GREEN' if expect=='green' else 'RED_WITH_REAL_GATEWAY_AND_LEGAL_CONTROLS'
except Exception as error:
 receipt['result']='BLOCKED_OR_UNEXPECTED';receipt['error']=repr(error);save();raise
finally:
 if proxy is not None:
  if proxy.poll() is None:
   try:proxy.stdin.write(json.dumps({'op':'stop'})+'\n');proxy.stdin.flush();proxy.wait(timeout=5)
   except Exception:os.killpg(proxy.pid,signal.SIGKILL);proxy.wait()
  if thread is not None:thread.join(timeout=5)
 if gateway is not None:
  if gateway.poll() is None:
   os.killpg(gateway.pid,signal.SIGTERM)
   try:gateway.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(gateway.pid,signal.SIGKILL);gateway.wait()
  gwout.close();gwerr.close()
 receipt['cleanup']={'gatewayExit':gateway.returncode if gateway else None,'proxyExit':proxy.returncode if proxy else None,'gatewayOwnedSurvivors':owned(gateway.pid) if gateway else [],'proxyOwnedSurvivors':owned(proxy.pid) if proxy else [],'configUnchanged':sha(config.read_bytes())==before,'isolatedStateRetained':True};(out/'proxy-events.json').write_text(json.dumps(events,indent=2)+'\n');save()
