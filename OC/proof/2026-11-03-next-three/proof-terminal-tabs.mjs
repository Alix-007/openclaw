import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkoutArg,outArg,expected]=process.argv.slice(2),checkout=path.resolve(checkoutArg),out=path.resolve(outArg);assert.ok(['base','head'].includes(expected));
const {chromium,webkit}=createRequire(path.join(checkout,'ui/package.json'))('playwright');const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
await withIsolatedGateway(checkout,out,async({config})=>{config.plugins={slots:{memory:'none'}};config.agents.defaults.workspace=fs.mkdtempSync('/tmp/openclaw-terminal-proof-');config.gateway.terminal={enabled:true,shell:'/bin/sh',detachedSessionTimeoutSeconds:0};},async({out,config,record,rpc,save})=>{
 let browser,context,page;record.pageErrors=[];record.stage='open actual terminal page';record.proof={entry:'Normally built Gateway-served Control UI terminal page with real native PTYs and real keyboard navigation',modelsCalled:false,applicationStateInjected:false,gatewayOrModulesMocked:false,terminalCommandsEntered:false};save();
 try{
  browser=process.env.PROOF_WEBKIT_ENDPOINT?await webkit.connect(process.env.PROOF_WEBKIT_ENDPOINT,process.env.PROOF_WEBKIT_HEADED?{headers:{'x-playwright-launch-options':JSON.stringify({headless:false})}}:undefined):await chromium.launch({headless:true,executablePath});context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'});page=await context.newPage();page.setDefaultTimeout(25000);record.browserEngine=process.env.PROOF_WEBKIT_ENDPOINT?'WebKit':'Chromium';record.browserVersion=browser.version();
  page.on('pageerror',error=>{record.pageErrors.push(String(error).replaceAll(config.gateway.auth.token,'[ephemeral token]'));save();});
  const inputFrames=[];page.on('websocket',socket=>socket.on('framesent',({payload})=>{try{const f=JSON.parse(String(payload));if(f.method==='terminal.input')inputFrames.push({sessionId:f.params?.sessionId,data:f.params?.data});}catch{}}));
  const origin=record.domain.replace('ws:','http:');await page.goto(origin+'/terminal#token='+encodeURIComponent(config.gateway.auth.token));
  await page.getByRole('button',{name:'New terminal session',exact:true}).filter({visible:true}).first().waitFor({timeout:60000});
  const entry=await page.locator('script[src]').evaluateAll(xs=>xs.map(x=>x.getAttribute('src')).find(x=>x.includes('/assets/index-')));assert.ok(entry);const asset=await page.request.get(origin+entry);record.servedEntry={path:entry,status:asset.status(),sha256:createHash('sha256').update(await asset.body()).digest('hex')};save();
  const panel=page.locator('openclaw-terminal-page openclaw-terminal-panel').filter({visible:true});
  const newTerminal=panel.getByRole('button',{name:'New terminal session',exact:true});
  let tabs=panel.getByRole('tab');
  await tabs.first().waitFor();await newTerminal.waitFor({state:'visible'});await page.waitForFunction(el=>!el.disabled,await newTerminal.elementHandle());
  await newTerminal.click();await tabs.nth(1).waitFor();await page.waitForFunction(el=>!el.disabled,await newTerminal.elementHandle());
  const describe=()=>page.evaluate(()=>{let e=document.activeElement;while(e?.shadowRoot?.activeElement)e=e.shadowRoot.activeElement;return {tag:e?.tagName,role:e?.getAttribute('role'),name:e?.getAttribute('aria-label'),text:e?.textContent?.trim().slice(0,100),className:e?.className,id:e?.id};});
  record.stage='real keyboard tab navigation';save();
  // Begin at the real tablist's focus entry; focus() changes native DOM focus only, not application state.
  const current=panel.getByRole('tab',{selected:true});await current.focus();assert.equal(await current.evaluate(el=>el===el.getRootNode().activeElement),true);
  const before=inputFrames.length;await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(el=>el.getAttribute('aria-selected')==='true',await tabs.first().elementHandle());
  // Wait two painted frames so the owner after-render focus has run.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  record.afterLeft=await describe();record.tabStates=await tabs.evaluateAll(xs=>xs.map(x=>({id:x.id,selected:x.getAttribute('aria-selected'),focused:x===x.getRootNode().activeElement})));save();
  assert.equal(record.afterLeft.role==='tab',expected==='head',JSON.stringify(record.afterLeft));
  await page.screenshot({path:path.join(out,'after-arrow.png')});
  if(expected==='head'){
   for(const key of ['ArrowRight','Home','End']){await page.keyboard.press(key);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal((await describe()).role,'tab');}
   assert.equal(inputFrames.length,before,'Tab navigation must not become terminal input');
  }
  record.explicitActivation=[];
  for(const action of ['Enter','Space','selected-click']){
   const selected=panel.getByRole('tab',{selected:true});await selected.focus();
   if(action==='selected-click')await selected.click();else await page.keyboard.press(action);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const focus=await describe();record.explicitActivation.push({action,focus});save();
   assert.equal(focus.role==='tab',expected==='base','Explicit activation focuses the current PTY on fixed head');
  }
  assert.equal(inputFrames.length,before,'Navigation and activation must not send shell input');
  await panel.getByRole('tab',{selected:false}).first().click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));record.pointerControl=await describe();assert.notEqual(record.pointerControl.role,'tab','Pointer selection keeps terminal focus');
  record.inputFrames=inputFrames;record.nativeSessions=await rpc('terminal.list',{});record.observation=expected==='base'?'RED: ArrowLeft selects the previous terminal but the after-render callback steals focus from the tablist into the PTY.':'GREEN: Arrow/Home/End stay on selected tabs without emitting terminal input; pointer selection still focuses the native terminal.';record.stage='complete';save();
 }catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''));}throw new Error(String(error).replaceAll(config.gateway.auth.token,'[ephemeral token]'));}
 finally{await context?.close();await browser?.close();}
});
