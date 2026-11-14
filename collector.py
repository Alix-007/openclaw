"""Actual plugin authoring CLI and bundle script, immutable output bytes and metadata readback."""
import hashlib,json,os,subprocess,sys,time
from pathlib import Path
w,out,node=map(lambda s:Path(s).resolve(),sys.argv[1:4]);mode=sys.argv[4];assert mode in ('red','green');out.mkdir();sha=lambda b:hashlib.sha256(b).hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip();stamp=json.loads((w/'dist/.buildstamp').read_text());assert stamp['head']==head and stamp['inputsClean'];assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=w).strip()
r={'head':head,'buildStamp':stamp,'collectorSHA256':sha(Path(__file__).read_bytes()),'mode':mode,'boundary':'normal built plugins build/check/validate and actual bundled UI script -> generated asset bytes and authored/generated manifest readback','cases':[],'result':'RUNNING'}
def save():(out/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
for leaf in ['home','state','workspace','tmp']:(out/leaf).mkdir()
config=out/'openclaw.json';config.write_text(json.dumps({'plugins':{'allow':[],'slots':{'memory':'none'}}}));env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(out/'home'),'OPENCLAW_STATE_DIR':str(out/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(out/'tmp'),'NO_COLOR':'1','OPENCLAW_DISABLE_BONJOUR':'1','OPENCLAW_NO_RESPAWN':'1'}
def run(label,root,args,expect_code):
 before={f:sha((root/f).read_bytes())for f in ['package.json','openclaw.plugin.json']};start=time.monotonic();command=[str(node),*args];p=subprocess.run(command,env=env,cwd=w,capture_output=True,timeout=90)
 (out/(label+'.stdout')).write_bytes(p.stdout);(out/(label+'.stderr')).write_bytes(p.stderr);after={f:sha((root/f).read_bytes())for f in before};row={'label':label,'command':command,'exitCode':p.returncode,'seconds':round(time.monotonic()-start,3),'inputBefore':before,'inputAfter':after,'stdoutSHA256':sha(p.stdout),'stderrSHA256':sha(p.stderr),'stdout':p.stdout.decode(errors='replace'),'stderr':p.stderr.decode(errors='replace')};r['cases'].append(row);save();print(json.dumps(row),flush=True);assert p.returncode==expect_code,row;return row
def json5(manifest):return '// Native manifest: supported JSON5\n'+json.dumps(manifest,ensure_ascii=False,indent=2).replace('"id":','id:',1).replace('\n}',',\n}')+'\n'
try:
 for ui in [False,True]:
  root=out/('with-ui'if ui else'without-ui');root.mkdir();(root/'node_modules').mkdir();(root/'node_modules/esbuild').symlink_to(w/'node_modules/esbuild',target_is_directory=True)
  package={'name':'openclaw-plugin-json5-proof','version':'1.0.0','type':'module','openclaw':{'extensions':['./index.ts'],**({'controlUi':'./view.ts'}if ui else{})}};(root/'package.json').write_text(json.dumps(package))
  (root/'index.ts').write_text('import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";\nexport default defineToolPlugin({id:"json5-proof",name:"JSON5 Proof",description:"Synthetic plugin",tools:(tool)=>[tool({name:"proof_echo",description:"Synthetic tool",parameters:{type:"object",properties:{}},execute:async()=>({ok:true})})]});\n')
  (root/'view.ts').write_text('export const proofMarker = "json5-native-control-ui-proof";\n')
  (root/'openclaw.plugin.json').write_text(json.dumps({'id':'json5-proof','name':'JSON5 Proof','configSchema':{'type':'object','properties':{}}}))
  label='ui'if ui else'tool';seed=run(label+'-seed',root,[str(w/'openclaw.mjs'),'plugins','build','--root',str(root)],0)
  manifest=json.loads((root/'openclaw.plugin.json').read_text());manifest['proofMetadata']='authored-value-preserved';authored=json5(manifest);(root/'openclaw.plugin.json').write_text(authored);(root/'authored-input.json5').write_text(authored)
  for op,args in [('check',['build','--check']),('validate',['validate','--json'])]:
   row=run(label+'-json5-'+op,root,[str(w/'openclaw.mjs'),'plugins',*args,'--root',str(root)],1 if ui and mode=='red'else 0);assert row['inputBefore']==row['inputAfter'],row
  if ui:
   script=run('ui-json5-bundled-script',root,['--import',str(w/'scripts/tsx.mjs'),str(w/'scripts/build-plugin-control-ui.mts'),str(root)],1 if mode=='red'else 0);assert script['inputBefore']==script['inputAfter'],script
   if mode=='green':
    generated=json.loads((root/'dist/openclaw.plugin.json').read_text());entry=root/generated['controlUi']['entry'];assert b'json5-native-control-ui-proof'in entry.read_bytes();script['artifactReadback']={'entry':str(entry),'bytes':entry.stat().st_size,'sha256':sha(entry.read_bytes()),'authoredMetadata':generated['proofMetadata']}
  row=run(label+'-json5-build',root,[str(w/'openclaw.mjs'),'plugins','build','--root',str(root)],1 if ui and mode=='red'else 0)
  if ui and mode=='red':assert row['inputBefore']==row['inputAfter']
  else:
   saved=json.loads((root/'openclaw.plugin.json').read_text());assert saved['proofMetadata']=='authored-value-preserved'
   row['authoredMetadataReadback']=saved['proofMetadata']
   if ui:
    entry=root/saved['controlUi']['entry'];assert b'json5-native-control-ui-proof'in entry.read_bytes();row['artifactReadback']={'entry':str(entry),'bytes':entry.stat().st_size,'sha256':sha(entry.read_bytes())}
  save()
 r['result']='GREEN9PASS'if mode=='green'else'BASE4RED_CONTROLS5PASS'
except Exception as error:r['result']='BLOCKED_OR_UNEXPECTED';r['error']=repr(error);save();raise
finally:r['cleanup']={'productionStateTouched':False,'isolatedFixturesRetained':True,'externalRequests':False};save()
