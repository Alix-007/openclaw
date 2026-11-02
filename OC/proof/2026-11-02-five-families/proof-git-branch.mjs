import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {withIsolatedGateway} from './isolated-gateway.mjs';

const [checkoutArg,outArg,expected='base']=process.argv.slice(2);
assert.ok(checkoutArg&&outArg,'usage: node proof-git-branch.mjs CHECKOUT OUT [base|head]');
assert.ok(['base','head'].includes(expected));
const checkout=path.resolve(checkoutArg),out=path.resolve(outArg);
const commands=[];
const sessionKey='agent:main:git-branch-proof';
let repo;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function git(...args){
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:path.join(out,'home'),USERPROFILE:path.join(out,'home'),XDG_CONFIG_HOME:path.join(out,'home','.config'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'',SSH_ASKPASS:'',NO_COLOR:'1'};
 const stdout=execFileSync('git',args,{cwd:repo??out,env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
 commands.push({argv:['git',...args],stdout});
 return stdout.trim();
}

async function openObserver({record,config,save}){
 const {WebSocket}=createRequire(path.join(checkout,'package.json'))('ws');
 const socket=new WebSocket(record.domain),pending=new Map();
 const events=[];
 let resolveReady,rejectReady;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const handshakeDeadline=setTimeout(()=>rejectReady(new Error('Observer handshake deadline')),30000);
 const request=async(method,params)=>{
  const id=randomUUID();
  const response=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Observer RPC deadline: ${method}`));},30000);
   pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
   socket.send(JSON.stringify({type:'req',id,method,params}));
  });
  if(method!=='connect'){record.subscriptionCalls.push({method,params,response});save();}
  assert.equal(response.ok,true,`${method}: ${JSON.stringify(response.error)}`);
  return response.payload;
 };
 socket.on('message',raw=>{
  const frame=JSON.parse(raw.toString());
  if(frame.type==='res'){
   const handler=pending.get(frame.id);pending.delete(frame.id);handler?.resolve(frame);
  }
  if(frame.type==='event'&&frame.event==='connect.challenge'){
   request('connect',{minProtocol:4,maxProtocol:4,client:{id:'cli',version:'2026.10.9',platform:'linux',mode:'cli'},role:'operator',scopes:['operator.admin','operator.read','operator.write'],auth:{token:config.gateway.auth.token}})
    .then(payload=>{record.observerConnect={protocol:payload.protocol,role:payload.auth?.role,scopes:payload.auth?.scopes};clearTimeout(handshakeDeadline);save();resolveReady();},rejectReady);
  }
  if(frame.type==='event'&&frame.event==='controlUi.sessionPullRequests.changed'){
   const event={at:new Date().toISOString(),event:frame.event,payload:frame.payload};
   events.push(event);record.events.push(event);save();
  }
 });
 socket.on('error',rejectReady);
 socket.on('close',()=>{
  for(const entry of pending.values())entry.reject(new Error('Observer connection closed'));
  pending.clear();
 });
 try{await ready;}catch(error){clearTimeout(handshakeDeadline);socket.terminate();throw error;}
 return {
  async snapshot(name){
   const start=events.length;
   await request('controlUi.sessionPullRequests.subscribe',{sessionKeys:[sessionKey],refreshSessionKeys:[sessionKey]});
   const deadline=performance.now()+45000;
   while(performance.now()<deadline){
    const event=events.slice(start).find(entry=>entry.payload?.sessions?.[sessionKey]?.branch);
    if(event)return {name,snapshot:event.payload.sessions[sessionKey],publicEvent:event};
    await delay(100);
   }
   const observed=events.slice(start).map(entry=>entry.payload?.sessions?.[sessionKey]);
   record.blocked={phase:name,reason:'No branch readback from the public subscription; anonymous GitHub network or product preparation did not provide usable branch facts',observed};save();
   throw new Error(`BLOCKED: ${name}: no public branch readback`);
  },
  close(){clearTimeout(handshakeDeadline);socket.terminate();},
 };
}

try{
 await withIsolatedGateway(checkout,out,async()=>{
  git('clone','--quiet','--depth=2','--single-branch','--no-tags','https://github.com/octocat/Hello-World.git',path.join(out,'workspace','repository'));
  repo=path.join(out,'workspace','repository');
  git('checkout','-b','release');
  fs.writeFileSync(path.join(repo,'openclaw-branch-proof.txt'),'Normal local branch change for public subscription proof.\n');
  git('add','openclaw-branch-proof.txt');
  git('-c','user.name=OpenClaw proof fixture','-c','user.email=proof@openclaw.invalid','commit','--no-gpg-sign','-m','Local branch proof change');
  assert.equal(git('symbolic-ref','HEAD'),'refs/heads/release');
  assert.equal(git('tag','--list','release'),'');
 },async({config,record,rpc,save})=>{
  record.proof={expected,source:'anonymous public clone plus ordinary local branch, text commit, and tag',remoteWrites:false,githubCredential:'none in isolated runtime',privateHelpersInvoked:false,publicEntry:['sessions.create','controlUi.sessionPullRequests.subscribe','controlUi.sessionPullRequests.changed']};
  record.gitCommands=commands;record.events=[];record.subscriptionCalls=[];record.cases=[];save();
  const created=await rpc('sessions.create',{key:sessionKey,agentId:'main',cwd:repo,worktree:false});
  assert.equal(created.runStarted,false);
  assert.equal(created.entry.spawnedCwd,repo);
  assert.equal(created.entry.worktree,undefined);
  const observer=await openObserver({record,config,save});
  try{
   const control=await observer.snapshot('control: no colliding tag');
   assert.equal(control.snapshot.branch.branch,'release');
   assert.ok(control.snapshot.branch.changedFiles>0,'Real local branch stats must reach the product event');
   control.git={fullHead:git('symbolic-ref','HEAD'),abbreviatedHead:git('rev-parse','--abbrev-ref','HEAD')};
   record.cases.push(control);save();

   git('tag','release');
   const collision=await observer.snapshot('same-name local branch and tag');
   collision.git={fullHead:git('symbolic-ref','HEAD'),abbreviatedHead:git('rev-parse','--abbrev-ref','HEAD')};
   assert.equal(collision.git.fullHead,'refs/heads/release');
   assert.equal(collision.git.abbreviatedHead,'heads/release');
   assert.equal(collision.snapshot.branch.branch,expected==='base'?'heads/release':'release');
   assert.equal(collision.snapshot.branch.changedFiles,control.snapshot.branch.changedFiles);
   record.cases.push(collision);save();

   git('tag','-d','release');
   const restored=await observer.snapshot('control: colliding tag removed');
   assert.equal(restored.snapshot.branch.branch,'release');
   assert.equal(restored.snapshot.branch.changedFiles,control.snapshot.branch.changedFiles);
   restored.git={fullHead:git('symbolic-ref','HEAD'),abbreviatedHead:git('rev-parse','--abbrev-ref','HEAD')};
   record.cases.push(restored);
   record.observation=expected==='base'?'RED: public subscription changes the real branch identity from release to heads/release after a local-only same-name tag; removing the tag restores release':'GREEN: public subscription preserves release through a same-name local tag and removal';
   save();
  }finally{observer.close();}
 });
 fs.writeFileSync(path.join(out,'proof-status.json'),JSON.stringify({status:expected==='base'?'RED':'GREEN',receipt:'receipt.json',remoteWrites:false},null,2));
}catch(error){
 if(fs.existsSync(out))fs.writeFileSync(path.join(out,'proof-status.json'),JSON.stringify({status:'BLOCKED',error:String(error),remoteWrites:false,gitCommands:commands},null,2));
 console.error(String(error));process.exitCode=1;
}
