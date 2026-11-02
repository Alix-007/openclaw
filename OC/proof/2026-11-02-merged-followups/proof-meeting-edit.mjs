import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkout,out,expected]=process.argv.slice(2);assert.ok(['base','head'].includes(expected));
const requireUi=createRequire(path.join(checkout,'ui/package.json'));const {chromium}=requireUi('playwright');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
await withIsolatedGateway(checkout,out,async({config})=>{
 config.transcripts={enabled:true,autoStart:[{providerId:'proof-unavailable',title:'Saved meeting title',sessionId:'proof-meeting'}]};
},async({config,record,rpc,save})=>{
 let browser,context,page;record.proof={entry:'Normal Gateway-served built Control UI -> real config.set -> separate public config.get readback',externalServices:false,modelsCalled:false,mockedGateway:false};record.cases=[];record.uiWrites=[];record.pageErrors=[];record.stage='launch';save();
 try{
  browser=await chromium.launch({headless:true,executablePath});record.browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:1440,height:1400},colorScheme:'dark',locale:'en-US',serviceWorkers:'block'});page=await context.newPage();page.setDefaultTimeout(30000);
  const origin=record.domain.replace('ws:','http:');
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort('blockedbyclient'));
  page.on('pageerror',error=>{record.pageErrors.push(error.message.replaceAll(config.gateway.auth.token,'[ephemeral token]'));save();});
  const pending=new Map();page.on('websocket',socket=>{
   socket.on('framesent',({payload})=>{try{const f=JSON.parse(String(payload));if(f.type==='req'&&f.method==='config.set'){const v=JSON.parse(f.params.raw);pending.set(f.id,{method:f.method,transcripts:v.transcripts});}}catch{}});
   socket.on('framereceived',({payload})=>{try{const f=JSON.parse(String(payload)),p=pending.get(f.id);if(p){record.uiWrites.push({...p,ok:f.ok,transcriptsReadback:f.payload?.config?.transcripts,error:f.error?.message});pending.delete(f.id);save();}}catch{}});
  });
  record.stage='navigate';save();
  const response=await page.goto(origin+'/settings/communications?section=transcripts#token='+encodeURIComponent(config.gateway.auth.token),{timeout:60000});record.httpStatus=response?.status();
  const capture=page.locator('openclaw-meeting-capture-settings');await capture.getByRole('button',{name:'Edit source 1',exact:true}).waitFor({state:'visible',timeout:60000});
  record.servedAssets=await page.locator('script[src]').evaluateAll(xs=>xs.map(x=>x.getAttribute('src')));const entry=record.servedAssets.find(x=>x.includes('/assets/index-'));assert.ok(entry);const entryResponse=await page.request.get(origin+entry);record.servedEntry={path:entry,status:entryResponse.status(),sha256:createHash('sha256').update(await entryResponse.body()).digest('hex')};
  await capture.getByRole('button',{name:'Edit source 1',exact:true}).click();const title=capture.getByRole('textbox',{name:'Title',exact:true});await title.fill('Draft meeting title');
  record.stage='sibling autosave';save();const toggle=capture.getByRole('switch',{name:'Enable transcript storage',exact:true});await toggle.uncheck();
  await page.waitForFunction(()=>!document.querySelector('openclaw-meeting-capture-settings button[type="submit"]')?.disabled);
  const deadline=performance.now()+30000;let saved;
  while(performance.now()<deadline){saved=await rpc('config.get',{});if(saved.config.transcripts.enabled===false&&record.uiWrites.length>0)break;await new Promise(resolve=>setTimeout(resolve,250));}
  assert.equal(saved.config.transcripts.enabled,false);assert.equal(saved.config.transcripts.autoStart[0].title,'Saved meeting title');assert.equal(await title.inputValue(),'Draft meeting title');
  record.cases.push({name:'unrelated setting saved through UI, edited source unchanged',transcripts:saved.config.transcripts,draftTitle:await title.inputValue(),uiWriteCount:record.uiWrites.length});save();
  await title.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'before-save.png'),animations:'disabled'});
  const saveSource=capture.getByRole('button',{name:'Save source',exact:true});await saveSource.click();
  if(expected==='base'){
   await capture.getByRole('alert').filter({hasText:'This source changed while you were editing.'}).waitFor({state:'visible'});
   const unchanged=await rpc('config.get',{});assert.equal(unchanged.config.transcripts.autoStart[0].title,'Saved meeting title');assert.equal(await title.inputValue(),'Draft meeting title');record.cases.push({name:'false stale-source rejection',transcripts:unchanged.config.transcripts,alert:await capture.getByRole('alert').innerText()});
   await capture.getByRole('alert').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'after-save.png'),animations:'disabled'});
   await capture.getByRole('button',{name:'Cancel',exact:true}).click();await capture.getByRole('button',{name:'Edit source 1',exact:true}).click();await title.fill('Legal control title');await saveSource.click();
  }else{
   await saveSource.waitFor({state:'hidden'});assert.equal(await capture.getByRole('alert').count(),0);await capture.getByRole('button',{name:'Edit source 1',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'after-save.png'),animations:'disabled'});
  }
  let final;const finalDeadline=performance.now()+30000,expectedTitle=expected==='base'?'Legal control title':'Draft meeting title';
  while(performance.now()<finalDeadline){final=await rpc('config.get',{});if(final.config.transcripts.autoStart[0].title===expectedTitle)break;await new Promise(resolve=>setTimeout(resolve,250));}
  assert.deepEqual(final.config.transcripts,{enabled:false,autoStart:[{providerId:'proof-unavailable',title:expectedTitle,sessionId:'proof-meeting'}]});
  const ackDeadline=performance.now()+30000;
  while(!record.uiWrites.some(write=>write.ok===true&&write.transcriptsReadback?.autoStart?.[0]?.title===expectedTitle)){
   assert.ok(performance.now()<ackDeadline,'Final UI config.set acknowledgement was not observed');
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  record.cases.push({name:expected==='base'?'legal control: Cancel and reopen can save':'source edit saved after sibling autosave',transcripts:final.config.transcripts,uiWriteCount:record.uiWrites.length});
  record.observation=expected==='base'?'RED: completed unrelated UI autosave makes an unchanged source appear replaced; Cancel/reopen control can save':'GREEN: source edit survives completed unrelated UI autosave and persists through real Gateway config readback';record.stage='complete';save();
 }catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw new Error(String(error).replaceAll(config.gateway.auth.token,'[ephemeral token]'));}
 finally{await context?.close();await browser?.close();}
});
