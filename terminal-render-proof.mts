import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const task=path.dirname(process.argv[1]);
const repo=path.resolve(process.argv[2] ?? path.join(task,'terminal-find'));
const beforeHead=process.argv[3] ?? 'f7b0ceafae9e8d47dbae306a378bf57a16d10dd4';
const require=createRequire(path.join(repo,'package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const {chromium}=require('playwright');
const {createUiBrowserVitestConfig}=await import(pathToFileURL(path.join(repo,'ui/vitest.config.ts')).href);
const {resolvePlaywrightChromiumExecutablePath}=await import(pathToFileURL(path.join(repo,'ui/src/test-helpers/playwright-chromium.ts')).href);
const {createControlUiE2eArtifactDir}=await import(pathToFileURL(path.join(repo,'ui/src/test-helpers/control-ui-e2e-artifacts.ts')).href);
const output=createControlUiE2eArtifactDir('terminal-fractional',task);
const digest=(data)=>createHash('sha256').update(data).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:repo});
const sourcePaths=['ui/src/components/terminal/terminal-find.tsx','ui/src/components/terminal/terminal-panel.css','ui/src/components/terminal/terminal-find.ts','ui/src/components/terminal/terminal-runtime.ts'];
const head=git('rev-parse','HEAD').toString().trim();
const records=[];
const browser=await chromium.launch({headless:true,executablePath:resolvePlaywrightChromiumExecutablePath(chromium.executablePath()),args:['--disable-partial-raster','--disable-gpu-rasterization']});
const harness=String.raw`
import {render} from '@solidjs/web';
import {flush} from 'solid-js';
import '/src/styles/base.css';
import '/src/components/terminal/terminal-panel.css';
import {TerminalFind} from '/src/components/terminal/terminal-find.tsx';
import {createIsolatedGhosttyTerminal} from '/src/components/terminal/terminal-runtime.ts';
const host=document.body.appendChild(document.createElement('div'));
host.style.cssText='width:500px;height:100px';
const sent=[];
const controller=await createIsolatedGhosttyTerminal({parent:host,autoFit:false,readOnly:false,size:{columns:120,rows:4},onData:data=>sent.push(new TextDecoder().decode(data))});
const panel=document.body.appendChild(document.createElement('openclaw-terminal-panel'));
panel.style.cssText='display:block;position:relative;width:500px;height:160px';
const dispose=render(()=> <TerminalFind tab={{controller}} />,panel);
controller.write(new TextEncoder().encode('x'.repeat(90)+' needle\r\nneedle near start'));
window.proof={controller,sent,panel,flush,dispose:()=>{dispose();controller.dispose();host.remove();panel.remove();}};
`;
try{
 for(const stage of ['before','after']){
  const config=createUiBrowserVitestConfig();
  const virtual=path.join(repo,'ui/src/__task_terminal_capture.tsx');
  const sourceStatus=git('status','--porcelain').toString();
  const sources={};for(const file of sourcePaths)sources[file]=stage==='before'?git('show',beforeHead+':'+file).toString():await fs.readFile(path.join(repo,file),'utf8');
  const plugin={name:'task-owned-source-proof',enforce:'pre',resolveId(id){if(id==='/__task_terminal_capture.tsx')return virtual;},load(id){if(id===virtual)return harness;for(const file of sourcePaths.slice(0,2))if(id.split('?')[0]===path.join(repo,file))return sources[file];},configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url!=='/proof')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><script type="module" src="/__task_terminal_capture.tsx"></script></body></html>');});}};
  const server=await createServer({...config,configFile:false,mode:'test',plugins:[plugin,...config.plugins],optimizeDeps:{include:['solid-js','@solidjs/web','@solidjs/signals']},server:{host:'127.0.0.1',port:0,fs:{allow:[repo,task]}}});
  const context=await browser.newContext({viewport:{width:760,height:340},deviceScaleFactor:2});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  try{
   await server.listen();const address=server.httpServer.address();await page.goto('http://127.0.0.1:'+address.port+'/proof');await page.waitForFunction(()=>window.proof!==undefined);
   await page.getByRole('button',{name:'Find in terminal',exact:true}).click();
   await page.getByRole('searchbox').fill('needle');await page.getByRole('status').filter({hasText:'1 of 2'}).waitFor();
   await page.evaluate(()=>{document.querySelector('.tp-find__preview').style.fontSize='12.1px';window.proof.panel.style.width='320.25px';});
   const bounds=()=>page.evaluate(()=>{const p=document.querySelector('.tp-find__preview'),m=p.querySelector('mark');return {preview:p.getBoundingClientRect().toJSON(),mark:m.getBoundingClientRect().toJSON(),scrollLeft:p.scrollLeft,scrollWidth:p.scrollWidth,clientWidth:p.clientWidth,font:getComputedStyle(p).font,fontSize:getComputedStyle(p).fontSize,paddingInlineEnd:getComputedStyle(p).paddingInlineEnd,text:m.textContent,sent:window.proof.sent};});
   let previous='';for(let n=0;n<20;n++){await page.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));const current=JSON.stringify(await bounds());if(current===previous)break;previous=current;}
   const late=await bounds();const png=await page.screenshot({path:path.join(output,stage+'-late.png'),animations:'disabled',fullPage:false,scale:'device'});const same=await bounds();if(JSON.stringify(late)!==JSON.stringify(same))throw Error('Capture changed measured bounds');
   await page.getByRole('button',{name:'Next match',exact:true}).click();await page.getByRole('status').filter({hasText:'2 of 2'}).waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const start=await bounds();
   await page.screenshot({path:path.join(output,stage+'-start.png'),animations:'disabled',fullPage:false,scale:'device'});
   await page.evaluate(()=>window.proof.dispose());
   if(git('status','--porcelain').toString()!==sourceStatus)throw Error('Product source changed during capture');
   records.push({stage,head,sourceCommit:stage==='before'?beforeHead:null,sourceSHA256:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,digest(v)])),late,start,latePngSHA256:digest(png),errors,lateVisible:late.mark.left>=late.preview.left&&late.mark.right<=late.preview.right,startVisible:start.mark.left>=start.preview.left&&start.mark.right<=start.preview.right});
  }finally{await context.close();await server.close();}
 }
 const pass=records.length===2&&!records[0].lateVisible&&records[1].lateVisible&&records.every(r=>r.startVisible&&r.late.sent.length===0&&r.start.sent.length===0&&r.errors.length===0);
 const receipt={pass,head,beforeHead,collectorSHA256:digest(await fs.readFile(process.argv[1])),scope:'Actual production TerminalFind source compiled by canonical Solid/Vite config with actual isolated Ghostty WASM emulator in Chromium. BEFORE reads explicitly pinned pre-repair Git source for the two changed production files; AFTER reads current working source. This is a component rendering seam, not a normal full UI build, live Gateway, PTY, provider, or WebKit proof.',output,records};
 await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));if(!pass)process.exitCode=1;
}finally{await browser.close();}
