import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkoutArg,outArg,expected]=process.argv.slice(2),checkout=path.resolve(checkoutArg),out=path.resolve(outArg);
assert.ok(['base','head'].includes(expected));fs.mkdirSync(out,{recursive:false});
const {chromium}=createRequire(path.join(checkout,'ui/package.json'))('playwright');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const scenarios=[{name:'empty',allow:[],pack:true},{name:'explicit',allow:['diffs','diffs-language-pack'],pack:true},{name:'disabled',allow:['diffs'],pack:false}];
const summary=[];
for(const scenario of scenarios){
 const record=await withIsolatedGateway(checkout,path.join(out,scenario.name),async({config})=>{
  config.plugins={allow:scenario.allow,slots:{memory:'none'},entries:{diffs:{enabled:true},'diffs-language-pack':{enabled:scenario.pack}}};
 },async({out,record,rpc,save})=>{
  record.scenario=scenario;record.proof={entry:'Normally built Gateway -> public tools.invoke diffs -> actual tokenized HTTP viewer -> real Chromium hydrated DOM',modelsCalled:false,targetMocked:false,externalServices:false,fileRenderNotClaimed:true};save();
  const inventory=await rpc('plugins.list',{});record.plugins=inventory.plugins.filter(p=>['diffs','diffs-language-pack'].includes(p.id));save();
  await rpc('sessions.create',{key:'agent:main:diffs-pack-proof',agentId:'main'});
  const result=await rpc('tools.invoke',{name:'diffs',args:{before:'{ pkgs }: { enabled = false; package = pkgs.hello; }\n',after:'{ pkgs }: { enabled = true; package = pkgs.git; }\n',path:'proof.txt',lang:'nix',mode:'view'},sessionKey:'agent:main:diffs-pack-proof',agentId:'main',conversationReadOrigin:'direct-operator'});
  assert.equal(result.ok,true,JSON.stringify(result));const url=result.output.details.viewerUrl;assert.ok(url);record.viewerUrl=url;save();
  const response=await fetch(url);assert.equal(response.status,200);const html=await response.text();fs.writeFileSync(path.join(out,'viewer.html'),html);
  const payloads=[...html.matchAll(/<script[^>]*data-openclaw-diff-payload[^>]*>([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));assert.equal(payloads.length,1);
  const shouldHighlight=scenario.pack&&(scenario.name==='explicit'||expected==='head');
  assert.equal(payloads[0].langs.includes('nix'),shouldHighlight,JSON.stringify(payloads[0].langs));
  record.readback={httpStatus:response.status,langs:payloads[0].langs,oldLang:payloads[0].oldFile?.lang,newLang:payloads[0].newFile?.lang,usesPackRuntime:html.includes('diffs-language-pack/assets/')};save();
  let browser;
  try{
   browser=await chromium.launch({headless:true,executablePath});record.browserVersion=browser.version();const page=await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:1});record.pageErrors=[];page.on('pageerror',error=>record.pageErrors.push(String(error)));
   await page.goto(url);await page.waitForFunction(()=>document.documentElement.dataset.openclawDiffsReady==='true',{},{timeout:30000});
   record.render=await page.evaluate(()=>{const root=document.querySelector('[data-openclaw-diff-host]')?.shadowRoot;return {ready:document.documentElement.dataset.openclawDiffsReady,text:root?.textContent,spans:root?[...root.querySelectorAll('pre span')].filter(x=>x.textContent.trim()).map(x=>({text:x.textContent,color:getComputedStyle(x).color,style:x.getAttribute('style')})):[]};});
   assert.ok(record.render.text?.includes('pkgs'));assert.equal(record.pageErrors.length,0,JSON.stringify(record.pageErrors));
   await page.screenshot({path:path.join(out,'viewer.png'),fullPage:true});save();
  }finally{await browser?.close();}
  record.observation=scenario.name==='empty'?(expected==='base'?'RED: active installed language pack is ignored for valid empty allowlist; explicit Nix hint becomes text':'GREEN: empty allowlist retains explicit Nix highlighting with installed language pack'):scenario.name==='explicit'?'CONTROL: explicit allowed language pack retains Nix highlighting':'CONTROL: disabled/excluded language pack remains plain text';save();
 });summary.push({scenario:scenario.name,result:record.result,sha:record.sha,observation:record.observation,readback:record.readback,render:record.render,cleanup:record.cleanup});
}
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({expected,scenarios:summary},null,2));
