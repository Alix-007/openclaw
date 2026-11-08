import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const checkout=path.resolve(process.argv[2]), output=path.resolve(process.argv[3]), expected=process.argv[4];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:checkout,encoding:'utf8'}).trim();
fs.mkdirSync(output,{recursive:true});assert.equal(git('rev-parse','HEAD'),expected);assert.equal(git('status','--porcelain','--untracked-files=no'),'');
const index=fs.readFileSync(path.join(checkout,'dist/control-ui/index.html'));
const build=JSON.parse(index.toString().match(/globalThis\.OPENCLAW_CONTROL_UI_BUILD_INFO=(\{[^<]+\});<\/script>/)[1]);assert.equal(build.commit,expected);assert.equal(build.dirty,false);
const load=name=>import(pathToFileURL(path.join(checkout,name)));
const {startBuiltControlUiE2eServer,installMockGateway}=await load('ui/src/test-helpers/control-ui-e2e.ts');
const {buildSkillLibraryMock}=await load('ui/src/test-helpers/skill-library-fixtures.ts');
const {chromium}=createRequire(path.join(checkout,'package.json'))('playwright');
const [own,shared,team]=buildSkillLibraryMock();
const list={entries:[own.entry,shared.entry,team.entry],profileId:'profile-alice',multipleProfiles:true,defaultTarget:'personal',canManageWorkspace:false,defaultSelectionLimit:64};
const published={state:'published',target:'personal',entry:{...own.entry,revision:'2'.repeat(64)},sessionActivation:'new-sessions',nextAction:'Refresh explicitly in existing sessions.'};
const draft=own.content+'\nNative IME acceptance fixture: ';
const files=['ui/src/pages/skills/library-dialog.tsx','ui/src/pages/skills/library-dialog-content.tsx','ui/src/pages/skills/library-state.ts'];const sourceHashes=Object.fromEntries(files.map(name=>[name,hash(fs.readFileSync(path.join(checkout,name)))]));
const receipt={startedAt:new Date().toISOString(),head:expected,build,indexSha256:hash(index),collectorSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),sourceHashes,status:'SETUP',errors:[],limitations:['Real normally built production UI in native Chromium; official synthetic Gateway supplies skill library fixtures and records only synthetic writes. No real skills/files, external channel, model or production Gateway changed.','Chromium CDP Input.imeSetComposition creates an actual browser IME composition; Playwright keyboard sends the ordinary Ctrl+Enter shortcut. Event observation records actual isTrusted/isComposing without manufacturing flags or calling product owners.','This proves Chromium behavior only, not macOS/Windows IME or WebKit platform compatibility.']};let browser,server,page;
const save=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
async function scene(name){
 const context=await browser.newContext({viewport:{width:1280,height:950},locale:'en-US',serviceWorkers:'block'});const p=await context.newPage();page=p;p.setDefaultTimeout(15000);p.on('pageerror',e=>receipt.errors.push({scene:name,error:String(e)}));
 const gateway=await installMockGateway(p,{serverVersion:build.version,serverCommit:build.commit,serverBuiltAt:build.builtAt,serverBuildId:build.buildId,operatorScopes:['operator.read','operator.write'],methodResponses:{'skills.library.list':list,'skills.status':{workspaceDir:'/tmp/synthetic-workspace',managedSkillsDir:'/tmp/synthetic-skills',skills:[]},'skills.library.save':published,'skills.library.read':own}});
 await p.goto(server.baseUrl+'skills');await p.getByRole('button',{name:'Skill settings',exact:true}).click();await p.waitForURL(server.baseUrl+'settings/skills?agent=main');await p.getByRole('button',{name:'Create skill',exact:true}).click();const input=p.getByLabel('SKILL.md',{exact:true});await p.getByLabel('Skill name',{exact:true}).fill('release-notes');await input.fill(draft);assert.equal(await input.inputValue(),draft);assert.equal((await gateway.getRequests('skills.library.save')).length,0);
 await input.evaluate(node=>{window.__skillImeObserved=[];for(const type of ['compositionstart','compositionupdate','compositionend','keydown','keyup','beforeinput','input'])node.addEventListener(type,event=>{window.__skillImeObserved.push({type:event.type,key:event.key,code:event.code,keyCode:event.keyCode,ctrlKey:event.ctrlKey,metaKey:event.metaKey,isComposing:event.isComposing,isTrusted:event.isTrusted,data:event.data,inputType:event.inputType,defaultPrevented:event.defaultPrevented,value:node.value});});});
 return {context,page:p,input,gateway};
}
try{
 server=await startBuiltControlUiE2eServer(path.join(checkout,'dist/control-ui'));receipt.baseUrl=server.baseUrl;const servedIndex=Buffer.from(await (await fetch(server.baseUrl)).arrayBuffer());assert.equal(hash(servedIndex),receipt.indexSha256);const entry=index.toString().match(/<script[^>]+src="([^"]+)"/)[1];const servedEntry=Buffer.from(await(await fetch(new URL(entry,server.baseUrl))).arrayBuffer());const localEntry=fs.readFileSync(path.join(checkout,'dist/control-ui',entry));assert.equal(hash(servedEntry),hash(localEntry));receipt.served={indexSha256:hash(servedIndex),entryPath:entry,entrySha256:hash(servedEntry)};browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const normal=await scene('ordinary-shortcut');await normal.input.press('Control+Enter');const normalSave=await normal.gateway.waitForRequest('skills.library.save');assert.equal(normalSave.params.slug,'release-notes');assert.equal(normalSave.params.content,draft);assert.equal((await normal.gateway.getRequests('skills.library.save')).length,1);await normal.page.getByText(/Saved release-notes to personal library/u).waitFor();receipt.positiveControl={status:'PASS',request:normalSave,events:await normal.page.evaluate(()=>window.__skillImeObserved)};await normal.page.screenshot({path:path.join(output,'ordinary-shortcut-control.png'),fullPage:true});await normal.context.close();page=undefined;save();
 const composed=await scene('active-composition');const cdp=await composed.context.newCDPSession(composed.page);await composed.input.focus();await composed.input.press('End');await composed.gateway.deferNext('skills.library.save');await cdp.send('Input.imeSetComposition',{text:'臨時',selectionStart:2,selectionEnd:2});receipt.beforeKey={value:await composed.input.inputValue(),events:await composed.page.evaluate(()=>window.__skillImeObserved)};assert.ok(receipt.beforeKey.events.some(e=>e.type==='compositionstart'&&e.isTrusted),'Native browser composition must actually start');assert.ok(receipt.beforeKey.events.some(e=>e.type==='input'&&e.isComposing),'Native composition input must be observable');await composed.page.screenshot({path:path.join(output,'active-composition-before-shortcut.png'),fullPage:true});
 await composed.input.press('Control+Enter');await composed.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));receipt.afterKey={value:await composed.input.inputValue(),events:await composed.page.evaluate(()=>window.__skillImeObserved),requests:await composed.gateway.getRequests('skills.library.save'),dialogOpen:await composed.page.locator('form.skill-library-dialog').isVisible()};
 const key=receipt.afterKey.events.find(e=>e.type==='keydown'&&e.key==='Enter'&&e.ctrlKey);assert.ok(key?.isTrusted,'Shortcut must be a trusted browser keyboard event');receipt.actualShortcut=key;
 receipt.status=key.isComposing&&receipt.afterKey.requests.length>0?'RED_SAVED_DURING_NATIVE_COMPOSITION':key.isComposing?'NO_RED_COMPOSITION_NOT_SAVED':'NO_RED_BROWSER_COMMITTED_BEFORE_SHORTCUT';
 await composed.page.screenshot({path:path.join(output,'after-composing-shortcut.png'),fullPage:true});
 if(receipt.afterKey.requests.length){assert.equal(receipt.afterKey.requests.length,1);await composed.gateway.rejectDeferred('skills.library.save',{code:'UNAVAILABLE',message:'Synthetic proof collector intentionally leaves the composing draft unsaved.'});await composed.page.getByText('Synthetic proof collector intentionally leaves the composing draft unsaved.',{exact:true}).waitFor();receipt.cleanupDraft=await composed.input.inputValue();}else{
  assert.ok(key.isComposing,'Native shortcut must occur during composition');
  assert.equal(receipt.afterKey.dialogOpen,true);assert.equal(receipt.afterKey.value,draft+'臨時');
  await cdp.send('Input.insertText',{text:'臨時'});
  await composed.page.waitForFunction(()=>window.__skillImeObserved.some(e=>e.type==='compositionend'&&e.data==='臨時'));
  receipt.commitBoundary={method:'CDP Input.insertText',events:await composed.page.evaluate(()=>window.__skillImeObserved.filter(e=>e.type==='compositionend')),limitation:'Chromium CDP commit reports compositionend.isTrusted=false; trusted native compositionstart/input/composing shortcut and subsequent non-composing shortcut are separately required. No page-dispatched event or altered flag.'};
  assert.equal(await composed.input.inputValue(),draft+'臨時');
  await composed.input.press('Control+Enter');
  const saved=await composed.gateway.waitForRequest('skills.library.save');
  assert.equal(saved.params.slug,'release-notes');assert.equal(saved.params.content,draft+'臨時');
  assert.equal((await composed.gateway.getRequests('skills.library.save')).length,1);
  await composed.gateway.resolveDeferred('skills.library.save',published);
  await composed.page.getByText(/Saved release-notes to personal library/u).waitFor();
  receipt.afterComposition={status:'PASS',expectedContent:draft+'臨時',request:saved,events:await composed.page.evaluate(()=>window.__skillImeObserved),finalContent:await composed.input.inputValue(),saveCount:(await composed.gateway.getRequests('skills.library.save')).length};
  assert.equal(receipt.afterComposition.finalContent,receipt.afterComposition.expectedContent);
  const finalShortcut=receipt.afterComposition.events.filter(e=>e.type==='keydown'&&e.key==='Enter'&&e.ctrlKey).at(-1);
  assert.ok(finalShortcut?.isTrusted&&!finalShortcut.isComposing,'Committed ordinary shortcut must be trusted and no longer composing');
  receipt.afterComposition.shortcut=finalShortcut;
  receipt.status='PASS_COMPOSITION_RETAINED_THEN_SAVED';
  await composed.page.screenshot({path:path.join(output,'committed-composition-saved.png'),fullPage:true});
 }
 await composed.context.close();page=undefined;assert.equal(git('rev-parse','HEAD'),expected);assert.equal(hash(fs.readFileSync(path.join(checkout,'dist/control-ui/index.html'))),receipt.indexSha256);assert.deepEqual(Object.fromEntries(files.map(name=>[name,hash(fs.readFileSync(path.join(checkout,name)))])),sourceHashes);
}catch(error){receipt.status='BLOCKED';receipt.error=String(error);if(page){receipt.failureDom=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}}finally{await browser?.close();await server?.close();receipt.finishedAt=new Date().toISOString();receipt.cleanup='Closed all isolated browser contexts and owned preview server. Premature composing writes on baseline were deferred/rejected; positive controls and final committed save use only the synthetic recorder. No real skill library or Gateway writes.';save();}
console.log(JSON.stringify({status:receipt.status,output,error:receipt.error,actualShortcut:receipt.actualShortcut,saveCount:receipt.afterKey?.requests.length}));process.exitCode=receipt.status==='BLOCKED'?2:0;
