import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkoutArg,outArg,expected]=process.argv.slice(2),checkout=path.resolve(checkoutArg),out=path.resolve(outArg);assert.ok(['base','head'].includes(expected));
const {chromium,webkit}=createRequire(path.join(checkout,'ui/package.json'))('playwright');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
await withIsolatedGateway(checkout,out,async({out,config})=>{
 config.plugins={slots:{memory:'none'}};
 for(const name of ['a','b'])fs.writeFileSync(path.join(out,'workspace',`draft-${name}.txt`),`Saved ${name.toUpperCase()}\n`);
},async({out,config,record,rpc,save})=>{
 let browser,context,page;record.stage='create public session';record.pageErrors=[];record.failedRequests=[];record.proof={entry:'Normally built Gateway-served Control UI; real file edits, browser offline CSS failure, real reload guard and recovery modal',modelsCalled:false,gatewayOrModulesMocked:false,applicationStateInjected:false};save();
 try{
  const created=await rpc('sessions.create',{key:'agent:main:draft-focus-proof',agentId:'main',cwd:config.agents.defaults.workspace,worktree:false});assert.equal(created.runStarted,false);
  browser=process.env.PROOF_WEBKIT_ENDPOINT?await webkit.connect(process.env.PROOF_WEBKIT_ENDPOINT):await chromium.launch({headless:true,executablePath});record.browserVersion=browser.version();record.browserEngine=process.env.PROOF_WEBKIT_ENDPOINT?'WebKit':'Chromium';
  context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US',serviceWorkers:'block'});page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',e=>{record.pageErrors.push(String(e).replaceAll(config.gateway.auth.token,'[ephemeral token]'));save();});
  page.on('requestfailed',req=>{record.failedRequests.push({url:req.url(),error:req.failure()?.errorText});save();});
  record.stage='open chat';save();const origin=record.domain.replace('ws:','http:');await page.goto(origin+'/chat/main/draft-focus-proof#token='+encodeURIComponent(config.gateway.auth.token));
  const pane=page.locator('.chat-pane-cache__pane--active, .chat-split-view__cell--active openclaw-chat-pane.chat-split-view__pane').filter({visible:true}).first();
  await pane.getByRole('button',{name:'Panels',exact:true}).filter({visible:true}).first().waitFor({timeout:60000});
  record.servedAssets=await page.locator('script[src]').evaluateAll(xs=>xs.map(x=>x.getAttribute('src')));
  const entry=record.servedAssets.find(x=>x.includes('/assets/index-'));assert.ok(entry);const asset=await page.request.get(origin+entry);record.servedEntry={path:entry,status:asset.status(),sha256:createHash('sha256').update(await asset.body()).digest('hex')};save();
  if(!await pane.locator('[data-panel-slot="workspace"]:not([hidden])').isVisible()){
   await pane.getByRole('button',{name:'Panels',exact:true}).filter({visible:true}).first().click();
   await pane.locator('.side-panel-launcher').getByRole('button').filter({has:page.locator('.side-panel-type-option__label').getByText('Files',{exact:true})}).click();
  }
  for(const name of ['a','b']){
   record.stage='edit draft '+name;save();
   const file=pane.getByRole('button',{name:`draft-${name}.txt`,exact:true});
   if(name==='b'&&!await file.isVisible())await pane.getByRole('button',{name:'Root',exact:true}).filter({visible:true}).last().click();
   await file.waitFor({state:'visible'});
   await file.dblclick();await page.getByRole('button',{name:'More file actions',exact:true}).filter({visible:true}).last().click();
   await page.getByRole('menuitem',{name:'Edit file',exact:true}).click();
   await page.locator('.cm-content[contenteditable="true"]').filter({visible:true}).last().fill(`Unsaved ${name.toUpperCase()}\n`);
  }
  record.stage='real offline cold Settings import';save();
  await page.getByRole('button',{name:/^Identity and app menu for /}).click();
  const settings=page.getByRole('menuitem',{name:/^Settings/});await settings.waitFor({state:'visible'});
  const coldCss=page.waitForEvent('requestfailed',{predicate:req=>/config-page-.*\.css(?:\?|$)/.test(req.url()),timeout:30000}).catch(error=>({proofFailure:String(error)}));
  await context.setOffline(true);await settings.click();const failedCss=await coldCss;assert.equal(failedCss.proofFailure,undefined,String(failedCss.proofFailure));
  await context.setOffline(false);record.stage='real guarded reload';save();
  await page.getByRole('button',{name:'Reload',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'Reload',exact:true}).click();
  await page.getByRole('button',{name:'Review file drafts',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Review file drafts',exact:true});await modal.waitFor();
  assert.equal(await modal.locator('textarea').count(),2);assert.deepEqual(await modal.locator('textarea').evaluateAll(xs=>xs.map(x=>x.value).sort()),['Unsaved A\n','Unsaved B\n']);
  const discard=modal.getByRole('button',{name:'Discard draft-a.txt',exact:true});
  for(let i=0;i<14&&!await discard.evaluate(el=>el===document.activeElement);i++)await page.keyboard.press('Tab');
  assert.equal(await discard.evaluate(el=>el===document.activeElement),true,'Reach discard with actual keyboard traversal');
  await page.screenshot({path:path.join(out,'before-discard.png')});
  await page.keyboard.press('Enter');await discard.waitFor({state:'hidden'});
  record.afterDiscard=await page.evaluate(()=>{const e=document.activeElement,m=document.querySelector('openclaw-modal-dialog');return {tag:e?.tagName,text:e?.textContent?.trim().slice(0,100),ariaLabel:e?.getAttribute('aria-label'),isBody:e===document.body,inModal:!!m?.contains(e)};});
  assert.equal(record.afterDiscard.inModal,expected==='head',JSON.stringify(record.afterDiscard));
  assert.equal(await modal.locator('textarea').inputValue(),'Unsaved B\n');
  await page.screenshot({path:path.join(out,'after-discard.png')});
  await page.keyboard.press('Tab');record.nextTab=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.trim().slice(0,100),ariaLabel:document.activeElement?.getAttribute('aria-label'),inModal:!!document.querySelector('openclaw-modal-dialog')?.contains(document.activeElement)}));
  await modal.getByRole('button',{name:'Keep drafts',exact:true}).click();await modal.waitFor({state:'hidden'});
  for(const name of ['a','b'])assert.equal(fs.readFileSync(path.join(out,'workspace',`draft-${name}.txt`),'utf8'),`Saved ${name.toUpperCase()}\n`);
  record.control={remainingDraft:'Unsaved B\n',keepDraftsCloses:true,savedFilesUnchanged:true};record.observation=expected==='base'?'RED: keyboard Discard removes its focused row and leaves focus outside the still-open recovery dialog':'GREEN: keyboard Discard moves focus to a surviving recovery action while retaining the other draft';record.stage='complete';save();
 }catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''));}throw new Error(String(error).replaceAll(config.gateway.auth.token,'[ephemeral token]'));}
 finally{await context?.setOffline(false).catch(()=>{});await context?.close();await browser?.close();}
});
