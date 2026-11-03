import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {withIsolatedGateway} from './isolated-gateway.mjs';

const [checkout,out,expected]=process.argv.slice(2);
assert.ok(['base','head'].includes(expected));
await withIsolatedGateway(checkout,out,async({out,config})=>{
 config.plugins={slots:{memory:'none'}};
 const repo=path.join(out,'registered-repo');fs.mkdirSync(repo);
 execFileSync('git',['init','-q',repo]);
 fs.writeFileSync(path.join(repo,'README.md'),'Synthetic recent-folder proof.\n');
 execFileSync('git',['-C',repo,'add','README.md']);
 execFileSync('git',['-C',repo,'-c','user.name=Proof Fixture','-c','user.email=proof@example.test','commit','-qm','fixture']);
},async({out,checkout,config,record,rpc,save})=>{
 const nodeRoot=path.join(out,'node-host');fs.mkdirSync(nodeRoot);
 const nodeConfig=path.join(nodeRoot,'config.json');
 fs.writeFileSync(nodeConfig,JSON.stringify({browser:{enabled:false},nodeHost:{browserProxy:{enabled:false}},plugins:{slots:{memory:'none'}}}));
 const nodeCommand=[process.execPath,path.join(checkout,'openclaw.mjs'),'node','run','--host','127.0.0.1','--port',String(config.gateway.port),'--node-id','proof-recents-node','--display-name','Recent-folder proof node','--auth-from-env','--commands','system.which'];
 const logs=['node.stdout.log','node.stderr.log'].map(file=>fs.openSync(path.join(out,file),'w'));
 const child=spawn(nodeCommand[0],nodeCommand.slice(1),{cwd:checkout,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:nodeRoot,USERPROFILE:nodeRoot,OPENCLAW_STATE_DIR:path.join(nodeRoot,'state'),OPENCLAW_CONFIG_PATH:nodeConfig,OPENCLAW_GATEWAY_TOKEN:config.gateway.auth.token,OPENCLAW_NO_RESPAWN:'1',NODE_DISABLE_COMPILE_CACHE:'1',NO_COLOR:'1'},stdio:['ignore',...logs]});
 let exited;const closed=new Promise(resolve=>child.on('close',(code,signal)=>{exited={code,signal};resolve();}));
 try{
  record.nodeCommand=nodeCommand;record.proof={entry:'Normally built Gateway and normally built node host -> public sessions.create -> projects.list',modelsCalled:false,nodeCommandsInvoked:false,externalChannels:false,directStoreWrites:false};save();
  const deadline=performance.now()+100000;let liveNode;
  while(!liveNode){
   assert.equal(exited,undefined,`Node host exited: ${JSON.stringify(exited)}`);
   const devices=await rpc('device.pair.list',{});
   for(const item of devices.pending??[])await rpc('device.pair.approve',{requestId:item.requestId});
   const pairing=await rpc('node.pair.list',{});
   for(const item of pairing.pending??[])await rpc('node.pair.approve',{requestId:item.requestId});
   const inventory=await rpc('node.list',{});
   liveNode=inventory.nodes.find(n=>n.displayName==='Recent-folder proof node'&&n.connected&&n.paired);
   if(!liveNode){assert.ok(performance.now()<deadline,'Real node host did not connect/pair');await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  record.node={nodeId:liveNode.nodeId,connected:liveNode.connected,paired:liveNode.paired,commands:liveNode.commands};save();
  const repo=path.join(out,'registered-repo');
  const project=await rpc('projects.register',{path:repo,name:'Local registered proof'});
  const scenarios=[{name:'registered',folder:repo,projectId:project.id},{name:'workspace',folder:config.agents.defaults.workspace}];
  record.cases=[];
  for(const scenario of scenarios){
   const created=await rpc('sessions.create',{key:`agent:main:recents-node-${scenario.name}`,agentId:'main',cwd:scenario.folder,execNode:liveNode.nodeId});
   const listed=await rpc('projects.list',{});
   const matching=scenario.projectId?listed.recents.find(x=>x.projectId===scenario.projectId||x.folder===scenario.folder):listed.recents.find(x=>x.folder===scenario.folder||x.kind==='project'&&listed.projects.some(p=>p.id===x.projectId&&p.repoRoot===scenario.folder));
   assert.ok(matching,`Missing recent: ${scenario.name}`);
   if(expected==='base'){assert.equal(matching.kind,'project');assert.equal(matching.execNode,undefined);}
   else {assert.equal(matching.kind,'folder');assert.equal(matching.folder,scenario.folder);assert.equal(matching.execNode,liveNode.nodeId);}
   record.cases.push({name:scenario.name,created,recent:matching,fullRecents:listed.recents});save();
  }
  const local=await rpc('sessions.create',{key:'agent:main:recents-local-control',agentId:'main',cwd:repo});
  const listed=await rpc('projects.list',{});
  assert.ok(listed.recents.some(x=>x.kind==='project'&&x.projectId===project.id),'Local path must still resolve to its registered project');
  if(expected==='head')assert.ok(listed.recents.some(x=>x.kind==='folder'&&x.folder===repo&&x.execNode===liveNode.nodeId),'Node and local paths must not deduplicate');
  record.cases.push({name:'local binding and independent node dedup control',created:local,recents:listed.recents});
  record.observation=expected==='base'?'RED: paired node folders at local registry/workspace paths become local projects and lose their runner':'GREEN: paired node folders retain runner identity; local project lookup remains unchanged';save();
 }finally{
  if(!exited)child.kill('SIGTERM');await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,10000))]);
  if(!exited){child.kill('SIGKILL');await closed;}
  record.nodeCleanup={exit:exited,serviceInstalled:false,nodeCommandSideEffects:false};save();
  logs.forEach(fd=>fs.closeSync(fd));
 }
});
