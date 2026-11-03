import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';

export async function withIsolatedGateway(checkoutArg,outArg,prepare,run){
 const checkout=path.resolve(checkoutArg),out=path.resolve(outArg);
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:checkout,encoding:'utf8'}),'');
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim();
 const buildStamp=JSON.parse(fs.readFileSync(path.join(checkout,'dist/.buildstamp')));
 assert.equal(buildStamp.head,sha);assert.equal(buildStamp.inputsClean,true);
 fs.mkdirSync(out,{recursive:false});
 for(const name of ['home','state','workspace'])fs.mkdirSync(path.join(out,name));
 const portProbe=http.createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));
 const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
 const token=randomBytes(32).toString('hex');
 const config={gateway:{mode:'local',port,bind:'loopback',auth:{mode:'token',token}},logging:{file:path.join(out,'gateway-runtime.log'),level:'info',consoleLevel:'warn'},plugins:{allow:[]},agents:{defaults:{workspace:path.join(out,'workspace')},entries:{main:{}}}};
 await prepare({out,checkout,config});
 const configPath=path.join(out,'config.json');fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const configHash=createHash('sha256').update(fs.readFileSync(configPath)).digest('hex');
 const record={at:new Date().toISOString(),sha,buildStamp,domain:`ws://127.0.0.1:${port}`,calls:[],result:'RUNNING'};
 const save=()=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(record,(key,value)=>/^(?:token|password|secret|privateKey)$/i.test(key)?'[REDACTED]':value,2));save();
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:path.join(out,'home'),USERPROFILE:path.join(out,'home'),OPENCLAW_STATE_DIR:path.join(out,'state'),OPENCLAW_CONFIG_PATH:configPath,OPENCLAW_NO_RESPAWN:'1',NODE_DISABLE_COMPILE_CACHE:'1',NO_COLOR:'1',TMPDIR:out};
 const stdout=fs.openSync(path.join(out,'gateway.stdout.log'),'w'),stderr=fs.openSync(path.join(out,'gateway.stderr.log'),'w');
 record.command=[process.execPath,path.join(checkout,'openclaw.mjs'),'gateway','run','--bind','loopback','--port',String(port)];
 const child=spawn(record.command[0],record.command.slice(1),{cwd:checkout,env,stdio:['ignore',stdout,stderr]});
 let exited;const closed=new Promise(resolve=>child.on('close',(code,signal)=>{exited={code,signal};resolve();}));
 const {WebSocket}=createRequire(path.join(checkout,'package.json'))('ws');
 let socket;const pending=new Map();
 const rpc=async(method,params,startupAttempt=0)=>{
  const id=randomUUID();
  const response=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`RPC deadline: ${method}`));},30000);
   pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});
   socket.send(JSON.stringify({type:'req',id,method,params}));
  });
  if(method!=='connect')record.calls.push({method,params,response});save();
  if(!response.ok&&response.error?.retryable===true&&response.error?.details?.reason==='startup-sidecars'&&startupAttempt<120){
   await new Promise(resolve=>setTimeout(resolve,500));return rpc(method,params,startupAttempt+1);
  }
  assert.equal(response.ok,true,`${method}: ${JSON.stringify(response.error)}`);return response.payload;
 };
 try{
  const deadline=performance.now()+120000;
  for(;;){
   assert.equal(exited,undefined,`Gateway exited ${JSON.stringify(exited)}`);
   try{socket=await new Promise((resolve,reject)=>{const ws=new WebSocket(record.domain);ws.once('open',()=>resolve(ws));ws.once('error',reject);});break;}
   catch(error){if(performance.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,500));}
  }
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Handshake deadline')),30000);
   socket.on('message',raw=>{
    const frame=JSON.parse(raw.toString());
    if(frame.type==='res'){const handler=pending.get(frame.id);pending.delete(frame.id);handler?.resolve(frame);}
    if(frame.type==='event'&&frame.event==='connect.challenge'){
     rpc('connect',{minProtocol:4,maxProtocol:4,client:{id:'cli',version:'2026.10.9',platform:'linux',mode:'cli'},role:'operator',scopes:['operator.admin','operator.read','operator.write'],auth:{token}}).then(payload=>{record.connect={protocol:payload.protocol,role:payload.auth?.role,scopes:payload.auth?.scopes};clearTimeout(timer);resolve();},reject);
    }
   });
  });
  await run({out,checkout,config,record,rpc,save});
  record.result='PASS';save();console.log(JSON.stringify({sha,result:record.result,observation:record.observation,cases:record.cases}));
 }catch(error){record.result='SETUP_OR_PRODUCT_FAILURE';record.error=String(error);save();throw error;}
 finally{
  socket?.terminate();for(const entry of pending.values())entry.reject(new Error('Proof cleanup'));
  if(!exited)child.kill('SIGTERM');await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,10000))]);
  if(!exited){child.kill('SIGKILL');await closed;}
  record.cleanup={gatewayExit:exited,productionServicesTouched:false,externalChannels:false,isolatedStateRetained:true,configUnchanged:createHash('sha256').update(fs.readFileSync(configPath)).digest('hex')===configHash};save();
  fs.closeSync(stdout);fs.closeSync(stderr);
 }
 return record;
}
