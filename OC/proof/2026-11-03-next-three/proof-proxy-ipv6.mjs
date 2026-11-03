import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkout,out,expected]=process.argv.slice(2);assert.ok(['base','head'].includes(expected));
await withIsolatedGateway(checkout,out,async({config})=>{config.plugins={slots:{memory:'none'}};},async({out,checkout,config,record,rpc,save})=>{
 const originHits=[];const origin=http.createServer((req,res)=>{originHits.push(req.url);res.end('local-proxy-proof-ok');});await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));const target=`http://127.0.0.1:${origin.address().port}/proxy-proof`;
 const fixture=path.join(out,'child.cjs');fs.writeFileSync(fixture,`const http=require('node:http');const endpoint=new URL(process.env.OPENCLAW_DEBUG_PROXY_URL);const proxy=new URL(process.env.HTTP_PROXY);const req=http.request(proxy,{path:process.argv[2],headers:{Connection:'close'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{console.log(JSON.stringify({body,proxyOrigin:proxy.origin,privateEndpointOrigin:endpoint.origin,privateEndpointHasCredential:!!endpoint.password,publicProxyHasCredential:!!proxy.password}));process.exitCode=res.statusCode===200&&body==='local-proxy-proof-ok'?0:2;});});req.on('error',e=>{console.error(e.code||e.name);process.exitCode=2;});req.end();`);
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:path.join(out,'home'),USERPROFILE:path.join(out,'home'),OPENCLAW_STATE_DIR:path.join(out,'state'),OPENCLAW_CONFIG_PATH:path.join(out,'config.json'),OPENCLAW_NO_RESPAWN:'1',NODE_DISABLE_COMPILE_CACHE:'1',NO_COLOR:'1',OPENCLAW_DEBUG:'1',TMPDIR:out};
 const run=async(args,label,onOutput)=>{
  const command=[process.execPath,path.join(checkout,'openclaw.mjs'),...args],child=spawn(command[0],command.slice(1),{cwd:checkout,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',watchdog=false,close;const closed=new Promise(resolve=>child.on('close',(code,signal)=>{close={code,signal};resolve();}));
  child.stdout.on('data',b=>{stdout+=b;onOutput?.(stdout,child);});child.stderr.on('data',b=>stderr+=b);
  const timer=setTimeout(()=>{watchdog=true;child.kill('SIGTERM');},20000);
  const force=setTimeout(()=>child.kill('SIGKILL'),35000);await closed;clearTimeout(timer);clearTimeout(force);
  fs.writeFileSync(path.join(out,label+'.stdout.log'),stdout);fs.writeFileSync(path.join(out,label+'.stderr.log'),stderr);
  const result={label,command,exit:close,watchdog,stdout,stderr};record.cases.push(result);save();return result;
 };
 record.cases=[];record.proof={entry:'Normally built openclaw proxy start/run with real isolated Gateway persistence, native loopback IPv6 listener, actual child and HTTP origin',modelsCalled:false,externalChannels:false,sourceImportsOrMocks:false};save();
 try{
  for(const host of ['127.0.0.1','::1']){
   const before=originHits.length;const result=await run(['proxy','run','--host',host,'--port','0','--',process.execPath,fixture,target],host==='::1'?'ipv6-run':'ipv4-run');
   if(host==='::1'&&expected==='base'){assert.match(result.stderr,/Invalid URL|ERR_INVALID_URL/);assert.equal(originHits.length,before);}
   else{assert.deepEqual(result.exit,{code:0,signal:null});const response=JSON.parse(result.stdout.trim());assert.equal(response.body,'local-proxy-proof-ok');assert.equal(response.proxyOrigin,response.privateEndpointOrigin);assert.equal(response.privateEndpointHasCredential,true);assert.equal(response.publicProxyHasCredential,false);assert.equal(originHits.length,before+1);if(host==='::1')assert.match(response.proxyOrigin,/^http:\/\/\[::1\]:\d+$/);}
  }
  for(const host of ['127.0.0.1','::1']){
   let probe,started=false;const before=originHits.length;
   const result=await run(['proxy','start','--host',host,'--port','0'],host==='::1'?'ipv6-start':'ipv4-start',(stdout,child)=>{
    const m=/Debug proxy: (http:\/\/\S+)/.exec(stdout);if(!m||started)return;started=true;
    probe=new Promise((resolve,reject)=>{const req=http.request(m[1],{path:target,headers:{Connection:'close'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{try{assert.equal(body,'local-proxy-proof-ok');assert.equal(res.statusCode,200);resolve({status:res.statusCode,body,proxyUrl:m[1]});}catch(e){reject(e);}finally{child.kill('SIGTERM');}});});req.on('error',e=>{child.kill('SIGTERM');reject(e);});req.end();});probe.catch(()=>{});
   });
   if(host==='::1'&&expected==='base'){assert.equal(started,false);assert.match(result.stderr,/Invalid URL|ERR_INVALID_URL/);assert.equal(originHits.length,before);}
   else{assert.equal(started,true);const response=await probe;assert.equal(originHits.length,before+1);result.readback=response;assert.equal(result.watchdog,false);assert.ok([0,143].includes(result.exit.code)||result.exit.signal==='SIGTERM');result.stopSignalSent='SIGTERM';}
  }
  const sessionsResult=await run(['proxy','sessions','--json'],'capture-readback');assert.deepEqual(sessionsResult.exit,{code:0,signal:null});const sessions=JSON.parse(sessionsResult.stdout);record.captureSessions=sessions;record.originHits=originHits;
  record.observation=expected==='base'?'RED: documented --host option with ::1 binds but URL parsing fails; neither start nor run reaches local HTTP origin. IPv4 controls pass.':'GREEN: start and run serialize [::1], forward real HTTP and complete capture cleanup; IPv4 and credential-isolation controls pass.';save();
 }finally{await new Promise(resolve=>origin.close(resolve));}
});
