import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [checkout,configPath,lane]=process.argv.slice(2);
const source=(name:string)=>pathToFileURL(path.join(checkout!,'src',name)).href;
const config=JSON.parse(fs.readFileSync(configPath!,'utf8'));
if(lane==='tools'){
 const {readAgentToolUsageStatus,flushAgentToolUsage}=await import(source('config/sessions/tool-usage.ts'));
 const before=await readAgentToolUsageStatus({agentId:'main',config});
 const ok=await flushAgentToolUsage({agentId:'main',config,generation:before.generation,startedAt:Date.now(),rows:[{toolId:'openclaw:core:read',score:3,updatedAt:Date.now()}]});
 const after=await readAgentToolUsageStatus({agentId:'main',config});
 if(!ok||after.rows.length!==1||after.rows[0]?.toolId!=='openclaw:core:read')throw Error('canonical tool-usage fixture did not persist');
 console.log(JSON.stringify({lane,rows:after.rows,generation:after.generation}));
}else{
 const dir=path.join(config.agents.defaults.workspace,'hooks','proof-hook');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'HOOK.md'),'---\nname: proof-hook\ndescription: Synthetic proof hook\nmetadata: {"openclaw":{"events":["command:new"]}}\n---\n');
 fs.writeFileSync(path.join(dir,'handler.js'),'export default async function () {}\n');
 console.log(JSON.stringify({lane,hook:'proof-hook',artifact:'workspace/hooks/proof-hook/HOOK.md'}));
}
const {closeOpenClawAgentDatabasesAsync}=await import(source('state/openclaw-agent-db.ts'));
await closeOpenClawAgentDatabasesAsync();
