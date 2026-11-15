"""Built skills-library input selection -> real Gateway save -> independent library readback."""
from pathlib import Path
import base64,hashlib,json,os,signal,socket,subprocess,sys,time,urllib.request
w,out,node=map(lambda s:Path(s).resolve(),sys.argv[1:4]);mode=sys.argv[4];assert mode in('red','green');out.mkdir();sha=lambda b:hashlib.sha256(b).hexdigest();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip();stamp=json.loads((w/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=w).strip()
r={'head':head,'buildStamp':stamp,'collectorSHA256':sha(Path(__file__).read_bytes()),'mode':mode,'cases':[],'result':'RUNNING'}
def save():(out/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
for leaf in ['home','state','workspace','tmp','fixtures/physical/nested']:(out/leaf).mkdir(parents=True,exist_ok=True)
f=out/'fixtures';(f/'selected').symlink_to(f/'physical/nested',target_is_directory=True)
for label,root in [('physical',f/'physical/bundle'),('decoy',f/'bundle')]:
 root.mkdir();(root/'SKILL.md').write_text('---\nname: path-proof\ndescription: Synthetic local input fixture.\n---\n\nSelected '+label+' bundle.\n');(root/'asset.bin').write_bytes(label.encode()+bytes([0,255,13,10]))
s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();config=out/'openclaw.json';config.write_text(json.dumps({'gateway':{'mode':'local','bind':'loopback','port':port,'controlUi':{'enabled':False},'auth':{'mode':'token','token':'synthetic-skill-library-proof'},'openclawId':{'enabled':False}},'agents':{'defaults':{'workspace':str(out/'workspace')},'entries':{'main':{'workspace':str(out/'workspace')}}},'cron':{'enabled':False},'models':{'providers':{'ollama':{'baseUrl':'http://127.0.0.1:9','api':'ollama','models':[{'id':'synthetic','name':'Synthetic','contextWindow':8192,'maxTokens':2048}]}}}}));config.chmod(0o600)
env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(out/'home'),'USERPROFILE':str(out/'home'),'OPENCLAW_STATE_DIR':str(out/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(out/'tmp'),'NO_COLOR':'1','OPENCLAW_DISABLE_BUNDLED_PLUGINS':'1','OPENCLAW_SKIP_CHANNELS':'1','OPENCLAW_SKIP_PROVIDERS':'1','OPENCLAW_SKIP_GMAIL_WATCHER':'1','OPENCLAW_SKIP_CRON':'1','OPENCLAW_SKIP_BROWSER_CONTROL_SERVER':'1','OPENCLAW_SKIP_CANVAS_HOST':'1'}
gateway=None
def run(label,args):
 command=[str(node),str(w/'openclaw.mjs'),'skills','library',*args,'--url',f'ws://127.0.0.1:{port}','--token','synthetic-skill-library-proof','--json'];start=time.monotonic();v=subprocess.run(command,cwd=w,env=env,capture_output=True,timeout=45);(out/(label+'.stdout')).write_bytes(v.stdout);(out/(label+'.stderr')).write_bytes(v.stderr);row={'label':label,'command':command,'exitCode':v.returncode,'seconds':round(time.monotonic()-start,3),'stdout':v.stdout.decode(errors='replace'),'stderr':v.stderr.decode(errors='replace'),'stdoutSHA256':sha(v.stdout),'stderrSHA256':sha(v.stderr)};r['cases'].append(row);save();assert v.returncode==0,row;return row,json.loads(v.stdout)
try:
 gwout=open(out/'gateway.stdout','wb');gwerr=open(out/'gateway.stderr','wb');gateway=subprocess.Popen([str(node),str(w/'openclaw.mjs'),'gateway','run','--bind','loopback','--port',str(port),'--allow-unconfigured'],cwd=w,env=env,stdout=gwout,stderr=gwerr,start_new_session=True);deadline=time.monotonic()+50
 while True:
  assert gateway.poll() is None,'Gateway exited before ready'
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/healthz',timeout=.3)as response:
    if response.status==200:break
  except Exception:pass
  assert time.monotonic()<deadline,'Gateway readiness deadline';time.sleep(.1)
 raw=str(f/'selected')+'/../bundle';r['fixture']={'rawInput':raw,'physicalInput':str(f/'physical/bundle'),'decoyInput':str(f/'bundle')};save();first=None
 for label,action,input in [('ordinary','create',str(f/'physical/bundle')),('selected-directory','create',raw),('selected-file','create',raw+'/SKILL.md'),('selected-import','import',raw),('selected-update','update',raw)]:
  args=[action]+([first['entry']['skillId'],input,'--expected-revision',first['entry']['revision']]if action=='update'else[input,'--slug',label]);row,saved=run(label,args);entry=saved['entry'];readrow,read=run(label+'-read',['read',entry['skillId']]);expected='physical'if label=='ordinary'or mode=='green'else'decoy';assert read['content']==(f/('physical/bundle'if expected=='physical'else'bundle')/'SKILL.md').read_text(),read
  if label!='selected-file':
   files={v['path']:v for v in read['files']};assert base64.b64decode(files['asset.bin']['content'])==(f/('physical/bundle'if expected=='physical'else'bundle')/'asset.bin').read_bytes()
  row['libraryReadback']={'skillId':entry['skillId'],'revision':entry['revision'],'content':read['content'],'contentSHA256':sha(read['content'].encode()),'files':read['files']};save()
  if label=='ordinary':first=saved
  print(json.dumps({'label':label,'selected':expected}),flush=True)
 r['result']='GREEN5_REAL_LIBRARY_READBACKS'if mode=='green'else'BASE4_WRONG_BUNDLES_ORDINARY_CONTROL_PASS'
except Exception as e:r['result']='BLOCKED_OR_UNEXPECTED';r['error']=repr(e);save();raise
finally:
 if gateway is not None:
  if gateway.poll() is None:
   os.killpg(gateway.pid,signal.SIGTERM)
   try:gateway.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(gateway.pid,signal.SIGKILL);gateway.wait()
  gwout.close();gwerr.close()
 r['cleanup']={'gatewayExit':gateway.returncode if gateway else None,'isolatedStateRetained':True,'productionStateTouched':False,'externalRequests':False};save()
