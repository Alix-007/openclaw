import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {withIsolatedGateway} from './isolated-gateway.mjs';
const [checkoutArg,outArg,expected]=process.argv.slice(2),checkout=path.resolve(checkoutArg),out=path.resolve(outArg);assert.ok(['base','head'].includes(expected));
const {chromium}=createRequire(path.join(checkout,'ui/package.json'))('playwright');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;assert.ok(executablePath,'Set the installed Playwright Chromium executable path');
await withIsolatedGateway(checkout,out,async({config})=>{config.plugins={slots:{memory:'none'}};},async({config,record,rpc,save})=>{
 let browser,context,page;record.cases=[];record.pageErrors=[];
 record.entry='Normally built Gateway chat.inject -> persisted chat.history -> real served Control UI -> click table Copy -> native Clipboard API readback';
 record.scope='Existing table copy content/TSV cell boundaries; no UI state injection, owner mocks, external model or channel';save();
 try{
  const key='agent:main:table-copy-proof';await rpc('sessions.create',{key,agentId:'main',cwd:config.agents.defaults.workspace,worktree:false});
  const ordinary='| Name | Value |\n| --- | --- |\n| Alpha | One |\n| **Bold** | `code` |';
  const multiline='| Label | Value | Empty |\n| --- | --- | --- |\n| Alpha<br>Beta | One | |\n| Quote "here"<br>next | Comma, kept | |\n| `A\tB` | End | |\n| Quote "only" | Plain | |';
  await rpc('chat.inject',{sessionKey:key,message:'Synthetic table copy proof.\n\n'+ordinary+'\n\n'+multiline});
  record.history=await rpc('chat.history',{sessionKey:key,limit:10});save();
  browser=await chromium.launch({headless:true,executablePath});context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US',permissions:['clipboard-read','clipboard-write']});page=await context.newPage();page.setDefaultTimeout(30000);
  record.browser={engine:'Chromium',version:browser.version()};page.on('pageerror',e=>record.pageErrors.push(String(e).replaceAll(config.gateway.auth.token,'[ephemeral token]')));
  const origin=record.domain.replace('ws:','http:');await page.goto(origin+'/chat/main/table-copy-proof#token='+encodeURIComponent(config.gateway.auth.token));
  const shells=page.locator('.chat-text .markdown-table[data-table-interactions]');await shells.nth(1).waitFor({timeout:60000});
  const entry=await page.locator('script[src]').evaluateAll(xs=>xs.map(x=>x.getAttribute('src')).find(x=>x.includes('/assets/index-'))),asset=await page.request.get(origin+entry);
  record.servedEntry={path:entry,status:asset.status(),sha256:createHash('sha256').update(await asset.body()).digest('hex')};assert.equal(asset.status(),200);
  const clipboard=()=>page.evaluate(()=>navigator.clipboard.readText());
  async function copy(button,label){await page.evaluate(()=>navigator.clipboard.writeText('SYNTHETIC_CLIPBOARD_SENTINEL'));await button.click();await page.waitForFunction(()=>navigator.clipboard.readText().then(s=>s!=='SYNTHETIC_CLIPBOARD_SENTINEL'));const text=await clipboard();record.cases.push({label,clipboard:text});save();return text;}
  const plain='Name\tValue\nAlpha\tOne\nBold\tcode';assert.equal(await copy(shells.nth(0).locator('.markdown-table__copy'),'ordinary-control'),plain);
  const rendered=await shells.nth(1).locator('table').evaluate(table=>({brCount:table.querySelectorAll('br').length,rows:[...table.rows].map(row=>[...row.cells].map(cell=>({text:cell.textContent,visible:cell.innerText})))}));record.rendered=rendered;save();assert.equal(rendered.brCount,2);
  assert.equal(rendered.rows[1][0].visible,'Alpha\nBeta');assert.equal(rendered.rows[3][0].text,'A\tB');
  const want=expected==='base'?'Label\tValue\tEmpty\nAlphaBeta\tOne\t\nQuote "here"next\tComma, kept\t\nA\tB\tEnd\t\nQuote "only"\tPlain\t':'Label\tValue\tEmpty\n"Alpha\nBeta"\tOne\t\n"Quote ""here""\nnext"\tComma, kept\t\n"A\tB"\tEnd\t\n"Quote ""only"""\tPlain\t';
  assert.equal(await copy(shells.nth(1).locator('.markdown-table__copy'),'inline-table'),want);
  await shells.nth(1).locator('tbody td').first().click({button:'right'});
  assert.equal(await copy(page.getByRole('menuitem',{name:'Copy table',exact:true}),'context-menu'),want);
  await shells.nth(1).locator('.markdown-table__expand').click();const dialog=page.locator('openclaw-modal-dialog.markdown-table-modal');await dialog.waitFor();
  await dialog.locator('tbody td').first().click({button:'right'});
  assert.equal(await copy(page.getByRole('menuitem',{name:'Copy table',exact:true}),'expanded-context-menu'),want);
  await dialog.locator('.markdown-table-dialog__close').click();
  record.observation=expected==='base'?'RED: visible Alpha/Beta and quoted multiline text are concatenated in native clipboard; an embedded tab becomes an extra TSV delimiter. Toolbar and inline/expanded context Copy share the defect; ordinary control is correct.':'GREEN: native clipboard preserves linebreaks and quotes/tab cell boundaries for toolbar and inline/expanded context Copy; ordinary formatted-text control remains byte-identical.';record.result='PASS';save();
 }catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''));}throw new Error(String(error).replaceAll(config.gateway.auth.token,'[ephemeral token]'));}
 finally{await context?.close();await browser?.close();}
});
