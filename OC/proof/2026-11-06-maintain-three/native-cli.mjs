import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';
export function prepare(checkoutArg,outArg){
 const checkout=path.resolve(checkoutArg),out=path.resolve(outArg);
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:checkout,encoding:'utf8'}),'');
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim();
 const buildStamp=JSON.parse(fs.readFileSync(path.join(checkout,'dist/.buildstamp'),'utf8'));
 assert.equal(buildStamp.head,sha);assert.equal(buildStamp.inputsClean,true);
 fs.mkdirSync(out,{recursive:false});for(const d of ['home','state','workspace'])fs.mkdirSync(path.join(out,d));
 const configPath=path.join(out,'config.json'),config={gateway:{mode:'local'},plugins:{allow:[],slots:{memory:'none'}},agents:{defaults:{workspace:path.join(out,'workspace')},entries:{main:{}}}};
 fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:path.join(out,'home'),USERPROFILE:path.join(out,'home'),OPENCLAW_STATE_DIR:path.join(out,'state'),OPENCLAW_CONFIG_PATH:configPath,OPENCLAW_NO_RESPAWN:'1',NODE_DISABLE_COMPILE_CACHE:'1',NO_COLOR:'1',TMPDIR:out};
 const receipt={at:new Date().toISOString(),sha,buildStamp,cases:[],result:'RUNNING'};
 const save=()=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
 async function run(args,label,overrides={}){
  const command=[process.execPath,path.join(checkout,'openclaw.mjs'),...args],started=performance.now();
  const child=spawn(command[0],command.slice(1),{cwd:checkout,env:{...env,...overrides},stdio:['ignore','pipe','pipe']});let stdout='',stderr='',watchdog=false;
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const stop=setTimeout(()=>{watchdog=true;child.kill('SIGTERM');},60000),force=setTimeout(()=>child.kill('SIGKILL'),75000);
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(stop);clearTimeout(force);
  fs.writeFileSync(path.join(out,label+'.stdout.log'),stdout);fs.writeFileSync(path.join(out,label+'.stderr.log'),stderr);
  const result={label,command,exit,watchdog,seconds:Math.round(performance.now()-started)/1000,stdout,stderr};receipt.cases.push(result);save();assert.equal(watchdog,false,'Scenario hit harness watchdog');return result;
 }
 return {checkout,out,env,config,configPath,receipt,save,run};
}
