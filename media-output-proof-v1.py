"""Real built image CLI -> bundled OpenAI adapter -> loopback recorder -> actual output bytes."""
from pathlib import Path
import base64,hashlib,http.server,json,os,subprocess,sys,threading,time
w,out,node=map(lambda s:Path(s).resolve(),sys.argv[1:4]);mode=sys.argv[4];assert mode in('red','green');out.mkdir();sha=lambda b:hashlib.sha256(b).hexdigest();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip();stamp=json.loads((w/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=w).strip()
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yf7kAAAAASUVORK5CYII=');requests=[];errors=[]
r={'head':head,'collectorSHA256':sha(Path(__file__).read_bytes()),'buildStamp':stamp,'mode':mode,'cases':[],'result':'RUNNING','boundary':'normal built infer image generate -> bundled OpenAI adapter -> loopback HTTP request recorder -> actual PNG byte/location and directory readback'}
def save():(out/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*_):pass
 def do_POST(self):
  try:
   assert self.path=='/v1/images/generations',self.path
   body=self.rfile.read(int(self.headers['content-length']));data=json.loads(body);n=data.get('n',1);assert n in(1,2),data;requests.append({'path':self.path,'body':data,'bodySHA256':sha(body),'syntheticAuthPresent':self.headers.get('Authorization')=='Bearer synthetic-output-fixture'})
   response=json.dumps({'created':1,'data':[{'b64_json':base64.b64encode(png).decode()}for _ in range(n)]}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(response)));self.end_headers();self.wfile.write(response)
  except Exception as e:errors.append(repr(e));self.send_error(500)
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever);thread.start()
try:
 for leaf in ['home','state','workspace','tmp','fixtures/physical/nested']:(out/leaf).mkdir(parents=True,exist_ok=True)
 f=out/'fixtures';(f/'selected').symlink_to(f/'physical/nested',target_is_directory=True);c=out/'openclaw.json';c.write_text(json.dumps({'gateway':{'mode':'local'},'agents':{'defaults':{'workspace':str(out/'workspace')},'entries':{'main':{}}},'plugins':{'allow':[],'slots':{'memory':'none'}},'models':{'providers':{'openai':{'baseUrl':f'http://127.0.0.1:{server.server_port}/v1','apiKey':'synthetic-output-fixture','api':'openai-completions','models':[],'request':{'allowPrivateNetwork':True}}}}}));c.chmod(0o600)
 env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(out/'home'),'OPENCLAW_STATE_DIR':str(out/'state'),'OPENCLAW_CONFIG_PATH':str(c),'TMPDIR':str(out/'tmp'),'NO_COLOR':'1','OPENCLAW_NO_RESPAWN':'1','OPENCLAW_QA_ALLOW_LOCAL_IMAGE_PROVIDER':'1'}
 for label,raw,count,physical in [('ordinary',str(f/'ordinary.jpg'),1,f),('selected',str(f/'selected')+'/../render.jpg',1,f/'physical'),('selected-multiple',str(f/'selected')+'/../multi.jpg',2,f/'physical'),('missing-parent',str(f/'selected')+'/../new/nested/render.jpg',1,f/'physical/new/nested')]:
  command=[str(node),str(w/'openclaw.mjs'),'infer','image','generate','--agent','main','--model','openai/gpt-image-1.5','--prompt','Synthetic output path fixture','--output',raw,'--count',str(count),'--json'];before=len(requests);start=time.monotonic();v=subprocess.run(command,cwd=w,env=env,capture_output=True,timeout=90);(out/(label+'.stdout')).write_bytes(v.stdout);(out/(label+'.stderr')).write_bytes(v.stderr);row={'label':label,'command':command,'exitCode':v.returncode,'seconds':round(time.monotonic()-start,3),'stdout':v.stdout.decode(errors='replace'),'stderr':v.stderr.decode(errors='replace'),'stdoutSHA256':sha(v.stdout),'stderrSHA256':sha(v.stderr),'requestCount':len(requests)-before};r['cases'].append(row);save();assert v.returncode==0 and len(requests)==before+1 and not errors,row
  outputs=json.loads(v.stdout)['outputs'];assert len(outputs)==count,outputs
  actual=physical if mode=='green'or label=='ordinary' else Path(os.path.abspath(os.path.dirname(raw)));stem=Path(raw).stem;readbacks=[]
  for index,output in enumerate(outputs):
   name=stem+(''if count==1 else '-'+str(index+1))+'.png';target=actual/name;assert target.read_bytes()==png and output['path']==str(target),output
   intended=physical/name;decoy=Path(os.path.abspath(os.path.dirname(raw)))/name
   if label!='ordinary':assert not(decoy if mode=='green'else intended).exists()
   readbacks.append({'path':str(target),'sha256':sha(target.read_bytes()),'intendedPath':str(intended),'decoyPath':str(decoy)})
  row['readbacks']=readbacks;save();print(json.dumps({'label':label,'exitCode':v.returncode}),flush=True)
 r['requests']=requests;r['result']='GREEN_4_SCENARIOS_5_PNGS'if mode=='green'else'BASE_3_WRONG_DESTINATIONS_ORDINARY_CONTROL_PASS'
except Exception as e:r['result']='BLOCKED_OR_UNEXPECTED';r['error']=repr(e);save();raise
finally:server.shutdown();server.server_close();thread.join();r['requests']=requests;r['errors']=errors;r['cleanup']={'serverStopped':True,'isolatedFixturesRetained':True,'productionStateTouched':False,'externalRequests':False,'fixtureBoundary':'synthetic OpenAI responses only; existing explicit QA loopback opt-in; actual adapter/path owner/publication are unmodified'};save()
