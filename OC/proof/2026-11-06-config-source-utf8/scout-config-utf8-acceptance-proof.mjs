import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {prepare} from './native-cli.mjs';

const proof=prepare(process.argv[2],process.argv[3]);
const stable=path.resolve(process.argv[4]);
const stablePackage=JSON.parse(fs.readFileSync(path.join(stable,'package.json'),'utf8'));
assert.equal(stablePackage.name,'openclaw');assert.equal(stablePackage.version,'2026.11.1');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const name='Legal 中文 日本語 한글 😀 �';
proof.receipt.collectorSha256=hash(fs.readFileSync(new URL(import.meta.url)));
proof.receipt.nativeHelperSha256=hash(fs.readFileSync(new URL('./native-cli.mjs',import.meta.url)));
proof.receipt.stable={version:stablePackage.version,launcherSha256:hash(fs.readFileSync(path.join(stable,'openclaw.mjs'))),acquisition:JSON.parse(fs.readFileSync(path.join(stable,'../acquisition.json'),'utf8'))};
const observations=[];
function context(label){
 const dir=path.join(proof.out,label);fs.mkdirSync(dir);
 for(const d of ['home','state','workspace','next-workspace','final-workspace'])fs.mkdirSync(path.join(dir,d));
 const configPath=path.join(dir,'openclaw.json');
 const env={...proof.env,HOME:path.join(dir,'home'),USERPROFILE:path.join(dir,'home'),OPENCLAW_STATE_DIR:path.join(dir,'state'),OPENCLAW_CONFIG_PATH:configPath,TMPDIR:dir};
 const config=structuredClone(proof.config);config.gateway.port=19500;config.agents.defaults.workspace=path.join(dir,'workspace');config.agents.entries.main={name,workspace:path.join(dir,'workspace')};
 return{dir,configPath,env,config};
}
function ring(target){return Object.fromEntries(['','.bak','.bak.1','.bak.2','.bak.3','.bak.4'].map(s=>[s,fs.existsSync(target+s)?fs.readFileSync(target+s):null]));}
function sameRing(a,b){return Object.keys(a).every(k=>a[k]===null?b[k]===null:b[k]!==null&&a[k].equals(b[k]));}
function encoded(value,invalid=false){
 let b=Buffer.from(JSON.stringify(value,null,2)+'\n');
 if(invalid){const marker=Buffer.from(name),at=b.indexOf(marker);assert.ok(at>=0);b=Buffer.concat([b.subarray(0,at),Buffer.from('Synthetic '),Buffer.from([255]),Buffer.from(' name'),b.subarray(at+marker.length)]);}
 return Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),b]);
}
async function run(checkout,args,label,c){
 const command=[process.execPath,path.join(checkout,'openclaw.mjs'),...args];const started=performance.now();
 const child=spawn(command[0],command.slice(1),{cwd:checkout,env:c.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',watchdog=false;
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const stop=setTimeout(()=>{watchdog=true;child.kill('SIGTERM');},60000),force=setTimeout(()=>child.kill('SIGKILL'),75000);
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(stop);clearTimeout(force);
 fs.writeFileSync(path.join(c.dir,label+'.stdout.log'),stdout);fs.writeFileSync(path.join(c.dir,label+'.stderr.log'),stderr);
 const result={label,command,exit,watchdog,seconds:Math.round(performance.now()-started)/1000,stdout,stderr};proof.receipt.cases.push(result);proof.save();assert.equal(watchdog,false,'Harness watchdog is not product proof');return result;
}
try{
 for(const owner of ['root','include'])for(const invalid of [true,false]){
  const label=owner+'-'+(invalid?'malformed':'legal'),c=context(label);const target=owner==='root'?c.configPath:path.join(c.dir,'agent.json');
  if(owner==='include')c.config.agents.entries.main={$include:'./agent.json'};
  fs.writeFileSync(c.configPath,encoded(c.config,owner==='root'&&invalid));
  if(owner==='include')fs.writeFileSync(target,encoded({name,workspace:path.join(c.dir,'workspace')},invalid));
  for(let i=0;i<5;i++)fs.writeFileSync(target+'.bak'+(i?'.'+i:''),JSON.stringify({retainedBackup:i})+'\n');
  const original=ring(target),rootBefore=fs.readFileSync(c.configPath);
  fs.writeFileSync(path.join(c.dir,'before.bytes'),original['']);
  const args=owner==='root'?['config','set','gateway.port','19501']:['config','set','agents.entries.main.workspace',path.join(c.dir,'next-workspace')];
  const call=await run(proof.checkout,args,'candidate',c),after=ring(target);fs.writeFileSync(path.join(c.dir,'after.bytes'),after['']);
  const parsed=JSON.parse(after[''].toString('utf8').replace(/^\uFEFF/,''));const actualName=owner==='root'?parsed.agents.entries.main.name:parsed.name;
  const rootUnchanged=rootBefore.equals(fs.readFileSync(c.configPath));
  const controlPassed=call.exit.code===0&&actualName===name&&(owner==='root'?parsed.gateway.port===19501:parsed.workspace===path.join(c.dir,'next-workspace')&&rootUnchanged)&&after['.bak']?.equals(original[''])&&after['.bak.1']?.equals(original['.bak']);
  const red=call.exit.code===0&&actualName==='Synthetic � name'&&!original[''].equals(after['']);
  const green=call.exit.code!==0&&/valid UTF-8/.test(call.stderr)&&sameRing(original,after)&&(owner==='root'||rootUnchanged);
  const observation={label,owner,invalid,exit:call.exit,beforeSha256:hash(original['']),afterSha256:hash(after['']),unchanged:original[''].equals(after['']),rootUnchanged,beforeContainsFF:original[''].includes(255),afterContainsFF:after[''].includes(255),persistedName:actualName,ringBefore:Object.fromEntries(Object.entries(original).map(([k,v])=>[k,v===null?null:hash(v)])),ringAfter:Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v===null?null:hash(v)])),result:invalid?(green?'GREEN':red?'RED':'FAILED'):controlPassed?'PASS':'FAILED'};
  observations.push(observation);proof.receipt.observations=observations;proof.save();assert.notEqual(observation.result,'FAILED',label+' did not exercise the expected real boundary');
 }
 const c=context('stable-upgrade');c.config.agents.entries.main={$include:'./agent.json'};
 fs.writeFileSync(c.configPath,encoded(c.config));const includePath=path.join(c.dir,'agent.json');fs.writeFileSync(includePath,encoded({name,workspace:path.join(c.dir,'workspace')}));
 const workspaceFile=path.join(c.dir,'workspace','retained.txt'),workspaceBytes=Buffer.from('Existing workspace 中文 😀 �\n');fs.writeFileSync(workspaceFile,workspaceBytes);
 for(const [label,args]of [['stable-root',['config','set','gateway.port','19501']],['stable-include',['config','set','agents.entries.main.workspace',path.join(c.dir,'next-workspace')]]])assert.equal((await run(stable,args,label,c)).exit.code,0,label);
 const stableRoot=fs.readFileSync(c.configPath),stableInclude=fs.readFileSync(includePath);const beforeReadRoot=hash(stableRoot),beforeReadInclude=hash(stableInclude);
 const get=await run(proof.checkout,['config','get','agents.entries.main.name','--json'],'candidate-get',c);assert.equal(get.exit.code,0);assert.equal(JSON.parse(get.stdout),name);assert.equal(hash(fs.readFileSync(c.configPath)),beforeReadRoot);assert.equal(hash(fs.readFileSync(includePath)),beforeReadInclude);
 for(const [label,args]of [['candidate-root',['config','set','gateway.port','19502']],['candidate-include',['config','set','agents.entries.main.workspace',path.join(c.dir,'final-workspace')]]])assert.equal((await run(proof.checkout,args,label,c)).exit.code,0,label);
 const finalRoot=JSON.parse(fs.readFileSync(c.configPath,'utf8')),finalInclude=JSON.parse(fs.readFileSync(includePath,'utf8'));
 assert.equal(finalRoot.gateway.port,19502);assert.equal(finalRoot.agents.entries.main.$include,'./agent.json');assert.equal(finalInclude.name,name);assert.equal(finalInclude.workspace,path.join(c.dir,'final-workspace'));assert.deepEqual(fs.readFileSync(workspaceFile),workspaceBytes);assert.deepEqual(fs.readFileSync(c.configPath+'.bak'),stableRoot);assert.deepEqual(fs.readFileSync(includePath+'.bak'),stableInclude);
 proof.receipt.upgrade={result:'PASS',from:stablePackage.version,sameHomeStateAndFiles:true,name,rootBeforeCandidateSha256:beforeReadRoot,includeBeforeCandidateSha256:beforeReadInclude,finalRootSha256:hash(fs.readFileSync(c.configPath)),finalIncludeSha256:hash(fs.readFileSync(includePath)),workspaceUnchanged:true,rootAndIncludeBackupMatchStableWriter:true};
 const negatives=observations.filter(o=>o.invalid);assert.ok(negatives.every(o=>o.result==='RED')||negatives.every(o=>o.result==='GREEN'));
 proof.receipt.result=negatives[0].result;proof.receipt.cleanup='Dedicated synthetic home/state/config/include/backup/workspace files retained under output for inspection. No production config, channel, model or service was used. Remove only this output directory after archiving.';
 proof.receipt.limitations='Native Linux CLI/file publication proof. Explicit destructive-write and Doctor recovery compatibility are covered by owner regressions, not claimed as live commands here. The unrelated opaque pre-update snapshot is outside this fix.';proof.save();console.log(JSON.stringify({out:proof.out,result:proof.receipt.result,observations:observations.map(o=>({label:o.label,result:o.result,exit:o.exit,unchanged:o.unchanged,persistedName:o.persistedName})),upgrade:proof.receipt.upgrade},null,2));
}catch(error){proof.receipt.result='FAILED';proof.receipt.failure={name:error.name,message:error.message};proof.save();throw error;}
