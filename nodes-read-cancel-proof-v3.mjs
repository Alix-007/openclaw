import {createRequire} from 'node:module';
const [checkout,heldMethod,interrupt,commandKind]=process.argv.slice(2);
const require=createRequire(checkout+'/package.json');
const {WebSocketServer}=require('ws');
const emitGlobal=value=>process.stdout.write(JSON.stringify({...value,at:performance.now()})+'\n');
const server=new WebSocketServer({host:'127.0.0.1',port:0});
const timers=new Set();
const node={nodeId:'synthetic-node-1',displayName:'Synthetic proof node',platform:'linux',paired:true,connected:true,caps:[],commands:[]};
const pending={requestId:'synthetic-request-1',nodeId:'synthetic-pending-node-1',displayName:'Synthetic pending node',platform:'linux',ts:Date.now()};
server.on('listening',()=>emitGlobal({event:'listening',url:'ws://127.0.0.1:'+server.address().port}));
let nextConnectionId=0;
server.on('connection',socket=>{
 const connectionId=++nextConnectionId;
 const emit=value=>emitGlobal({...value,connectionId});
 emit({event:'peer-connected'});
 socket.on('close',()=>emit({event:'peer-closed'}));
 socket.on('error',error=>emit({event:'peer-error',message:error.code??error.name}));
 const respond=(id,payload)=>socket.send(JSON.stringify({type:'res',id,ok:true,payload}));
 const hello={type:'hello-ok',protocol:4,server:{version:'synthetic-nodes-read-proof',connId:'proof-nodes-read'},features:{methods:['node.list','node.describe','node.pair.list','node.pair.remove'],events:['connect.challenge']},snapshot:{},auth:{role:'operator',scopes:['operator.read','operator.pairing']},policy:{maxPayload:1000000,maxBufferedBytes:1000000,tickIntervalMs:60000}};
 socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'synthetic-nodes-read-proof',ts:Date.now()}}));
 socket.on('message',raw=>{
  const frame=JSON.parse(raw.toString());
  emit({event:'request',method:frame.method,id:frame.id,params:frame.params});
  if(frame.method==='node.list'&&commandKind==='nodes-describe-legacy'){
   socket.send(JSON.stringify({type:'res',id:frame.id,ok:false,error:{code:'INVALID_REQUEST',message:'unknown method: node.list'}}));emit({event:'legacy-unknown-method',method:frame.method});return;
  }
  const payload=frame.method==='connect'?hello:frame.method==='node.list'?{ts:Date.now(),nodes:[node]}:frame.method==='node.describe'?{ts:Date.now(),...node}:frame.method==='node.pair.remove'?{nodeId:node.nodeId}:{pending:[pending],paired:[node]};
  if(interrupt==='true'&&((heldMethod==='connect'&&frame.method==='connect')||frame.method===heldMethod)){
   emit({event:'read-held',method:frame.method});
   const timer=setTimeout(()=>{timers.delete(timer);if(socket.readyState===1){respond(frame.id,payload);emit({event:'held-response-released',method:frame.method});}},commandKind==='nodes-remove'?600:6000);timers.add(timer);
  }else{respond(frame.id,payload);emit({event:'response',method:frame.method});}
 });
});
process.on('SIGTERM',()=>{for(const timer of timers)clearTimeout(timer);for(const socket of server.clients)socket.terminate();server.close(()=>process.exitCode=0);});
