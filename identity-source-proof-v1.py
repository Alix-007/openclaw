import hashlib,json,os,pathlib,subprocess,sys,time
w=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve();node=pathlib.Path(sys.argv[3]);mode=sys.argv[4]
assert mode in ['base','head'] and not out.exists()
out.mkdir(parents=True);cases=[];head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
receipt={'head':head,'mode':mode,'entry':'normal built openclaw.mjs agents set-identity','collectorSHA256':sha(pathlib.Path(__file__).read_bytes()),'cases':cases,'limitations':['Linux Node26 only; no Mac/Windows/native junction qualification','Synthetic task-owned config and identity files; no model, Gateway, or external channel calls']}
def save(): (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
specs=[(kind,form,'regression') for kind in ['identityFile','workspace'] for form in ['absolute','relative','home']]+[('identityFile','ordinary','control'),('workspace','ordinary','control'),('identityFile','alias','control'),('workspace','alias','control'),('workspace','selector','regression'),('identityFile','missing-parent','regression-refusal'),('workspace','missing-parent','regression-refusal'),('identityFile','file-parent','regression-refusal'),('workspace','file-parent','regression-refusal'),('identityFile','missing-leaf','refusal-control'),('workspace','missing-leaf','refusal-control'),('identityFile','blank','refusal-control'),('workspace','blank','refusal-control'),('workspace','no-import','control')]
try:
 for index,(kind,form,role) in enumerate(specs):
  label=f'{index:02d}-{kind}-{form}';f=out/label;logical=f/'logical';physical=f/'physical';source=physical/'source';neighbor=logical/'source';nested=physical/'nested';stored=f/'stored';home=f/'home'
  for p in [source,neighbor,nested,stored,home,f/'state',f/'tmp']:p.mkdir(parents=True,exist_ok=True)
  (logical/'link').symlink_to(nested,target_is_directory=True);(logical/'block').write_text('ordinary file\n');(f/'source-alias').symlink_to(source,target_is_directory=True);(f/'identity-alias.md').symlink_to(source/'IDENTITY.md')
  selected=b'- Name: Selected physical identity\n';decoy=b'- Name: Wrong lexical neighbor\n';(source/'IDENTITY.md').write_bytes(selected);(neighbor/'IDENTITY.md').write_bytes(decoy)
  raw=str(logical/'link')+'/../source'+('/IDENTITY.md' if kind=='identityFile' else '')
  if form=='relative':raw=os.path.relpath(logical/'link',f)+'/../source'+('/IDENTITY.md' if kind=='identityFile' else '')
  if form=='home':
   (home/'link').symlink_to(nested,target_is_directory=True);(home/'source').mkdir();(home/'source'/'IDENTITY.md').write_bytes(decoy);raw='~/link/../source'+('/IDENTITY.md' if kind=='identityFile' else '')
  if form=='ordinary':raw=str(source/('IDENTITY.md' if kind=='identityFile' else ''))
  if form=='alias':raw=str(f/('identity-alias.md' if kind=='identityFile' else 'source-alias'))
  if form in ['missing-parent','file-parent']:raw=str(logical/('absent' if form=='missing-parent' else 'block'))+'/../source'+('/IDENTITY.md' if kind=='identityFile' else '')
  if form=='missing-leaf':raw=str(f/'missing')+('/IDENTITY.md' if kind=='identityFile' else '')
  if form=='blank':raw='  '
  if form=='no-import':raw=str(f/'not-created')
  entries={'main':{'workspace':str(source if form=='selector' else stored),'identity':{'name':'Initial main'}},'other':{'workspace':str(neighbor),'identity':{'name':'Initial other'}}}
  config=f/'openclaw.json';before={'gateway':{'mode':'local'},'agents':{'ownership':'explicit','defaults':{'workspace':str(stored),'systemAgent':{'agentId':'main'}},'entries':entries},'plugins':{'allow':[],'slots':{'memory':'none'}}};original=(json.dumps(before)+'\n').encode();config.write_bytes(original);config.chmod(0o600)
  env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(home),'OPENCLAW_STATE_DIR':str(f/'state'),'OPENCLAW_CONFIG_PATH':str(config),'TMPDIR':str(f/'tmp'),'NO_COLOR':'1','OPENCLAW_NO_RESPAWN':'1'}
  command=[str(node),str(w/'openclaw.mjs'),'agents','set-identity']+([] if form=='selector' else ['--agent','main'])+['--identity-file' if kind=='identityFile' else '--workspace',raw]+(['--name','Explicit unchanged'] if form=='no-import' else ['--from-identity'])+['--json']
  start=time.monotonic();v=subprocess.run(command,cwd=f,env=env,capture_output=True,timeout=90);(f/'stdout.txt').write_bytes(v.stdout);(f/'stderr.txt').write_bytes(v.stderr);after=json.loads(config.read_bytes());(f/'config-before.json').write_bytes(original);(f/'config-after.json').write_bytes(config.read_bytes())
  row={'label':label,'kind':kind,'form':form,'role':role,'command':command,'cwd':str(f),'exitCode':v.returncode,'seconds':round(time.monotonic()-start,3),'stdout':v.stdout.decode(errors='replace'),'stderr':v.stderr.decode(errors='replace'),'stdoutSHA256':sha(v.stdout),'stderrSHA256':sha(v.stderr),'configBeforeSHA256':sha(original),'configAfterSHA256':sha(config.read_bytes()),'storedMainName':after['agents']['entries']['main']['identity']['name'],'storedOtherName':after['agents']['entries']['other']['identity']['name']}
  cases.append(row);save()
  assert (source/'IDENTITY.md').read_bytes()==selected and (neighbor/'IDENTITY.md').read_bytes()==decoy, row
  assert after['agents']['entries']['main']['workspace']==entries['main']['workspace'] and after['agents']['entries']['other']['workspace']==entries['other']['workspace'],row
  if role=='refusal-control' or (mode=='head' and role=='regression-refusal'):
   assert v.returncode!=0 and config.read_bytes()==original,row;row['observed']='refused with config byte-identical'
  elif mode=='base' and role.startswith('regression'):
   assert v.returncode==0 and any(e['identity']['name']=='Wrong lexical neighbor' for e in after['agents']['entries'].values()),row;row['observed']='RED: imported wrong lexical neighbor'
  else:
   expected='Explicit unchanged' if form=='no-import' else 'Selected physical identity'
   assert v.returncode==0 and after['agents']['entries']['main']['identity']['name']==expected and after['agents']['entries']['other']['identity']['name']=='Initial other',row
   row['observed']='GREEN: selected identity persisted; unrelated agent/workspaces unchanged'
  save()
 receipt['verdict']='EXPECTED-RED' if mode=='base' else 'GREEN';receipt['fileReadbackPassed']=True;save();print(json.dumps({'head':head,'verdict':receipt['verdict'],'cases':len(cases)}))
except BaseException as e:
 receipt['verdict']='HARNESS_OR_SETUP_FAILURE';receipt['error']=repr(e);save();raise
