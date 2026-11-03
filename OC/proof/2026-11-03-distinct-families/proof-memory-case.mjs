import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkout,out,expected]=process.argv.slice(2);assert.ok(['base','head'].includes(expected));
fs.mkdirSync(out,{recursive:false});const scenarios=[{name:'mixed',id:'Proof-Memory',dreaming:true},{name:'lowercase',id:'proof-memory',dreaming:true},{name:'no-dreaming',id:'Proof-Memory',dreaming:false}];const summary=[];
for(const s of scenarios){
 const receipt=await withIsolatedGateway(checkout,path.join(out,s.name),async({out,config})=>{
  const dir=path.join(out,'state','extensions','proof-memory');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'proof-memory',version:'1.0.0',type:'module',openclaw:{extensions:['./index.js']}}));
  fs.writeFileSync(path.join(dir,'openclaw.plugin.json'),JSON.stringify({id:s.id,name:'Synthetic memory case fixture',kind:'memory',contracts:{tools:['memory_get']},configSchema:{type:'object',additionalProperties:true}}));
  fs.writeFileSync(path.join(dir,'index.js'),`export default {id:${JSON.stringify(s.id)},name:'Synthetic memory case fixture',kind:'memory',register(api){api.registerMemoryCapability({recallToolNames:['memory_get']});api.registerTool({name:'memory_get',label:'memory_get',description:'Synthetic selected memory fixture',parameters:{type:'object',properties:{path:{type:'string'}}},async execute(){return {content:[{type:'text',text:'SELECTED_MEMORY_SENTINEL'}],details:{owner:${JSON.stringify(s.id)}}};}},{names:['memory_get'],workspaceAccess:'execute'});}};`);
  config.plugins={allow:['memory-core',s.id],slots:{memory:s.id},entries:{'memory-core':{enabled:true},[s.id]:{enabled:true,config:{dreaming:{enabled:s.dreaming,frequency:'0 0 1 1 *'}}}}};config.memory={search:{provider:'none',fallback:'none'}};
 },async({record,rpc,save})=>{
  record.scenario=s;record.proof={entry:'Normally built Gateway -> public plugins.list and tools.invoke',modelsCalled:false,externalServices:false,privateHelpersInvoked:false};save();
  await rpc('sessions.create',{key:'agent:main:memory-case-proof',agentId:'main'});
  const plugins=await rpc('plugins.list',{});record.inventory=plugins.plugins.filter(x=>['memory-core',s.id].includes(x.id));save();
  const recall=await rpc('tools.invoke',{name:'memory_get',args:{path:'MEMORY.md'},sessionKey:'agent:main:memory-case-proof',agentId:'main',conversationReadOrigin:'direct-operator'});assert.ok(JSON.stringify(recall).includes('SELECTED_MEMORY_SENTINEL'),'Selected memory plugin recall must run in all scenarios');
  const intent=await rpc('tools.invoke',{name:'intent',args:{action:'list'},sessionKey:'agent:main:memory-case-proof',agentId:'main',conversationReadOrigin:'direct-operator'});
  const available=intent.ok===true;const shouldLoad=s.dreaming&&(s.name==='lowercase'||expected==='head');assert.equal(available,shouldLoad,JSON.stringify(intent));if(available)assert.deepEqual(intent.output.details.intents,[]);
  record.cases=[{name:'selected recall positive control',result:recall},{name:'bundled dreaming intent sidecar',available,result:intent}];record.observation=s.name==='mixed'?(expected==='base'?'RED: selected mixed-case memory recall works, but its requested dreaming sidecar is absent':'GREEN: selected mixed-case memory recall and requested dreaming sidecar both work'):s.name==='lowercase'?'CONTROL: ordinary lowercase memory selection retains dreaming sidecar':'CONTROL: disabled dreaming does not load its sidecar';save();
 });summary.push({scenario:s.name,result:receipt.result,sha:receipt.sha,observation:receipt.observation,cases:receipt.cases,cleanup:receipt.cleanup});
}
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({at:new Date().toISOString(),expected,scenarios:summary},null,2));
