import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkout,out,scenario,expected]=process.argv.slice(2);assert.ok(['recents','identity'].includes(scenario));assert.ok(['base','head'].includes(expected));
let repo;const commands=[];
const git=(...args)=>{const stdout=execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:'pipe',timeout:30000,env:{PATH:'/usr/bin:/bin',HOME:path.join(out,'home'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});commands.push({args,stdout});return stdout.trim();};
await withIsolatedGateway(checkout,out,async()=>{
 repo=path.join(out,'workspace','repository');fs.mkdirSync(path.join(repo,'packages','app'),{recursive:true});
 git('init','-b','main');fs.writeFileSync(path.join(repo,'packages','app','nested.txt'),'Selected nested project\n');fs.writeFileSync(path.join(repo,'root.txt'),'Repository root\n');git('add','.');git('-c','user.name=Proof fixture','-c','user.email=proof@example.invalid','-c','commit.gpgsign=false','commit','-m','Fixture');
},async({record,rpc,save})=>{
 record.proof={entry:['sessions.create','projects.list'],externalServices:false,modelsCalled:false,privateHelpersInvoked:false};record.gitCommands=commands;record.cases=[];
 const source=scenario==='recents'?path.join(repo,'packages','app'):repo;
 const key=`agent:main:project-${scenario}-proof`;
 const created=await rpc('sessions.create',{key,agentId:'main',cwd:source,worktree:true,worktreeBaseRef:'HEAD',worktreeName:`${scenario}-proof`});
 record.cases.push({name:'public managed session creation',response:created});save();
 assert.equal(created.runStarted,false);assert.ok(created.entry.worktree,'Actual managed worktree must exist before the scenario');
 if(scenario==='recents'){
  assert.equal(created.entry.worktree.canonicalWorkspaceDir,source);
  assert.ok(created.entry.spawnedCwd.endsWith(path.join('packages','app')));
  const listed=await rpc('projects.list',{});record.cases.push({name:'recent source selection',response:listed});save();
  const recent=listed.recents.find(x=>x.kind==='folder');assert.ok(recent);
  assert.equal(recent.folder,expected==='base'?repo:source);
  const replay=await rpc('sessions.create',{key:'agent:main:recent-replay-proof',agentId:'main',cwd:recent.folder,worktree:false});record.cases.push({name:'replay returned recent folder',response:replay});save();
  assert.equal(replay.entry.spawnedCwd,expected==='base'?repo:source);
  record.observation=expected==='base'?'RED: selecting a nested folder for a managed session records it correctly, but recents replays the repository root':'GREEN: recent source folder replays the original nested selection';
 }else{
  const before=await rpc('projects.list',{includeObserved:true});record.cases.push({name:'legal control: original repository origin',response:before});save();assert.equal(before.observedProjects.length,1);
  git('remote','add','origin','https://github.com/openclaw/proof-fixture.git');
  let after;for(let i=0;i<30;i++){after=await rpc('projects.list',{includeObserved:true});if(after.observedProjects.every(x=>x.originUrl==='https://github.com/openclaw/proof-fixture.git'))break;await new Promise(resolve=>setTimeout(resolve,500));}
  record.cases.push({name:'origin changed through ordinary git configuration',response:after});save();
  assert.equal(after.observedProjects.length,expected==='base'?2:1);
  assert.ok(after.observedProjects.every(x=>x.originUrl==='https://github.com/openclaw/proof-fixture.git'));
  record.observation=expected==='base'?'RED: one managed checkout is duplicated into two observed projects after its origin URL changes':'GREEN: a managed checkout and its session use the same live repository identity after an origin change';
 }
});
