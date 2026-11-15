"""Built video CLI -> bundled DeepInfra URL response -> real HTTP stream -> disk readback."""
from pathlib import Path
import hashlib,http.server,json,os,subprocess,sys,threading,time
w,out,node=map(lambda x:Path(x).resolve(),sys.argv[1:4]);mode=sys.argv[4];assert mode in('red','green');out.mkdir();sha=lambda b:hashlib.sha256(b).hexdigest();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip();stamp=json.loads((w/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=w).strip()
video=bytes.fromhex('000000186674797069736f6d0000020069736f6d69736f32')+b'\x00\x00\x00\x0dmdatproof';requests=[];errors=[]
r={'head':head,'mode':mode,'collectorSHA256':sha(Path(__file__).read_bytes()),'buildStamp':stamp,'cases':[],'result':'RUNNING','fixtureLimit':'Synthetic MP4 bytes establish transport/publication identity, not playback or external provider availability.'}
def save():(out/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*_):pass
 def reply(self,content,mime):
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
 def do_POST(self):
  try:
   assert self.path=='/v1/openai/videos',self.path
   body=self.rfile.read(int(self.headers['content-length']));data=json.loads(body);requests.append({'method':'POST','path':self.path,'body':data,'bodySHA256':sha(body)})
   self.reply(json.dumps({'id':'synthetic-completed','status':'succeeded','data':[{'url':f'http://127.0.0.1:{self.server.server_port}/fixture.mp4'}]}).encode(),'application/json')
  except Exception as e:errors.append(repr(e));self.send_error(500)
 def do_GET(self):
  try:
   assert self.path=='/fixture.mp4',self.path;requests.append({'method':'GET','path':self.path,'bytes':len(video)});self.reply(video,'video/mp4')
  except Exception as e:errors.append(repr(e));self.send_error(500)
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever);thread.start()
try:
 for leaf in ['home','state','workspace','tmp','fixtures/physical/nested']:(out/leaf).mkdir(parents=True,exist_ok=True)
 f=out/'fixtures';(f/'selected').symlink_to(f/'physical/nested',target_is_directory=True);config=out/'openclaw.json';config.write_text(json.dumps({'gateway':{'mode':'local'},'agents':{'defaults':{'workspace':str(out/'workspace')},'entries':{'main':{}}},'plugins':{'allow':[],'slots':{'memory':'none'}},'models':{'providers':{'deepinfra':{'baseUrl':f'http://127.0.0.1:{server.server_port}/v1/openai','apiKey':'synthetic-deepinfra-proof','api':'openai-completions','models':[],'request':{'allowPrivateNetwork':True}}}}}));config.chmod(0o600)
 env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(out/'home'),'OPENCLAW_STATE_DIR':str(out/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(out/'tmp'),'NO_COLOR':'1','OPENCLAW_NO_RESPAWN':'1'}
 for label,raw,physical in [('ordinary',str(f/'ordinary.webm'),f),('selected',str(f/'selected')+'/../render.webm',f/'physical'),('new-parent',str(f/'selected')+'/../new/nested/render.webm',f/'physical/new/nested')]:
  command=[str(node),str(w/'openclaw.mjs'),'infer','video','generate','--agent','main','--model','deepinfra/Wan-AI/Wan2.2-T2V-A14B','--prompt','Synthetic streamed output path fixture','--output',raw,'--json'];before=len(requests);start=time.monotonic();v=subprocess.run(command,cwd=w,env=env,capture_output=True,timeout=90);(out/(label+'.stdout')).write_bytes(v.stdout);(out/(label+'.stderr')).write_bytes(v.stderr);row={'label':label,'command':command,'exitCode':v.returncode,'seconds':round(time.monotonic()-start,3),'stdout':v.stdout.decode(errors='replace'),'stderr':v.stderr.decode(errors='replace'),'stdoutSHA256':sha(v.stdout),'stderrSHA256':sha(v.stderr)};r['cases'].append(row);save();assert v.returncode==0 and len(requests)==before+2 and not errors,row
  result=json.loads(v.stdout);output=result['outputs'][0];target=(physical if mode=='green'or label=='ordinary'else Path(os.path.abspath(os.path.dirname(raw))))/(Path(raw).stem+'.mp4');assert target.read_bytes()==video and output['path']==str(target),output
  intended=physical/(Path(raw).stem+'.mp4');decoy=Path(os.path.abspath(os.path.dirname(raw)))/(Path(raw).stem+'.mp4')
  if label!='ordinary':assert not(decoy if mode=='green'else intended).exists()
  row['readback']={'path':str(target),'sha256':sha(target.read_bytes()),'bytes':len(video),'intended':str(intended),'decoy':str(decoy)};save();print(json.dumps({'label':label,'exitCode':v.returncode}),flush=True)
 r['result']='GREEN3_STREAMED_FILES'if mode=='green'else'BASE2_WRONG_STREAMED_DESTINATIONS_ORDINARY_CONTROL_PASS'
except Exception as e:r['result']='BLOCKED_OR_UNEXPECTED';r['error']=repr(e);save();raise
finally:server.shutdown();server.server_close();thread.join();r['requests']=requests;r['errors']=errors;r['cleanup']={'serverStopped':True,'productionStateTouched':False,'externalRequests':False,'isolatedFixturesRetained':True};save()
