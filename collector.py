"""Actual Template CLI source selection, authored files and archive destination readback."""
from pathlib import Path
import hashlib, json, os, subprocess, sys, tarfile, time
w,out,node=[Path(x).resolve() for x in sys.argv[1:4]];mode=sys.argv[4];assert mode in ('red','green');out.mkdir()
sha=lambda b:hashlib.sha256(b).hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip();stamp=json.loads((w/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=w).strip()
for name in ['home','state','tmp','fixtures']:(out/name).mkdir()
config=out/'openclaw.json';config.write_text(json.dumps({'plugins':{'allow':[],'slots':{'memory':'none'}}}))
env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(out/'home'),'OPENCLAW_STATE_DIR':str(out/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(out/'tmp'),'NO_COLOR':'1','OPENCLAW_DISABLE_BONJOUR':'1','OPENCLAW_NO_RESPAWN':'1'}
r={'head':head,'buildStamp':stamp,'collectorSHA256':sha(Path(__file__).read_bytes()),'mode':mode,'boundary':'normal built templates create/validate/inspect/build -> actual selected metadata, created files and tar archive readback','cases':[],'result':'RUNNING'}
def save():(out/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
def snapshot(root):return {str(f.relative_to(root)):sha(f.read_bytes()) for f in root.rglob('*') if f.is_file() and not f.is_symlink()}
def run(label,args,code=0):
 command=[str(node),str(w/'openclaw.mjs'),'templates',*args,'--json'];start=time.monotonic();p=subprocess.run(command,cwd=w,env=env,capture_output=True,timeout=90)
 (out/(label+'.stdout')).write_bytes(p.stdout);(out/(label+'.stderr')).write_bytes(p.stderr)
 row={'label':label,'command':command,'exitCode':p.returncode,'seconds':round(time.monotonic()-start,3),'stdout':p.stdout.decode(errors='replace'),'stderr':p.stderr.decode(errors='replace'),'stdoutSHA256':sha(p.stdout),'stderrSHA256':sha(p.stderr)}
 r['cases'].append(row);save();print(json.dumps({'label':label,'code':p.returncode}),flush=True);assert p.returncode==code,row
 row['value']=json.loads(p.stdout);return row
def archive(row,file,expected):
 assert file.is_file(),str(file)
 with tarfile.open(file,'r:gz') as package:
  metadata=json.load(package.extractfile('package/package.json'))
 assert metadata['name']==expected,metadata
 row['archiveReadback']={'path':str(file),'bytes':file.stat().st_size,'sha256':sha(file.read_bytes()),'packageName':metadata['name']};save()
try:
 root=out/'fixtures';physical=root/'physical';nested=physical/'nested';nested.mkdir(parents=True);(root/'selected').symlink_to(nested,target_is_directory=True)
 selected=physical/'source';decoy=root/'source';raw=str(root/'selected')+'/../source'
 for label,directory,name in [('physical-seed',selected,'physical-template'),('decoy-seed',decoy,'decoy-template')]:
  row=run(label,['create',str(directory),'--name',name,'--agent-id','proof-agent']);assert json.loads((directory/'package.json').read_text())['name']==name
 before={str(directory):snapshot(directory) for directory in [selected,decoy]}
 r['fixture']={'link':str(root/'selected'),'linkTarget':os.readlink(root/'selected'),'rawSource':raw,'filesystemRealpath':str(Path(raw).resolve()),'physicalRoot':str(selected),'decoyRoot':str(decoy)};assert Path(raw).resolve()==selected
 for op in ['validate','inspect']:
  row=run(op+'-ordinary-control',[op,str(selected)]);assert row['value']['source']['name']=='physical-template',row
  row=run(op+'-parent-traversal',[op,raw]);expected='decoy-template'if mode=='red'else'physical-template';assert row['value']['source']['name']==expected,row
  row['selectedSource']=row['value']['source'];save()
 for label,path,name in [('build-ordinary-control',str(selected),'physical-template'),('build-parent-traversal',raw,'decoy-template'if mode=='red'else'physical-template')]:
  artifact=out/(label+'.tgz');row=run(label,['build',path,'--out',str(artifact)]);archive(row,artifact,name)
 raw_new=str(root/'selected')+'/../new-template';row=run('create-parent-traversal',['create',raw_new,'--name','created-template','--agent-id','created-agent'])
 actual=(root if mode=='red'else physical)/'new-template';other=(physical if mode=='red'else root)/'new-template';assert (actual/'CLAW.md').is_file()and not other.exists();row['createdFilesReadback']={'actualRoot':str(actual),'files':snapshot(actual),'wrongRootAbsent':str(other)};save()
 raw_output=str(root/'selected')+'/../selected-output.tgz';row=run('build-output-parent-traversal',['build',str(selected),'--out',raw_output]);actual=(root if mode=='red'else physical)/'selected-output.tgz';other=(physical if mode=='red'else root)/'selected-output.tgz';archive(row,actual,'physical-template');assert not other.exists()
 # Existing final-link refusal must survive physical-parent repair.
 empty=root/'empty';empty.mkdir();alias=root/'final-link';alias.symlink_to(empty,target_is_directory=True);row=run('create-final-symlink-control',['create',str(alias),'--name','forbidden-template','--agent-id','forbidden-agent'],1);assert not list(empty.iterdir())and alias.is_symlink();row['noWriteReadback']={'targetEmpty':True,'symlinkRetained':True}
 artifact_target=root/'must-not-exist.tgz';artifact_link=root/'final-output.tgz';artifact_link.symlink_to(artifact_target);row=run('build-final-symlink-control',['build',str(selected),'--out',str(artifact_link)],1);assert artifact_link.is_symlink()and not artifact_target.exists();row['noWriteReadback']={'targetAbsent':True,'symlinkRetained':True}
 after={str(directory):snapshot(directory) for directory in [selected,decoy]};assert before==after;r['sourceSnapshots']={'before':before,'after':after}
 assert len(r['cases'])==12;r['result']='GREEN12PASS'if mode=='green'else'BASE5RED_CONTROLS7PASS'
except Exception as error:r['result']='BLOCKED_OR_UNEXPECTED';r['error']=repr(error);save();raise
finally:r['cleanup']={'productionStateTouched':False,'externalRequests':False,'isolatedFixturesRetained':True};save()
