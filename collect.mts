// Fixture setup only: command behavior is exercised through normal openclaw.mjs.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
const checkout=path.resolve(process.argv[2]!);
const source=(name:string)=>pathToFileURL(path.join(checkout,'src',name)).href;
const {upsertSessionEntryCore}=await import(source('config/sessions/session-accessor.ts'));
const {appendSqliteTrajectoryRuntimeEvents}=await import(source('trajectory/runtime-store.test-support.ts'));
const protocol='sessions-tail-native-fixture-v1';
const reply=(data:Record<string,unknown>)=>process.stdout.write(JSON.stringify({protocol,...data})+'\n');
reply({event:'ready',pid:process.pid});
const lines=createInterface({input:process.stdin,crlfDelay:Infinity,terminal:false});
for await(const line of lines){
 const message=JSON.parse(line);
 try{
  if(message.op==='close'){reply({event:'closed',requestId:message.requestId});lines.close();break;}
  if(message.op!=='append')throw new Error('unknown fixture operation');
  const {storePath,sessionKey,sessionId,seq,marker}=message;
  if(seq===1)await upsertSessionEntryCore({sessionKey,storePath},{sessionId,updatedAt:Date.now(),status:'done'});
  const event={ts:new Date().toISOString(),traceSchema:'openclaw-trajectory',schemaVersion:1,traceId:sessionId,source:'runtime',seq,sessionId,sessionKey,type:'tool.result',data:{name:marker,success:true}};
  appendSqliteTrajectoryRuntimeEvents({agentId:'main',sessionId,storePath},[event]);
  reply({event:'appended',requestId:message.requestId,seq,marker,sessionId,committedAtWallMs:Date.now()});
 }catch(error){reply({event:'error',requestId:message.requestId,error:String(error)});}
}
