import {createRequire} from 'node:module';
const [checkout,heldMethod,interrupt,kind]=process.argv.slice(2);
const require=createRequire(checkout+'/package.json');
const {WebSocketServer}=require('ws');
const server=new WebSocketServer({host:'127.0.0.1',port:0});
const timers=new Set();let nextConnection=0;
const emitGlobal=value=>process.stdout.write(JSON.stringify({...value,at:performance.now()})+'\n');
const job={id:'synthetic-job-1',name:'Synthetic cron proof',enabled:true,createdAtMs:1,updatedAtMs:1,schedule:{kind:'every',everyMs:60000},sessionTarget:'isolated',wakeMode:'now',payload:{kind:'agentTurn',message:'Synthetic proof only'},state:{}};
const scratch={ok:true,scratch:{jobId:job.id,content:'synthetic scratch content\n',revision:3,updatedAtMs:1},currentRevision:3,maxBytes:262144};
server.on('listening',()=>emitGlobal({event:'listening',url:'ws://127.0.0.1:'+server.address().port}));
server.on('connection',socket=>{
 const connectionId=++nextConnection;const emit=value=>emitGlobal({...value,connectionId});emit({event:'peer-connected'});
 socket.on('close',()=>emit({event:'peer-closed'}));socket.on('error',error=>emit({event:'peer-error',message:error.code??error.name}));
 const hello={type:'hello-ok',protocol:4,server:{version:'synthetic-cron-read-proof',connId:'proof-cron-read'},features:{methods:['cron.status','cron.get','cron.runs','cron.scratch.get','cron.scratch.set','cron.update'],events:['connect.challenge']},snapshot:{},auth:{role:'operator',scopes:['operator.read','operator.write','operator.admin']},policy:{maxPayload:1000000,maxBufferedBytes:1000000,tickIntervalMs:60000}};
 socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'synthetic-cron-proof',ts:Date.now()}}));
 socket.on('message',raw=>{
  const frame=JSON.parse(raw.toString());emit({event:'request',method:frame.method,id:frame.id,params:frame.params});
  const payload=frame.method==='connect'?hello:frame.method==='cron.status'?{enabled:true,storage:'synthetic',jobs:1}:frame.method==='cron.get'?job:frame.method==='cron.runs'?{entries:[{jobId:job.id,runId:'synthetic-run-1',status:'ok',ts:1}],total:1,offset:0,limit:50,hasMore:false}:frame.method==='cron.scratch.get'?scratch:frame.method==='cron.scratch.set'?{ok:true,scratch:null,currentRevision:4,maxBytes:262144}:frame.method==='cron.update'?{...job,enabled:true}:null;
  const fail=kind.endsWith('-error')&&frame.method!=='connect';
  const respond=()=>socket.send(JSON.stringify(fail?{type:'res',id:frame.id,ok:false,error:{code:'INVALID_REQUEST',message:'synthetic cron read failure'}}:{type:'res',id:frame.id,ok:true,payload}));
  if(interrupt==='true'&&frame.method===heldMethod){emit({event:'read-held',method:frame.method});const timer=setTimeout(()=>{timers.delete(timer);if(socket.readyState===1){respond();emit({event:'held-response-released',method:frame.method});}},kind.startsWith('writer-')?600:6000);timers.add(timer);}else{respond();emit({event:'response',method:frame.method});}
 });
});
process.on('SIGTERM',()=>{for(const timer of timers)clearTimeout(timer);for(const socket of server.clients)socket.terminate();server.close(()=>process.exitCode=0);});
