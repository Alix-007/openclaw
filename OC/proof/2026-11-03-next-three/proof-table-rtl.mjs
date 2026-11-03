import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkoutArg,outArg,expected]=process.argv.slice(2),checkout=path.resolve(checkoutArg),out=path.resolve(outArg);assert.ok(['base','head'].includes(expected));const {chromium,webkit}=createRequire(path.join(checkout,'ui/package.json'))('playwright');const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
await withIsolatedGateway(checkout,out,async({config})=>{config.plugins={slots:{memory:'none'}};},async({out,config,record,rpc,save})=>{
 let browser,context,page;record.pageErrors=[];record.cases=[];record.stage='create real transcript fixtures';record.proof={entry:'Normally built Gateway chat.inject -> persisted chat.history -> built Control UI -> native horizontal wheel scrolling -> computed masks and readback',modelsCalled:false,applicationStateInjected:false,gatewayOrModulesMocked:false,externalChannels:false};save();
 try{
  const key='agent:main:table-rtl-proof';await rpc('sessions.create',{key,agentId:'main',cwd:config.agents.defaults.workspace,worktree:false});
  const table='| '+Array.from({length:14},(_,i)=>'Column '+(i+1)).join(' | ')+' |\n| '+Array(14).fill('---').join(' | ')+' |\n| '+Array.from({length:14},(_,i)=>'value-'+i+'-long-cell').join(' | ')+' |';
  for(const intro of ['مرحبا، تقرير الجدول','Hello, table report'])await rpc('chat.inject',{sessionKey:key,message:intro+'\n\n'+table});
  record.history=await rpc('chat.history',{sessionKey:key,limit:10});save();
  browser=process.env.PROOF_WEBKIT_ENDPOINT?await webkit.connect(process.env.PROOF_WEBKIT_ENDPOINT,process.env.PROOF_WEBKIT_HEADED?{headers:{'x-playwright-launch-options':JSON.stringify({headless:false})}}:undefined):await chromium.launch({headless:true,executablePath});record.browserEngine=process.env.PROOF_WEBKIT_ENDPOINT?'WebKit':'Chromium';record.browserVersion=browser.version();context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US'});page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',e=>record.pageErrors.push(String(e).replaceAll(config.gateway.auth.token,'[ephemeral token]')));
  const origin=record.domain.replace('ws:','http:');await page.goto(origin+'/chat/main/table-rtl-proof#token='+encodeURIComponent(config.gateway.auth.token));const shells=page.locator('.chat-text .markdown-table[data-table-interactions]');await shells.nth(1).waitFor({timeout:60000});
  const entry=await page.locator('script[src]').evaluateAll(xs=>xs.map(x=>x.getAttribute('src')).find(x=>x.includes('/assets/index-')));const asset=await page.request.get(origin+entry);record.servedEntry={path:entry,status:asset.status(),sha256:createHash('sha256').update(await asset.body()).digest('hex')};
  const measure=async(shell)=>shell.evaluate(el=>{const v=el.querySelector('.markdown-table__viewport');return {direction:getComputedStyle(v).direction,scrollLeft:v.scrollLeft,clientWidth:v.clientWidth,scrollWidth:v.scrollWidth,left:el.classList.contains('markdown-table--can-scroll-left'),right:el.classList.contains('markdown-table--can-scroll-right'),mask:getComputedStyle(v).maskImage};});
  for(let i=0;i<2;i++){
   const shell=shells.nth(i),v=shell.locator('.markdown-table__viewport');await shell.scrollIntoViewIfNeeded();await v.waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const first=await measure(shell);assert.ok(first.scrollWidth>first.clientWidth+100);const rtl=first.direction==='rtl';assert.equal(rtl,i===0);
   record.cases.push({direction:first.direction,start:first});save();const entryCase=record.cases.at(-1);
   if(!rtl||expected==='head')assert.deepEqual([first.left,first.right],rtl?[true,false]:[false,true]);else assert.deepEqual([first.left,first.right],[false,true]);
   await page.screenshot({path:path.join(out,(rtl?'rtl':'ltr')+'-start.png')});await v.hover();await page.mouse.wheel(rtl?-10000:10000,0);
   await page.waitForFunction(el=>Math.abs(el.scrollLeft)>=el.scrollWidth-el.clientWidth-2,await v.elementHandle());await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const end=await measure(shell);entryCase.end=end;save();
   if(!rtl||expected==='head')assert.deepEqual([end.left,end.right],rtl?[false,true]:[true,false]);else assert.deepEqual([end.left,end.right],[false,true]);
   await page.screenshot({path:path.join(out,(rtl?'rtl':'ltr')+'-end.png')});
  }
  record.observation=expected==='base'?'RED: RTL tables fade the physical right edge at both scroll endpoints; LTR controls correctly switch fades.':'GREEN: RTL and LTR table fades track the physical edge with hidden content at both native scroll endpoints.';record.stage='complete';save();
 }catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''));}throw new Error(String(error).replaceAll(config.gateway.auth.token,'[ephemeral token]'));}
 finally{await context?.close();await browser?.close();}
});
