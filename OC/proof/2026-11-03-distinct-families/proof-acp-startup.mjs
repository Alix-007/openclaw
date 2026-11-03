import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
const [checkoutArg,outArg,expected]=process.argv.slice(2);
const checkout=path.resolve(checkoutArg),out=path.resolve(outArg);
assert.ok(['base','head'].includes(expected));
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:checkout,encoding:'utf8'}),'');
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim();
const stamp=JSON.parse(fs.readFileSync(path.join(checkout,'dist/.buildstamp')));assert.equal(stamp.head,sha);assert.equal(stamp.inputsClean,true);
fs.mkdirSync(out,{recursive:false});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const cases=[];
for(const mode of ['initialize','newSession','ready'])for(const signal of ['SIGTERM','SIGINT']){
 const dir=path.join(out,`${mode}-${signal}`);fs.mkdirSync(dir);
 const state=path.join(dir,'fixture.json');
 const fixture=`const fs=require('node:fs'),readline=require('node:readline');
const out=${JSON.stringify(state)},mode=${JSON.stringify(mode)};
const state={pid:process.pid,requests:[],events:[]};const save=()=>{fs.writeFileSync(out+'.next',JSON.stringify(state,null,2));fs.renameSync(out+'.next',out);};save();
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{const req=JSON.parse(line);state.requests.push(req.method);save();let result;
 if(req.method==='initialize'){if(mode==='initialize')return;result={protocolVersion:req.params.protocolVersion,agentCapabilities:{},agentInfo:{name:'Synthetic ACP proof peer',version:'1.0.0'}};}
 else if(req.method==='session/new'){if(mode==='newSession')return;result={sessionId:'synthetic-proof-session'};}
 else if(req.id!==undefined)result={};
 if(result!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');
});
rl.on('close',()=>{state.events.push('stdin-eof');save();process.exit(0);});
process.on('SIGTERM',()=>{state.events.push('SIGTERM');save();process.exit(0);});
process.on('SIGINT',()=>{state.events.push('SIGINT');save();process.exit(0);});
`;
 fs.writeFileSync(path.join(dir,'acp'),fixture);
 const config=path.join(dir,'config.json');fs.writeFileSync(config,JSON.stringify({plugins:{slots:{memory:'none'}}}));
 const command=[process.execPath,path.join(checkout,'openclaw.mjs'),'acp','client','--server',process.execPath,'--cwd',dir,'--verbose'];
 const child=spawn(command[0],command.slice(1),{cwd:checkout,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:dir,USERPROFILE:dir,OPENCLAW_STATE_DIR:path.join(dir,'state'),OPENCLAW_CONFIG_PATH:config,OPENCLAW_NO_RESPAWN:'1',NODE_DISABLE_COMPILE_CACHE:'1',NO_COLOR:'1'},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='',exit;
 child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
 const closed=new Promise(resolve=>child.on('close',(code,signal)=>{exit={code,signal};resolve();}));
 const record={mode,signal,sha,command,result:'RUNNING'};let peer;
 const save=()=>fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(record,null,2));
 try{
  const deadline=performance.now()+30000;
  for(;;){
   assert.equal(exit,undefined,`CLI exited before fixture barrier: ${JSON.stringify(exit)} ${stderr}`);
   if(fs.existsSync(state)){peer=JSON.parse(fs.readFileSync(state));if(mode==='ready'?stdout.includes('Type a prompt'):peer.requests.includes(mode==='initialize'?'initialize':'session/new'))break;}
   assert.ok(performance.now()<deadline,'Fixture startup barrier timed out');await delay(25);
  }
  record.beforeSignal={cliPid:child.pid,peerPid:peer.pid,fixture:peer,cliAlive:alive(child.pid),peerAlive:alive(peer.pid)};
  record.signalDelivery='CLI PID only; peer PID and process group not signalled by driver';save();
  const start=performance.now();child.kill(signal);
  await Promise.race([closed,delay(3500)]);
  record.afterSignal={elapsedMs:Math.round(performance.now()-start),cliExit:exit??null,peerAlive:alive(peer.pid),fixture:JSON.parse(fs.readFileSync(state))};save();
  if(mode!=='ready'&&expected==='base'){
   assert.equal(exit,undefined,'Expected baseline startup owner to remain pending');assert.equal(alive(peer.pid),true);
   record.observation='RED: interrupting ACP startup leaves CLI and its initialized peer running';
  }else{
   assert.ok(exit,'CLI must settle after signal');assert.equal(exit.signal,null);assert.equal(exit.code,signal==='SIGTERM'?143:130);
   assert.equal(alive(peer.pid),false,'Peer must be joined before CLI exits');
   record.observation=mode==='ready'?'CONTROL: interactive signal still joins its peer and preserves signal exit code':'GREEN: startup signal settles handshake, joins peer and preserves signal exit code';
  }
  record.result='PASS';save();
 }catch(error){record.result='SETUP_OR_PRODUCT_FAILURE';record.error=String(error);save();throw error;}
 finally{
  if(!exit)child.kill('SIGKILL');
  if(peer&&alive(peer.pid)){try{process.kill(peer.pid,'SIGTERM');}catch{}}
  child.stdin.destroy();await Promise.race([closed,delay(2000)]);
  if(peer&&alive(peer.pid)){try{process.kill(peer.pid,'SIGKILL');}catch{}}
  record.cleanup={cliExit:exit??null,peerStillAlive:peer?alive(peer.pid):null,productionServicesTouched:false,externalModelsOrChannels:false};save();
  fs.writeFileSync(path.join(dir,'stdout.log'),stdout);fs.writeFileSync(path.join(dir,'stderr.log'),stderr);
 }
 cases.push(record);
 console.log(JSON.stringify({mode,signal,result:record.result,observation:record.observation,afterSignal:record.afterSignal,cleanup:record.cleanup}));
}
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({sha,expected,cases},null,2));
