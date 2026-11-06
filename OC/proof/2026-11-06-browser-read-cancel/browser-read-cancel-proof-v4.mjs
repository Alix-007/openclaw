import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {prepare} from './native-cli.mjs';

const [checkout='baseline',output='browser-read-cancel-proof-base-v4',mode='base']=process.argv.slice(2);
assert.ok(['base','head'].includes(mode));
const f=prepare(checkout,output);
if(mode==='base')assert.equal(f.receipt.sha,'5bd69e0a3365a3095df1d34576a6885de6fdf5d3');
f.receipt.collectorSha256=createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex');
f.receipt.mode=mode;
f.receipt.boundary='Normal built CLI -> actual Gateway client WebSocket -> synthetic loopback Gateway protocol peer. No real Chrome or server/browser implementation claim.';
const {WebSocketServer}=createRequire(path.join(f.checkout,'package.json'))('ws');
f.config.plugins.allow=['browser'];
f.config.plugins.entries={browser:{enabled:true}};
fs.writeFileSync(f.configPath,JSON.stringify(f.config),{mode:0o600});
const server=new WebSocketServer({host:'127.0.0.1',port:0});
await new Promise(resolve=>server.once('listening',resolve));
const endpoint=`ws://127.0.0.1:${server.address().port}`;
const status={enabled:true,profile:'synthetic-read-only',running:false,cdpReady:false,cdpHttp:false,cdpPort:0,cdpUrl:'http://127.0.0.1:0',chosenBrowser:null,executablePath:null,color:'#0088ff',headless:true,noSandbox:false,attachOnly:true};
async function runCase(command,interrupt){
 const [verb,...flags]=command.split(' ');
 const post=verb==='start'||verb==='focus';
 const retained=post||flags.includes('--clear')||flags.includes('--labels');
 const record={command,interrupt,post,retained,frames:[]};
 f.receipt.cases.push(record);f.save();
 const started=performance.now();let child,stdout='',stderr='',observed=false,closed=false,interruptAt,replyDelay;
 let resolveObservation,rejectObservation;
 const observedPromise=new Promise((resolve,reject)=>{resolveObservation=resolve;rejectObservation=reject;});
 const onConnection=socket=>{
  socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'synthetic-browser-read-proof',ts:Date.now()}}));
  socket.on('close',()=>{record.socketClosedAtMs=Math.round(performance.now()-started);f.save();});
  socket.on('message',raw=>{
   try{
    const frame=JSON.parse(raw.toString());
    record.frames.push({method:frame.method,params:frame.method==='connect'?{client:frame.params?.client,role:frame.params?.role,scopes:frame.params?.scopes}:frame.params});f.save();
    const reply=payload=>{if(socket.readyState===1)socket.send(JSON.stringify({type:'res',id:frame.id,ok:true,payload}));};
    if(frame.method==='connect'){
     reply({type:'hello-ok',protocol:4,server:{version:'synthetic',connId:'read-cancellation-proof'},features:{methods:['browser.request'],events:[]},snapshot:{presence:[],health:{},stateVersion:{presence:0,health:0},uptimeMs:0},auth:{role:'operator',scopes:['operator.admin']},policy:{maxPayload:1048576,maxBufferedBytes:1048576,tickIntervalMs:30000}});return;
    }
    assert.equal(frame.method,'browser.request');
    // start intentionally performs a follow-up status GET after its accepted POST receipt.
    if(observed){assert.equal(command,'start');assert.equal(frame.params.method,'GET');assert.equal(frame.params.path,'/');reply(status);return;}
    assert.equal(frame.params.method,post?'POST':'GET');
    assert.equal(frame.params.path,verb==='status'?'/':verb==='start'?'/start':verb==='focus'?'/tabs/focus':`/${verb}`);
    if(verb==='errors'||verb==='requests')assert.equal(frame.params.query?.clear,String(flags.includes('--clear')));
    if(verb==='snapshot')assert.equal(frame.params.query?.labels,flags.includes('--labels')?'true':undefined);
    if(command==='focus')assert.equal(frame.params.body.targetId,'synthetic-owned-target');
    observed=true;
    const payload=verb==='status'?status:verb==='tabs'?{running:false,tabs:[]}:verb==='errors'?{errors:[{timestamp:'2026-11-06T00:00:00Z',message:'synthetic retained error receipt'}]}:verb==='requests'?{requests:[{timestamp:'2026-11-06T00:00:00Z',method:'GET',url:'https://synthetic.invalid/receipt'}]}:verb==='snapshot'?{ok:true,format:'ai',targetId:'synthetic-owned-target',snapshot:'synthetic snapshot receipt',refs:{},...(flags.includes('--labels')?{imagePath:'/synthetic/receipt-only/browser-labels.png',labels:true}:{})}:{ok:true};
    record.expectedPayload=payload;
    if(!interrupt){reply(payload);resolveObservation();return;}
    interruptAt=performance.now();record.interruptAtMs=Math.round(interruptAt-started);child.kill('SIGINT');
    replyDelay=setTimeout(()=>{
     record.aliveBeforeFixtureRelease=!closed;
     record.releaseAtMs=Math.round(performance.now()-started);
     record.responseSent=socket.readyState===1;
     reply(payload);f.save();resolveObservation();
    },1500);
   }catch(error){rejectObservation(error);}
  });
 };
 server.on('connection',onConnection);
 const args=[path.join(f.checkout,'openclaw.mjs'),'browser','--json','--url',endpoint,'--token','synthetic-loopback-token','--timeout','10000',verb,...flags,...verb==='focus'?['synthetic-owned-target']:[]];
 record.executable=process.execPath;record.args=args;
 child=spawn(process.execPath,args,{cwd:f.checkout,env:f.env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{closed=true;record.exit={code,signal};record.elapsedMs=Math.round(performance.now()-started);if(interruptAt)record.exitAfterInterruptMs=Math.round(performance.now()-interruptAt);if(!observed)rejectObservation(new Error('CLI exited before reaching browser RPC'));resolve();});});
 const watchdog=setTimeout(()=>{record.watchdog=true;child.kill('SIGKILL');rejectObservation(new Error('Proof watchdog'));},45000);
 try{
  await observedPromise;await exit;assert.equal(record.watchdog,undefined);
  if(!interrupt){assert.equal(record.exit.code,0);assert.deepEqual(JSON.parse(stdout),command==='tabs'?{tabs:[]}:record.expectedPayload);}
  else{
   assert.equal(record.exit.code,130);
   if(retained){assert.equal(record.aliveBeforeFixtureRelease,true,'Accepted side effects must retain settlement until receipt');assert.equal(record.responseSent,true);if(verb!=='start')assert.deepEqual(JSON.parse(stdout),command==='tabs'?{tabs:[]}:record.expectedPayload);if(verb==='start'&&mode==='base')assert.equal(JSON.parse(stdout).profile,status.profile);}
   else if(mode==='base'){assert.equal(record.aliveBeforeFixtureRelease,true);assert.equal(record.responseSent,true);JSON.parse(stdout);}
   else{assert.equal(record.aliveBeforeFixtureRelease,false,'Cancelled GET must exit before delayed response release');assert.equal(record.responseSent,false);assert.ok(record.socketClosedAtMs<record.releaseAtMs);assert.equal(stdout,'','Cancelled GET must not print stale JSON');}
  }
  record.result='PASS';
 }finally{
  clearTimeout(watchdog);clearTimeout(replyDelay);server.removeListener('connection',onConnection);
  if(!closed){child.kill('SIGKILL');await exit;}
  fs.writeFileSync(path.join(f.out,`${command.replace(/\W/g,'-')}-${interrupt?'interrupted':'control'}.stdout.log`),stdout);
  fs.writeFileSync(path.join(f.out,`${command.replace(/\W/g,'-')}-${interrupt?'interrupted':'control'}.stderr.log`),stderr);
  record.stdout=stdout;record.stderr=stderr;f.save();
 }
}
try{
 for(const command of ['status','tabs'])await runCase(command,false);
 for(const command of ['status','tabs','errors','requests','snapshot'])await runCase(command,true);
 for(const command of ['focus','start','errors --clear','requests --clear','snapshot --labels'])await runCase(command,true);
 f.receipt.result=mode==='base'?'RED_REPRODUCED_WITH_CONTROLS':'GREEN_WITH_CONTROLS';
 f.receipt.limitations=['Loopback Gateway protocol peer; no real Chrome/backend operation was run.','POST start can perform a later status GET; only already-accepted POST settlement, exit130 and the pure focus receipt are invariant controls.','Clear-record and labels responses are synthetic protocol receipts only, not a claim of real browser-record deletion or image-file creation.','No changed public config/protocol or production channels exercised.'];
}catch(error){f.receipt.result='BLOCKED';f.receipt.error=String(error);throw error;}
finally{
 for(const client of server.clients)client.terminate();await new Promise(resolve=>server.close(resolve));
 for(const name of ['home','state','workspace'])fs.rmSync(path.join(f.out,name),{recursive:true,force:true});
 f.receipt.cleanup={privateStateRemoved:true,externalChannels:false,productionTouched:false};f.save();
}
console.log(JSON.stringify({result:f.receipt.result,sha:f.receipt.sha,collectorSha256:f.receipt.collectorSha256,cases:f.receipt.cases.map(c=>({command:c.command,interrupt:c.interrupt,exit:c.exit,exitAfterInterruptMs:c.exitAfterInterruptMs,aliveBeforeFixtureRelease:c.aliveBeforeFixtureRelease,result:c.result}))}));
