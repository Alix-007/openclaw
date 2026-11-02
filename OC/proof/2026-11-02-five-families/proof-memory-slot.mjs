import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkout,out,expected]=process.argv.slice(2);assert.ok(['base','head'].includes(expected));
await withIsolatedGateway(checkout,out,async({out,config})=>{
 const dir=path.join(out,'state','extensions','proof-memory');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'proof-memory',version:'1.0.0',type:'module',openclaw:{extensions:['./index.js']}}));
 fs.writeFileSync(path.join(dir,'openclaw.plugin.json'),JSON.stringify({id:'proof-memory',name:'Synthetic memory proof',kind:'memory',contracts:{tools:['memory_search','memory_get']},configSchema:{type:'object',additionalProperties:true}}));
 fs.writeFileSync(path.join(dir,'index.js'),`export default {id:'proof-memory',name:'Synthetic memory proof',kind:'memory',register(api){
  api.registerMemoryCapability({recallToolNames:['memory_search','memory_get']});
  for(const name of ['memory_search','memory_get'])api.registerTool({name,label:name,description:'Synthetic selected memory fixture',parameters:{type:'object',properties:{query:{type:'string'},path:{type:'string'}}},async execute(){return {content:[{type:'text',text:'SELECTED_MEMORY_SENTINEL_'+name}],details:{owner:'proof-memory'}};}},{names:[name],workspaceAccess:'execute'});
 }};`);
 fs.writeFileSync(path.join(out,'workspace','MEMORY.md'),'# Memory\n\nCORE_MEMORY_FILE_CONTROL\n');
 config.plugins={allow:['memory-core','proof-memory'],slots:{memory:'proof-memory'},entries:{'memory-core':{enabled:true},'proof-memory':{enabled:true,config:{dreaming:{enabled:true,frequency:'0 0 1 1 *'}}}}};
 config.memory={search:{provider:'none',fallback:'none'}};
},async({record,rpc,save})=>{
 await rpc('sessions.create',{key:'agent:main:memory-slot-proof',agentId:'main'});
 const inventory=await rpc('plugins.list',{});
 record.pluginInventory=inventory.plugins.filter(x=>['memory-core','proof-memory'].includes(x.id));save();
 assert.ok(record.pluginInventory.some(x=>x.id==='proof-memory'),'Fixture must be discovered normally');
 record.cases=[];
 for(const [name,args] of [['memory_get',{path:'MEMORY.md'}],['memory_search',{query:'CORE_MEMORY_FILE_CONTROL'}]]){
  const result=await rpc('tools.invoke',{name,args,sessionKey:'agent:main:memory-slot-proof',agentId:'main',conversationReadOrigin:'direct-operator'});
  const selected=JSON.stringify(result).includes('SELECTED_MEMORY_SENTINEL_'+name);
  assert.equal(selected,expected==='head',`${name}: ${JSON.stringify(result)}`);
  record.cases.push({name,selectedSentinel:selected,result});save();
 }
 const intent=await rpc('tools.invoke',{name:'intent',args:{action:'list'},sessionKey:'agent:main:memory-slot-proof',agentId:'main',conversationReadOrigin:'direct-operator'});
 assert.equal(intent.ok,true,'Unselected memory-core must retain its standing-intent sidecar');
 assert.deepEqual(intent.output.details.intents,[],'Isolated intent list must remain empty');
 record.control={name:'unselected memory-core standing-intent sidecar',result:intent};save();
 record.observation=expected==='base'?'RED: unselected bundled memory-core shadows standard recall tools from selected memory plugin':'GREEN: both standard recall invocations return the selected memory plugin sentinel';
});
