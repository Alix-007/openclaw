import {createRequire} from 'node:module';
const [checkout,kind,interrupt]=process.argv.slice(2);
const require=createRequire(checkout+'/package.json');
const {WebSocketServer}=require('ws');
const emit=value=>process.stdout.write(JSON.stringify({...value,at:performance.now()})+'\n');
const server=new WebSocketServer({host:'127.0.0.1',port:0});
const timers=new Set();
server.on('listening',()=>emit({event:'listening',url:'ws://127.0.0.1:'+server.address().port}));
server.on('connection',socket=>{
 emit({event:'peer-connected'});
 socket.on('close',()=>emit({event:'peer-closed'}));
 socket.on('error',error=>emit({event:'peer-error',message:error.code??error.name}));
 const respond=(id,payload)=>socket.send(JSON.stringify({type:'res',id,ok:true,payload}));
 const hello={type:'hello-ok',protocol:4,server:{version:'synthetic-status-proof',connId:'proof-read-only'},features:{methods:['health'],events:['connect.challenge']},snapshot:{},auth:{role:'operator',scopes:['operator.read']},policy:{maxPayload:1000000,maxBufferedBytes:1000000,tickIntervalMs:60000}};
 socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'synthetic-status-proof',ts:Date.now()}}));
 socket.on('message',raw=>{
  const frame=JSON.parse(raw.toString());
  emit({event:'request',method:frame.method,id:frame.id});
  const payload=frame.method==='connect'?hello:{ok:true,proofMarker:'synthetic-health-proof',ts:Date.now(),durationMs:1,channels:{},channelOrder:[],channelLabels:{},heartbeatSeconds:0,defaultAgentId:'main',agents:[],sessions:{path:'synthetic',count:0,recent:[]}};
  const hold=interrupt==='true'&&((kind==='connect'&&frame.method==='connect')||(kind==='rpc'&&frame.method==='health'));
  if(hold){
   emit({event:'read-held',method:frame.method});
   const timer=setTimeout(()=>{timers.delete(timer);if(socket.readyState===1){respond(frame.id,payload);emit({event:'held-response-released',method:frame.method});}},6000);timers.add(timer);
  }else{respond(frame.id,payload);emit({event:'response',method:frame.method});}
 });
});
process.on('SIGTERM',()=>{for(const timer of timers)clearTimeout(timer);for(const socket of server.clients)socket.terminate();server.close(()=>process.exitCode=0);});
