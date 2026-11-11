import {createRequire} from 'node:module';
const [checkout,heldMethod,interrupt,kind]=process.argv.slice(2);
const require=createRequire(checkout+'/package.json');
const {WebSocketServer}=require('ws');
const server=new WebSocketServer({host:'127.0.0.1',port:0});
const timers=new Set();let nextConnection=0;
const emitGlobal=value=>process.stdout.write(JSON.stringify({...value,at:performance.now()})+'\n');
const profile={id:'synthetic-profile-1',displayName:'Synthetic User',emails:['synthetic@example.invalid']};
server.on('listening',()=>emitGlobal({event:'listening',url:'ws://127.0.0.1:'+server.address().port}));
server.on('connection',socket=>{
 const connectionId=++nextConnection;const emit=value=>emitGlobal({...value,connectionId});emit({event:'peer-connected'});
 socket.on('close',()=>emit({event:'peer-closed'}));socket.on('error',error=>emit({event:'peer-error',message:error.code??error.name}));
 const hello={type:'hello-ok',protocol:4,server:{version:'synthetic-users-read-proof',connId:'proof-users-read'},features:{methods:['users.list','users.linkEmail','users.merge'],events:['connect.challenge']},snapshot:{},auth:{role:'operator',scopes:['operator.read','operator.write','operator.admin']},policy:{maxPayload:1000000,maxBufferedBytes:1000000,tickIntervalMs:60000}};
 socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'synthetic-users-proof',ts:Date.now()}}));
 socket.on('message',raw=>{
  const frame=JSON.parse(raw.toString());emit({event:'request',method:frame.method,id:frame.id,params:frame.params});
  const payload=frame.method==='connect'?hello:frame.method==='users.list'?{profiles:[profile]}:frame.method==='users.linkEmail'?{profile}:frame.method==='users.merge'?{profile,movedAliasKinds:['email']}:null;
  const fail=kind.endsWith('-error')&&frame.method!=='connect';
  const respond=()=>socket.send(JSON.stringify(fail?{type:'res',id:frame.id,ok:false,error:{code:'INVALID_REQUEST',message:'synthetic users read failure'}}:{type:'res',id:frame.id,ok:true,payload}));
  if(interrupt==='true'&&frame.method===heldMethod){emit({event:'read-held',method:frame.method});const timer=setTimeout(()=>{timers.delete(timer);if(socket.readyState===1){respond();emit({event:'held-response-released',method:frame.method});}},kind.startsWith('writer-')?600:6000);timers.add(timer);}else{respond();emit({event:'response',method:frame.method});}
 });
});
process.on('SIGTERM',()=>{for(const timer of timers)clearTimeout(timer);for(const socket of server.clients)socket.terminate();server.close(()=>process.exitCode=0);});
