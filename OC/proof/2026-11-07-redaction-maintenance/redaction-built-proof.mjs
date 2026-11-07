import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(process.argv[2]);
const parent=path.resolve(process.argv[3]);
const load=p=>import(pathToFileURL(path.join(root,p)).href);
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const {chromium}=createRequire(path.join(root,'ui/package.json'))('playwright');
const {createControlUiE2eArtifactDir}=await load('ui/src/test-helpers/control-ui-e2e-artifacts.ts');
const {startBuiltControlUiE2eServer,installMockGateway,controlUiBundledSettingsStorageKey,resolvePlaywrightChromiumExecutablePath}=await load('ui/src/test-helpers/control-ui-e2e.ts');
const {waitForControlUiGatewayReady}=await load('ui/src/test-helpers/control-ui-e2e-readiness.ts');
const out=createControlUiE2eArtifactDir('redaction-built',parent);
const receipt={at:new Date().toISOString(),head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--porcelain'),collectorSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),source:{},served:[],scenes:[],errors:[],limitations:['Real built UI in Chromium with canonical synthetic Gateway transport; no live authenticated Gateway, model, channel or external user.','The shipped image edit/apply and outbound attachment bytes are exercised. Owner-internal release/custody and parked/disabled lifetime rules also have separate focused tests.','Chromium only; WebKit is not claimed.','Existing Draft/product placement hold remains.']};
const save=()=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
assert.equal(receipt.status,'','Final native proof requires clean exact-head source');
const index=fs.readFileSync(path.join(root,'dist/control-ui/index.html'));
const info=index.toString().match(/globalThis\.OPENCLAW_CONTROL_UI_BUILD_INFO=(\{[^<]+\});<\/script>/);
assert.ok(info,'Normal build source identity required');receipt.build=JSON.parse(info[1]);
assert.equal(receipt.build.commit,receipt.head);assert.equal(receipt.build.dirty,false);
receipt.indexSha256=sha(index);
const assets=[...index.toString().matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>({path:m[1].replace(/^\.\//,''),sha256:sha(fs.readFileSync(path.join(root,'dist/control-ui',m[1].replace(/^\.\//,''))))}));
for(const file of ['ui/src/pages/chat/components/chat-image-redaction-button.tsx','ui/src/pages/chat/components/chat-image-redaction-dialog.tsx','ui/src/pages/chat/components/chat-image-redaction.ts','ui/src/pages/chat/components/chat-attachment-preview-strip.tsx'])receipt.source[file]={sha256:sha(fs.readFileSync(path.join(root,file))),blob:git('rev-parse',`HEAD:${file}`)};
let server,browser;const pending=[];
async function screenshot(page,name){
 await page.waitForFunction(()=>document.fonts.status==='loaded'&&[...document.images].filter(image=>image.checkVisibility({checkOpacity:true})).every(image=>image.complete&&image.naturalWidth>0),undefined,{timeout:15000});
 await page.screenshot({path:path.join(out,name+'.png'),fullPage:false,animations:'disabled',caret:'hide',timeout:15000});
 console.log(JSON.stringify({stage:'screenshot',name}));
}
async function readImage(image){return image.evaluate(async element=>{await element.decode();const response=await fetch(element.currentSrc);const bytes=new Uint8Array(await response.arrayBuffer());const canvas=document.createElement('canvas');canvas.width=element.naturalWidth;canvas.height=element.naturalHeight;const context=canvas.getContext('2d');if(!context)throw new Error('Missing native canvas context');context.drawImage(element,0,0);return{base64:btoa(String.fromCharCode(...bytes)),width:canvas.width,height:canvas.height,center:[...context.getImageData(16,16,1,1).data],corner:[...context.getImageData(2,2,1,1).data]};});}
try{
 server=await startBuiltControlUiE2eServer(path.join(root,'dist/control-ui'));
 receipt.domain=server.baseUrl;
 browser=await chromium.launch({headless:true,executablePath:resolvePlaywrightChromiumExecutablePath(chromium.executablePath()),args:['--disable-partial-raster','--disable-gpu-rasterization']});
 receipt.browser={engine:'Chromium',version:browser.version()};
 for(const surface of ['main','side']){
  const scene={surface,requests:[]};receipt.scenes.push(scene);save();
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US',serviceWorkers:'block'});
  try{
   const page=await context.newPage();page.setDefaultTimeout(15000);
   page.on('pageerror',error=>receipt.errors.push(error.message));
   page.on('response',response=>{const pathname=new URL(response.url()).pathname;const asset=assets.find(a=>pathname.endsWith('/'+a.path));if(asset)pending.push(response.body().then(bytes=>{assert.equal(sha(bytes),asset.sha256);receipt.served.push({path:pathname,status:response.status(),sha256:sha(bytes)});}));});
   await page.addInitScript(({key})=>localStorage.setItem(key,JSON.stringify({chatSendShortcut:'enter'})),{key:controlUiBundledSettingsStorageKey(server.baseUrl)});
   const gateway=await installMockGateway(page,{communityInvite:false,terminalEnabled:false,serverVersion:receipt.build.version,serverCommit:receipt.build.commit,serverBuiltAt:receipt.build.builtAt,serverBuildId:receipt.build.buildId,methodResponses:{'sessions.companion.ask':{answer:'Synthetic proof accepted.',ts:1},'sessions.companion.state':{exchanges:[]}}});
   await page.goto(server.baseUrl+'chat');await waitForControlUiGatewayReady(page);
   assert.deepEqual(await page.evaluate(()=>globalThis.OPENCLAW_CONTROL_UI_BUILD_INFO),receipt.build);
   let scope=page.locator('.agent-chat__composer-shell').filter({visible:true}).first();
   if(surface==='side'){
    const pane=page.locator('.chat-pane-cache__pane--active, .chat-split-view__cell--active openclaw-chat-pane.chat-split-view__pane').filter({visible:true}).first();
    await pane.locator('.sidebar-region__panels-toggle').getByRole('button',{name:'Panels',exact:true}).click();
    const launcher=pane.locator('.side-panel-launcher');await launcher.waitFor({state:'visible'});
    await launcher.getByRole('button').filter({has:page.getByText('Side chat',{exact:true}).and(page.locator('.side-panel-type-option__label'))}).click();
    scope=page.locator('openclaw-chat-session-rail');
   }
   const originals=await page.evaluate(()=>['orange','blue'].map(color=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const context=canvas.getContext('2d');if(!context)throw new Error('Missing native context');context.fillStyle=color;context.fillRect(0,0,32,32);return canvas.toDataURL('image/png').split(',')[1];}));
   await scope.locator('.agent-chat__photo-input').setInputFiles(originals.map((content,i)=>({name:i?'keep.png':'private.png',mimeType:'image/png',buffer:Buffer.from(content,'base64')})));
   const preview=scope.getByRole('button',{name:'Open image private.png',exact:true});await preview.waitFor();
   const tile=preview.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " chat-attachment-thumb ")][1]');
   const redact=tile.getByRole('button',{name:'Redact image',exact:true});
   const sibling=scope.getByRole('button',{name:'Open image keep.png',exact:true}).locator('img');
   const before=await readImage(preview.locator('img'));const siblingBefore=await readImage(sibling);
   scene.original={sha256:sha(Buffer.from(before.base64,'base64')),width:before.width,height:before.height,center:before.center,corner:before.corner};
   fs.writeFileSync(path.join(out,surface+'-original.png'),Buffer.from(before.base64,'base64'));
   function readGeometry(element){const preview=element.querySelector('.chat-attachment-image-button'),redact=element.querySelector('.chat-attachment-redact'),remove=element.querySelector('.chat-attachment-remove');if(!preview||!redact||!remove)throw new Error('Missing shipped attachment control');const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};const p=preview.getBoundingClientRect();const hit=document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)?.closest('button');return{preview:rect(preview),redact:rect(redact),remove:rect(remove),centerTarget:hit?.getAttribute('aria-label')};}
   scene.geometry=await tile.evaluate(readGeometry);
   assert.equal(scene.geometry.centerTarget,'Open image private.png');
   assert.equal(scene.geometry.redact.width,24);assert.equal(scene.geometry.redact.height,24);
   const a=scene.geometry.redact,b=scene.geometry.remove;assert.ok(a.y>=b.y+b.height||b.y>=a.y+a.height||a.x>=b.x+b.width||b.x>=a.x+a.width,'Native action boxes must not overlap');
   await screenshot(page,surface+'-head-before-edit');
   await preview.click();const lightbox=page.getByRole('dialog',{name:'Image preview: private.png',exact:true});await lightbox.waitFor();await page.keyboard.press('Escape');await lightbox.waitFor({state:'detached'});
   scene.nativePreview='PASS: default-center ordinary click opens existing lightbox, Escape closes';console.log(JSON.stringify({stage:'preview',surface}));
   const oldDir=await page.evaluate(()=>document.documentElement.getAttribute('dir'));
   await page.evaluate(()=>document.documentElement.setAttribute('dir','rtl'));
   scene.rtlGeometry=await tile.evaluate(readGeometry);
   assert.equal(scene.rtlGeometry.centerTarget,'Open image private.png');
   assert.equal(scene.rtlGeometry.redact.width,24);assert.equal(scene.rtlGeometry.redact.height,24);
   assert.equal(scene.geometry.redact.x-scene.geometry.preview.x,scene.geometry.preview.width-24,'LTR logical end is the preview right edge');
   assert.equal(scene.rtlGeometry.redact.x-scene.rtlGeometry.preview.x,0,'RTL logical end is the preview left edge');
   await screenshot(page,surface+'-head-rtl');
   await preview.click();await lightbox.waitFor();await page.keyboard.press('Escape');await lightbox.waitFor({state:'detached'});
   await page.evaluate(value=>{if(value===null)document.documentElement.removeAttribute('dir');else document.documentElement.setAttribute('dir',value);},oldDir);
   scene.rtlControl='PASS: actual built DOM root direction changed only for geometry/native preview; locale and Gateway config untouched';
   await redact.focus();await page.keyboard.press('Enter');const editor=page.getByRole('dialog',{name:'Redact image',exact:true});await editor.waitFor();
   const canvas=editor.locator('canvas');const box=await canvas.boundingBox();assert.ok(box&&box.width>0&&box.height>0);
   async function cover(){await page.mouse.move(box.x+box.width*.25,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.75);await page.mouse.up();await editor.getByText('Covered areas: 1',{exact:true}).waitFor();}
   await cover();await editor.getByRole('button',{name:'Undo last area',exact:true}).click();await editor.getByText('Covered areas: 0',{exact:true}).waitFor();assert.equal(await editor.getByRole('button',{name:'Apply redaction',exact:true}).isEnabled(),false);scene.undoControl='PASS: Undo retains editor, clears area, disables empty Apply';
   await cover();await screenshot(page,surface+'-covered');await editor.getByRole('button',{name:'Apply redaction',exact:true}).click();await editor.waitFor({state:'detached'});
   const replacement=scope.getByRole('button',{name:'Open image private-redacted.png',exact:true});await replacement.waitFor();const actual=await readImage(replacement.locator('img'));assert.deepEqual(actual.center,[0,0,0,255]);assert.deepEqual(actual.corner,[255,165,0,255]);assert.equal(actual.width,32);assert.equal(actual.height,32);assert.notEqual(actual.base64,before.base64);assert.equal((await readImage(sibling)).base64,siblingBefore.base64);
   fs.writeFileSync(path.join(out,surface+'-redacted.png'),Buffer.from(actual.base64,'base64'));
   scene.readback={sha256:sha(Buffer.from(actual.base64,'base64')),center:actual.center,corner:actual.corner,dimensions:[actual.width,actual.height],siblingUnchanged:true};
   await replacement.click();const afterPreview=page.getByRole('dialog',{name:'Image preview: private-redacted.png',exact:true});await afterPreview.waitFor();await page.keyboard.press('Escape');await afterPreview.waitFor({state:'detached'});scene.replacementNativePreview='PASS';
   await screenshot(page,surface+'-head-after-apply');
   const composer=surface==='side'?scope.getByRole('textbox',{name:'Ask in side chat',exact:true}):scope.locator('textarea');
   await composer.fill('Inspect this synthetic redaction proof.');await composer.press('Enter');
   const method=surface==='side'?'sessions.companion.ask':'chat.send';const sent=await gateway.waitForRequest(method);
   const attachments=sent.params.attachments;assert.ok(Array.isArray(attachments));assert.equal(attachments.length,2);const redacted=attachments.find(a=>a.fileName==='private-redacted.png'),retained=attachments.find(a=>a.fileName==='keep.png');assert.ok(redacted&&retained);assert.equal(redacted.mimeType,'image/png');assert.equal(redacted.content,actual.base64);assert.equal(retained.content,siblingBefore.base64);
   console.log(JSON.stringify({stage:'request-readback',surface,method}));scene.requests=[{method,attachments:attachments.map(a=>({fileName:a.fileName,mimeType:a.mimeType,sha256:sha(Buffer.from(a.content,'base64'))}))}];scene.result='PASS';save();
  }finally{await context.close();}
 }
 await Promise.all(pending);assert.ok(receipt.served.length>0);assert.deepEqual(receipt.errors,[]);receipt.result='PASS';
}catch(error){receipt.result='BLOCKED';receipt.error=String(error);throw error;}
finally{await browser?.close();await server?.close();receipt.cleanup={contextsClosed:true,serverClosed:true,productionTouched:false,externalMessages:false};save();console.log(JSON.stringify({result:receipt.result,head:receipt.head,output:out,scenes:receipt.scenes.map(s=>({surface:s.surface,result:s.result}))}));}
