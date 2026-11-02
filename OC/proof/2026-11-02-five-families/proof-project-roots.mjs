import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkout,out,expected]=process.argv.slice(2);assert.ok(['base','head'].includes(expected));
await withIsolatedGateway(checkout,out,async({out,config})=>{
 for(const name of ['A','B']){
  const repo=path.join(out,'workspace',name);fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo,'README.md'),`Synthetic project ${name}\n`);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{stdio:'pipe'});
  git('init','-b','main');git('add','README.md');
  git('-c','user.name=OpenClaw proof fixture','-c','user.email=proof@openclaw.invalid','commit','-m','Initial fixture');
 }
},async({out,record,rpc,save})=>{
 const create=async(name,repo)=>{
  const result=await rpc('sessions.create',{key:`agent:main:project-proof-${name}`,agentId:'main',cwd:path.join(out,'workspace',repo)});
  assert.equal(result.runStarted,false);assert.equal(result.entry.spawnedCwd,path.join(out,'workspace',repo));assert.equal(result.entry.execCwd,undefined);
  return result;
 };
 const settled=async()=>{
  let prior='',same=0,latest;
  for(let i=0;i<30;i++){
   latest=await rpc('projects.list',{includeObserved:true});
   const key=JSON.stringify(latest.observedProjects);same=key===prior?same+1:0;prior=key;
   if(same>=5)return latest;
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('Discovery failed to settle');
 };
 await create('b','B');await create('a-0','A');
 const two=await settled();
 assert.equal(two.observedProjects.length,expected==='base'?0:2);
 assert.deepEqual(two.recents.filter(x=>x.kind==='folder').map(x=>x.displayName),['A','B']);
 record.cases=[{name:'two host folders',observedProjects:two.observedProjects,recents:two.recents}];save();
 for(let i=1;i<50;i++)await create(`a-${i}`,'A');
 const repeated=await settled();
 assert.equal(repeated.observedProjects.length,expected==='base'?0:2);
 if(expected==='head'){
  assert.deepEqual(repeated.observedProjects.map(x=>x.name),['A','B']);
  assert.ok(repeated.observedProjects.every(x=>x.checkouts.length===1));
 }
 const inventory=await rpc('sessions.list',{limit:100});
 const created=inventory.sessions.filter(x=>x.key.startsWith('agent:main:project-proof-'));
 assert.equal(created.length,51);
 record.cases.push({name:'50 repeated A host folders',observedProjects:repeated.observedProjects,sessionCount:created.length});
 const optOut=await rpc('projects.list',{});assert.equal(optOut.observedProjects,undefined);
 record.cases.push({name:'explicit discovery opt-out',observedProjectsPresent:false});
 record.observation=expected==='base'?'RED: public host sessions persist cwd and appear in recents but observed Git checkouts remain empty':'GREEN: real host Git checkouts A/B are discovered once, even after 50 sessions at A; opt-out unchanged';
});
