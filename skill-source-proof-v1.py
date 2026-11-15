"""Built skills install CLI -> actual local installation -> installed byte/origin readback."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,time
w,out,node=map(lambda x:Path(x).resolve(),sys.argv[1:4]);mode=sys.argv[4];assert mode in('red','green');out.mkdir()
sha=lambda b:hashlib.sha256(b).hexdigest();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip();stamp=json.loads((w/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=w).strip()
r={'head':head,'mode':mode,'collectorSHA256':sha(Path(__file__).read_bytes()),'buildStamp':stamp,'cases':[],'result':'RUNNING'}
def save():(out/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
def source(d,label):
 d.mkdir(parents=True,exist_ok=True);text=f'---\nname: proof-local-guide\ndescription: Synthetic local installation proof\n---\n\n{label}\n';(d/'SKILL.md').write_text(text);(d/'asset.txt').write_text(label+'\n');return text
try:
 for leaf in ['home','state','workspace','tmp','fixtures/physical/nested']:(out/leaf).mkdir(parents=True,exist_ok=True)
 f=out/'fixtures';ordinary=source(f/'ordinary','ORDINARY');literal=source(f/'source ','LITERAL_TRAILING_SPACE');trimmed=source(f/'source','DECOY_TRIMMED');physical=source(f/'physical/bundle','PHYSICAL_SOURCE');lexical=source(f/'bundle','DECOY_LEXICAL');(f/'selected').symlink_to(f/'physical/nested',target_is_directory=True)
 config=out/'openclaw.json';config.write_text(json.dumps({'gateway':{'mode':'local'},'agents':{'defaults':{'workspace':str(out/'workspace')},'entries':{'main':{}}},'plugins':{'allow':[],'slots':{'memory':'none'}}}));config.chmod(0o600)
 env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(out/'home'),'OPENCLAW_STATE_DIR':str(out/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(out/'tmp'),'NO_COLOR':'1','OPENCLAW_NO_RESPAWN':'1'}
 baseline={str(x):sha(x.read_bytes())for x in f.rglob('*')if x.is_file()}
 for label,raw,expected,old in [('ordinary',str(f/'ordinary'),ordinary,ordinary),('trailing-space',str(f/'source '),literal,trimmed),('physical-parent',str(f/'selected')+'/../bundle',physical,lexical)]:
  slug='proof-'+label;command=[str(node),str(w/'openclaw.mjs'),'skills','install',raw,'--agent','main','--as',slug];start=time.monotonic();v=subprocess.run(command,cwd=w,env=env,capture_output=True,timeout=120);(out/(label+'.stdout')).write_bytes(v.stdout);(out/(label+'.stderr')).write_bytes(v.stderr);row={'label':label,'command':command,'exitCode':v.returncode,'seconds':round(time.monotonic()-start,3),'stdout':v.stdout.decode(errors='replace'),'stderr':v.stderr.decode(errors='replace'),'stdoutSHA256':sha(v.stdout),'stderrSHA256':sha(v.stderr)};r['cases'].append(row);save();assert v.returncode==0,row
  target=out/'workspace/skills'/slug;actual=(target/'SKILL.md').read_text();assert actual==(expected if mode=='green'else old),(label,actual);asset=(target/'asset.txt').read_text();assert asset in actual
  origin=json.loads((target/'.openclaw/source-origin.json').read_text());assert origin['source']=='path' and origin['slug']==slug,origin
  row['readback']={'installedSkill':actual,'installedSkillSHA256':sha((target/'SKILL.md').read_bytes()),'asset':asset,'origin':origin,'selectedSourceMatches':actual==expected};save();print(json.dumps({'label':label,'exitCode':v.returncode}),flush=True)
 assert all(sha(Path(name).read_bytes())==digest for name,digest in baseline.items())
 r['result']='GREEN3_SELECTED_SOURCES_INSTALLED'if mode=='green'else'BASE2_WRONG_SKILLS_ORDINARY_CONTROL_PASS';r['sourceIntegrity']={'count':len(baseline),'allUnchanged':True}
except Exception as e:r['result']='BLOCKED_OR_UNEXPECTED';r['error']=repr(e);save();raise
finally:r['cleanup']={'productionStateTouched':False,'externalNetwork':False,'isolatedFixturesRetained':True};save()
