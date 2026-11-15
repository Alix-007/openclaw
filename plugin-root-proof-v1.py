"""Actual plugin authoring commands preserve the directory selected by the filesystem."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,tarfile,time
w,out,node=map(lambda s:Path(s).resolve(),sys.argv[1:4]);mode=sys.argv[4];assert mode in ('red','green');out.mkdir();sha=lambda b:hashlib.sha256(b).hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip();stamp=json.loads((w/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=w).strip()
r={'head':head,'buildStamp':stamp,'collectorSHA256':sha(Path(__file__).read_bytes()),'mode':mode,'cases':[],'result':'RUNNING','boundary':'normal built plugins build/check/validate/pack/init -> actual authored metadata and archive/destination readback'}
def save():(out/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
for leaf in ['home','state','tmp','fixtures']:(out/leaf).mkdir()
c=out/'openclaw.json';c.write_text(json.dumps({'plugins':{'allow':[],'slots':{'memory':'none'}}}));env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(out/'home'),'OPENCLAW_STATE_DIR':str(out/'state'),'OPENCLAW_CONFIG_PATH':str(c),'TMPDIR':str(out/'tmp'),'NO_COLOR':'1','OPENCLAW_DISABLE_BONJOUR':'1','OPENCLAW_NO_RESPAWN':'1'}
def run(label,args,expect=0):
 command=[str(node),str(w/'openclaw.mjs'),'plugins',*args];start=time.monotonic();v=subprocess.run(command,cwd=w,env=env,capture_output=True,timeout=90);(out/(label+'.stdout')).write_bytes(v.stdout);(out/(label+'.stderr')).write_bytes(v.stderr);row={'label':label,'command':command,'exitCode':v.returncode,'seconds':round(time.monotonic()-start,3),'stdout':v.stdout.decode(errors='replace'),'stderr':v.stderr.decode(errors='replace'),'stdoutSHA256':sha(v.stdout),'stderrSHA256':sha(v.stderr)};r['cases'].append(row);save();print(json.dumps({'label':label,'exitCode':v.returncode}),flush=True);assert v.returncode==expect,row;return row
try:
 f=out/'fixtures';physical=f/'physical';(physical/'nested').mkdir(parents=True);(f/'selected').symlink_to(physical/'nested',target_is_directory=True)
 selected=physical/'source';decoy=f/'source';raw=str(f/'selected')+'/../source'
 for label,root,id in [('physical',selected,'physical-proof'),('decoy',decoy,'decoy-proof')]:
  root.mkdir();(root/'node_modules').mkdir();(root/'node_modules/esbuild').symlink_to(w/'node_modules/esbuild',target_is_directory=True)
  (root/'package.json').write_text(json.dumps({'name':'openclaw-plugin-'+id,'version':'1.0.0','type':'module','openclaw':{'extensions':['./index.ts']}}))
  (root/'index.ts').write_text('import {defineToolPlugin}from"openclaw/plugin-sdk/tool-plugin";export default defineToolPlugin({id:'+json.dumps(id)+',name:'+json.dumps(id)+',description:"Synthetic plugin",tools:(tool)=>[tool({name:"proof_echo",description:"Synthetic",parameters:{type:"object",properties:{}},execute:async()=>({ok:true})})]});\n')
  run(label+'-seed',['build','--root',str(root)]);run(label+'-ordinary-validation',['validate','--json','--root',str(root)])
 r['fixture']={'rawRoot':raw,'physicalRoot':str(selected),'decoyRoot':str(decoy),'linkTarget':os.readlink(f/'selected')};assert Path(raw).resolve()==selected
 source=selected/'index.ts';source.write_text(source.read_text().replace('name:"physical-proof"','name:"Updated Physical"'))
 before={str(root):{name:sha((root/name).read_bytes())for name in ['package.json','openclaw.plugin.json','index.ts']}for root in [selected,decoy]}
 run('check-physical-stale',['build','--check','--root',raw],0 if mode=='red'else 1)
 row=run('validate-physical-stale',['validate','--json','--root',raw],0 if mode=='red'else 1);assert json.loads(row['stdout'])['pluginId']==('decoy-proof'if mode=='red'else'physical-proof')
 row=run('build-selected-root',['build','--root',raw]);saved=json.loads((selected/'openclaw.plugin.json').read_text());assert saved['name']==('physical-proof'if mode=='red'else'Updated Physical'),saved;row['manifestReadback']={'path':str(selected/'openclaw.plugin.json'),'name':saved['name'],'sha256':sha((selected/'openclaw.plugin.json').read_bytes())};save()
 artifact=out/'selected-plugin.tgz';row=run('pack-selected-root',['pack','--root',raw,'--out',str(artifact),'--json']);v=json.loads(row['stdout']);expected='decoy-proof'if mode=='red'else'physical-proof';assert v['pluginId']==expected,v
 with tarfile.open(artifact,'r:gz')as a:metadata=json.load(a.extractfile('package/openclaw.plugin.json'))
 assert metadata['id']==expected;row['archiveReadback']={'path':str(artifact),'sha256':sha(artifact.read_bytes()),'pluginId':metadata['id'],'name':metadata['name']};save()
 newraw=str(f/'selected')+'/../new-plugin';row=run('init-selected-destination',['init','new-proof','--directory',newraw]);actual=(f if mode=='red'else physical)/'new-plugin';wrong=(physical if mode=='red'else f)/'new-plugin';assert(actual/'package.json').is_file()and not wrong.exists();row['createdFilesReadback']={'actualRoot':str(actual),'package':json.loads((actual/'package.json').read_text()),'wrongRootAbsent':str(wrong)};save()
 run('decoy-unmodified-control',['validate','--json','--root',str(decoy)])
 after={str(root):{name:sha((root/name).read_bytes())for name in ['package.json','openclaw.plugin.json','index.ts']}for root in[selected,decoy]};assert after[str(decoy)]==before[str(decoy)];assert after[str(selected)]['index.ts']==before[str(selected)]['index.ts'];r['snapshots']={'before':before,'after':after};r['result']='GREEN10PASS'if mode=='green'else'BASE5RED_CONTROLS5PASS';assert len(r['cases'])==10
except Exception as e:r['result']='BLOCKED_OR_UNEXPECTED';r['error']=repr(e);save();raise
finally:r['cleanup']={'productionStateTouched':False,'externalRequests':False,'isolatedFixturesRetained':True};save()
