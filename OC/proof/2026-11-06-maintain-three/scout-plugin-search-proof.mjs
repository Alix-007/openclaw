import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {prepare} from './native-cli.mjs';
const p=prepare(process.argv[2],process.argv[3]);const sockets=new Set();let dispatch;
const server=http.createServer((req,res)=>dispatch?.(req,res));server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const registry='http://127.0.0.1:'+server.address().port;
async function scenario(signal){
 const label=signal??'control',requests=[],responses=[];let recorderReady,acknowledge,closedRequests;const ready=new Promise(resolve=>recorderReady=resolve),ack=new Promise(resolve=>acknowledge=resolve),allClosed=new Promise(resolve=>closedRequests=resolve);
 dispatch=(req,res)=>{const row={at:new Date().toISOString(),path:req.url,closed:false,responded:false};requests.push(row);responses.push(res);req.on('close',()=>{row.closed=true;row.closedAt=new Date().toISOString();if(requests.length===2&&requests.every(item=>item.closed))closedRequests();});res.on('finish',()=>row.responded=true);if(requests.length===2)recorderReady();};
 const command=[process.execPath,path.join(p.checkout,'openclaw.mjs'),'plugins','search','scout-cancel-control','--json'];const child=spawn(command[0],command.slice(1),{cwd:p.checkout,env:{...p.env,OPENCLAW_CLAWHUB_URL:registry,CLAWHUB_CONFIG_PATH:path.join(p.out,'no-clawhub-config.json'),CLAWHUB_DISABLE_TELEMETRY:'1'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='',exited=false;
 child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>{stderr+=bytes;if(signal&&stderr.includes('Command interrupted by '+signal))acknowledge();});
 const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,exitSignal)=>{exited=true;resolve({code,signal:exitSignal});});});let watchdog=false;const guard=setTimeout(()=>{watchdog=true;child.kill('SIGKILL');},25000);const started=performance.now();let timer;
 try{
  await Promise.race([ready,completion.then(exit=>{throw new Error('CLI exited before registry recorder: '+JSON.stringify({exit,stdout,stderr}));})]);
  const families=requests.map(row=>new URL(row.path,registry).searchParams.get('family')).toSorted();assert.deepEqual(families,['bundle-plugin','code-plugin']);
  let observation;
  if(signal){
   child.kill(signal);await Promise.race([ack,completion]);
   const closedBeforeRelease=await Promise.race([allClosed.then(()=>true),new Promise(resolve=>timer=setTimeout(()=>resolve(false),1500))]);clearTimeout(timer);
   observation={signalAcknowledged:stderr.includes('Command interrupted by '+signal),observationLimitMs:1500,closedBeforeRelease,openRequests:requests.filter(row=>!row.closed).length,alive:!exited};
  }
  for(const response of responses){if(!response.destroyed)response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({results:[]}));}
  const exit=await completion;const result={label,command,requests,observation,exit,watchdog,seconds:Math.round(performance.now()-started)/1000,stdout,stderr};
  assert.equal(watchdog,false,'Harness watchdog terminated the product');assert.equal(exit.signal,null);assert.equal(exit.code,signal==='SIGINT'?130:signal==='SIGTERM'?143:0);
  if(!signal)assert.deepEqual(JSON.parse(stdout),{results:[]});
  fs.writeFileSync(path.join(p.out,label+'.stdout.log'),stdout);fs.writeFileSync(path.join(p.out,label+'.stderr.log'),stderr);fs.writeFileSync(path.join(p.out,label+'.json'),JSON.stringify(result,null,2));return result;
 }finally{clearTimeout(timer);clearTimeout(guard);if(!exited){child.kill('SIGKILL');await completion;}}
}
try{for(const signal of [undefined,'SIGINT','SIGTERM']){p.receipt.cases.push(await scenario(signal));p.save();}p.receipt.result=p.receipt.cases.slice(1).every(row=>row.observation.closedBeforeRelease&&row.observation.openRequests===0&&row.stdout.trim()==='')?'GREEN':'RED';p.save();console.log(JSON.stringify(p.receipt,null,2));}finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
