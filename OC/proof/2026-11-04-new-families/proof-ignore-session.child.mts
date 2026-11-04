import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [checkout,out,expected]=process.argv.slice(2);
assert.ok(['base','head'].includes(expected));
const readModule=(name:string)=>import(pathToFileURL(path.join(checkout,name)).href);
const [{DefaultResourceLoader},{createAgentSession},{AuthStorage},{ModelRegistry},{SettingsManager},{SessionManager}]=await Promise.all([
 readModule('src/agents/sessions/resource-loader.ts'),readModule('src/agents/sessions/sdk.ts'),readModule('src/agents/sessions/auth-storage.ts'),
 readModule('src/agents/sessions/model-registry.ts'),readModule('src/agents/sessions/settings-manager.ts'),readModule('src/agents/sessions/session-manager.ts'),
]);
const root=path.join(out,'workspace','skills');fs.mkdirSync(root,{recursive:true});
const definitions=[
 {directory:' #space',name:'proof-space',ignored:true,marker:'SYNTHETIC_PRIVATE_SPACE_PAYLOAD'},
 {directory:'\t#tab',name:'proof-tab',ignored:true,marker:'SYNTHETIC_PRIVATE_TAB_PAYLOAD'},
 {directory:'group/ #nested',name:'proof-nested',ignored:true,marker:'SYNTHETIC_PRIVATE_NESTED_PAYLOAD'},
 {directory:'normal-visible',name:'proof-visible',ignored:false,marker:'SYNTHETIC_PUBLIC_PAYLOAD'},
 {directory:'#comment-control',name:'proof-comment-control',ignored:false,marker:'SYNTHETIC_COMMENT_CONTROL_PAYLOAD'},
 {directory:'#escaped',name:'proof-escaped',ignored:true,marker:'SYNTHETIC_ESCAPED_CONTROL_PAYLOAD'},
 {directory:'bom/visible',name:'proof-bom-comment',ignored:false,marker:'SYNTHETIC_BOM_COMMENT_CONTROL_PAYLOAD'},
];
for(const d of definitions){
 const dir=path.join(root,d.directory);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'SKILL.md'),`---\nname: ${d.name}\ndescription: Synthetic explicit-session ignore proof fixture.\n---\n${d.marker}\nReply only with Proof complete. No tools or side effects.\n`);
}
const rootGitignore=' #space/\n#comment-control/\n\\#escaped/\n';
fs.writeFileSync(path.join(root,'.gitignore'),rootGitignore);
fs.writeFileSync(path.join(root,'.ignore'),'\t#tab/\n');
fs.writeFileSync(path.join(root,'group','.fdignore'),' #nested/\n');
// A valid long comment is below the ignore-file cap but above the compiled-pattern cap.
// It must remain a comment before nested prefixing, rather than exclude its subtree.
fs.writeFileSync(path.join(root,'bom','.gitignore'),'\uFEFF#'+ 'b'.repeat(17000)+'\n');
const fixtureFiles=[...definitions.map(d=>path.join(root,d.directory,'SKILL.md')),path.join(root,'.gitignore'),path.join(root,'.ignore'),path.join(root,'group','.fdignore'),path.join(root,'bom','.gitignore')];
const hashes=()=>Object.fromEntries(fixtureFiles.map(f=>[path.relative(root,f),createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const before=hashes();

// Reuse read-only repository metadata with a separate oracle work tree. --no-index
// prevents the product checkout's index from affecting the fixture. No Git refs,
// index, configuration or object database are mutated.
const gitDir=execFileSync('git',['rev-parse','--absolute-git-dir'],{cwd:checkout,encoding:'utf8'}).trim();
const oracle=path.join(out,'git-oracle');fs.mkdirSync(oracle);
for(const d of definitions)fs.mkdirSync(path.join(oracle,d.directory),{recursive:true});
fs.mkdirSync(path.join(oracle,'group'),{recursive:true});
fs.writeFileSync(path.join(oracle,'.gitignore'),rootGitignore+'\t#tab/\n');
fs.writeFileSync(path.join(oracle,'group','.gitignore'),' #nested/\n');
fs.writeFileSync(path.join(oracle,'bom','.gitignore'),'\uFEFF#'+ 'b'.repeat(17000)+'\n');
const parity=definitions.map(d=>{
 const command=['--git-dir',gitDir,'--work-tree',oracle,'-c','core.excludesFile=/dev/null','check-ignore','--no-index','--',d.directory+'/SKILL.md'];
 const r=spawnSync('git',command,{cwd:oracle,encoding:'utf8',env:process.env});assert.equal(r.status,d.ignored?0:1,r.stderr);
 return {directory:d.directory,name:d.name,gitIgnored:r.status===0};
});
fs.writeFileSync(path.join(out,'git-parity.json'),JSON.stringify(parity,null,2)+'\n');

const requests:Array<{url:string,body:any}>=[];
const server=http.createServer((req,res)=>{
 let raw='';req.setEncoding('utf8');req.on('data',chunk=>raw+=chunk);
 req.on('end',()=>{
  try{
   requests.push({url:req.url??'',body:JSON.parse(raw)});
   if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end('Unexpected native provider route');return;}
   const frame=(delta:any,finish_reason:string|null)=>({id:'proof-'+requests.length,object:'chat.completion.chunk',created:1,model:'ignore-proof-model',choices:[{index:0,delta,finish_reason}]});
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
   res.end('data: '+JSON.stringify(frame({role:'assistant',content:'Proof complete.'},null))+'\n\n'+'data: '+JSON.stringify(frame({},'stop'))+'\n\n'+'data: [DONE]\n\n');
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:String(error)}}));}
 });
});
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const address=server.address();assert.ok(address&&typeof address==='object');
const baseUrl=`http://127.0.0.1:${address.port}/v1`;
const scenarios:any[]=[];
const result:any={result:'RUNNING',entry:'Explicit standalone session /skill:name expansion through real resource discovery and native provider HTTP',sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim(),expected,parity,fixtureHashesBefore:before,scenarios,cleanup:{serverClosed:false},limitations:['Source SDK/session entry; ordinary skills CLI and embedded Gateway discovery use a different path.','Synthetic local OpenAI-compatible responder exercises native transport; no real external provider or channel is tested.','Session readback is the real in-memory SessionManager/AgentSession state, not a persisted transcript claim.']};
const save=()=>fs.writeFileSync(path.join(out,'native-result.json'),JSON.stringify(result,null,2)+'\n');save();
try{
 for(const d of definitions){
  const auth=AuthStorage.inMemory();auth.setRuntimeApiKey('ignore-proof-openai','synthetic-loopback-key');
  const registry=ModelRegistry.inMemory(auth);
  const model={id:'ignore-proof-model',name:'Synthetic loopback model',api:'openai-completions',provider:'ignore-proof-openai',baseUrl,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:64};
  registry.registerProvider(model.provider,{api:model.api,baseUrl,apiKey:'synthetic-loopback-key',models:[model]});
  let discoveryCalls=0;
  const resourceLoader=new DefaultResourceLoader({cwd:path.join(out,'workspace'),agentDir:path.join(out,'state','agent'),extensionFactories:[(api:any)=>api.on('resources_discover',()=>{discoveryCalls++;return {skillPaths:[root]};})]});
  await resourceLoader.reload();assert.deepEqual(resourceLoader.getExtensions().errors,[]);
  const sessionManager=SessionManager.inMemory(path.join(out,'workspace'));
  const settingsManager=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}});
  const {session}=await createAgentSession({systemPrompt:'Synthetic standalone-session proof. Follow the user request.',model,thinkingLevel:'off',tools:[],resourceLoader,sessionManager,settingsManager,modelRegistry:registry});
  try{
   await session.bindExtensions({});assert.equal(discoveryCalls,1);
   const start=requests.length;
   await session.prompt('/skill:'+d.name+' probe');
   const observed=requests.slice(start);assert.equal(observed.length,1,'Expected one real HTTP request per native prompt');
   const last=session.messages.findLast((m:any)=>m.role==='assistant');assert.ok(last);
   const finalReply=last.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('');
   assert.equal(finalReply,'Proof complete.');assert.equal(last.stopReason,'stop');
   const expanded=JSON.stringify(observed[0].body.messages).includes(d.marker);
   const shouldExpand=expected==='base'?d.name!=='proof-escaped':!d.ignored;
   const row={name:d.name,directory:d.directory,ignored:d.ignored,expanded,expectedExpansion:shouldExpand,requestCount:observed.length,discoveryCalls,finalReply,stopReason:last.stopReason,sessionId:session.sessionId};
   scenarios.push(row);fs.writeFileSync(path.join(out,d.name+'-requests.json'),JSON.stringify(observed,null,2)+'\n');
   fs.writeFileSync(path.join(out,d.name+'-session.json'),JSON.stringify({sessionId:session.sessionId,messages:session.messages,sessionBranch:sessionManager.getBranch()},null,2)+'\n');save();
   assert.equal(expanded,shouldExpand,'Native skill expansion differs from the declared before/after observation for '+d.name);
  }finally{session.dispose();}
 }
 result.fixtureHashesAfter=hashes();assert.deepEqual(result.fixtureHashesAfter,before,'Native execution changed fixture skill or ignore bytes');
 result.productAcceptance=scenarios.every(s=>s.expanded===!s.ignored);
 assert.equal(result.productAcceptance,expected==='head');
 result.result='PASS';
 result.observation=expected==='base'?'RED: leading-space/hash, tab/hash and nested hash-pattern skills expand into three real provider requests despite Git exclusions. Escaped-hash exclusion, visible/comment/BOM controls and seven final replies behave correctly.':'GREEN: all authored exclusions suppress skill expansion into the real provider requests; visible/comment/BOM controls still expand and all seven native sessions finish successfully.';
}catch(error){result.result='SETUP_OR_PRODUCT_FAILURE';result.error=String(error);throw error;}
finally{
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));result.cleanup.serverClosed=true;save();
}
console.log(JSON.stringify({result:result.result,observation:result.observation,scenarios:scenarios.length}));
