import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepare } from './native-cli.mjs';

const [checkoutArg,outArg,expected]=process.argv.slice(2);
assert.ok(['base','head'].includes(expected));
const p=prepare(checkoutArg,outArg);
p.receipt.entry='Real standalone createAgentSession prompt + DefaultResourceLoader resources_discover + native OpenAI-compatible loopback HTTP transport';
p.receipt.scope='Explicit session skill-path loading only; ordinary CLI/Gateway discovery and external provider compatibility are outside this proof.';
p.receipt.harnessSha256=createHash('sha256').update(fs.readFileSync(new URL('proof-ignore-session.child.mts',import.meta.url))).digest('hex');
p.save();
const childFile=path.join(path.dirname(new URL(import.meta.url).pathname),'proof-ignore-session.child.mts');
const command=[process.execPath,'--import',path.join(p.checkout,'scripts/tsx.mjs'),childFile,p.checkout,p.out,expected];
const started=performance.now();
const child=spawn(command[0],command.slice(1),{cwd:p.checkout,env:p.env,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',watchdog=false;
child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
const watchdogTimer=setTimeout(()=>{watchdog=true;child.kill('SIGTERM');},90000);
const forceTimer=setTimeout(()=>child.kill('SIGKILL'),100000);
const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
clearTimeout(watchdogTimer);clearTimeout(forceTimer);
fs.writeFileSync(path.join(p.out,'session.stdout.log'),stdout);fs.writeFileSync(path.join(p.out,'session.stderr.log'),stderr);
p.receipt.command=command;p.receipt.exit=exit;p.receipt.watchdog=watchdog;p.receipt.seconds=Math.round((performance.now()-started)/10)/100;
try{
 assert.equal(watchdog,false,'Native session proof hit the harness watchdog');
 assert.equal(exit.code,0,'Native session collector failed: read session.stderr.log');
 const native=JSON.parse(fs.readFileSync(path.join(p.out,'native-result.json'),'utf8'));
 assert.equal(native.result,'PASS');assert.equal(native.scenarios.length,7);
 p.receipt.result='PASS';p.receipt.productAcceptance=native.productAcceptance;
 p.receipt.observation=native.observation;p.receipt.native=native;
 p.receipt.cleanup={productionConfigTouched:false,externalModelCalls:false,syntheticLoopbackProviderOnly:true,childExited:true,isolatedFilesOnly:true,serverClosed:native.cleanup.serverClosed};
 p.save();console.log(JSON.stringify({result:p.receipt.result,sha:p.receipt.sha,seconds:p.receipt.seconds,productAcceptance:p.receipt.productAcceptance,observation:p.receipt.observation,scenarios:native.scenarios.map(({name,expanded,requestCount,finalReply})=>({name,expanded,requestCount,finalReply}))}));
}catch(error){p.receipt.result='SETUP_OR_PRODUCT_FAILURE';p.receipt.error=String(error);p.save();throw error;}
