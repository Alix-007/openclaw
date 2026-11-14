import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fixture} from './proof-cli-common.mjs';
const f = fixture('model-files', ...process.argv.slice(2));
const checkout = path.resolve(process.argv[2]);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yf7kAAAAASUVORK5CYII=', 'base64');
const requests = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', x => chunks.push(x));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks));
    const content = body.messages.find(m => m.role === 'user').content;
    requests.push({method: req.method, path: req.url, model: body.model, content});
    res.writeHead(200, {'content-type': 'text/event-stream'});
    res.end([{id:'synthetic', choices:[{index:0,delta:{role:'assistant',content:'image proof reply'},finish_reason:null}]}, {id:'synthetic',choices:[{index:0,delta:{},finish_reason:'stop'}]}].map(x=>`data: ${JSON.stringify(x)}\n\n`).join('')+'data: [DONE]\n\n');
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
f.config.agents.defaults.model = {primary: 'image-proof/image-proof'};
f.config.models = {mode:'replace', providers:{'image-proof':{api:'openai-completions', baseUrl:`http://127.0.0.1:${server.address().port}/v1`, apiKey:'synthetic-loopback-key', models:[{id:'image-proof',name:'Image proof',reasoning:false,input:['text','image'],contextWindow:128000,maxTokens:1024}]}}};
f.writeConfig();
const env = {PATH:`${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME:path.join(f.root,'home'), TMPDIR:path.join(f.root,'tmp'), LANG:'C.UTF-8', TZ:'UTC', CI:'1', OPENCLAW_CONFIG_PATH:f.configPath, OPENCLAW_STATE_DIR:path.join(f.root,'state'), OPENCLAW_NO_RESPAWN:'1', OPENCLAW_DISABLE_BONJOUR:'1', OPENCLAW_DISABLE_BUNDLED_PLUGINS:'1'};
async function run(label, file, fifo = false) {
  const args = ['infer','model','run','--local','--model','image-proof/image-proof','--prompt','Describe this image','--file',file,'--json'];
  const tracePath = path.join(f.root, `${label}.strace`);
  const child = spawn('/usr/bin/strace', ['-f','-tt','-e','trace=openat','-o',tracePath,process.execPath,path.join(checkout,'openclaw.mjs'),...args], {cwd:path.join(f.root,'workspace'),env,detached:true,stdio:['ignore','pipe','pipe']});
  const out=[], err=[]; child.stdout.on('data',x=>out.push(x)); child.stderr.on('data',x=>err.push(x));
  let blockedAt, releasedAt, workerWait;
  const startedAt = Date.now();
  const timer = setTimeout(()=>process.kill(-child.pid,'SIGKILL'),45000);
  const monitor = fifo ? setInterval(() => {
    if (blockedAt) return;
    try {
      workerWait=fs.readFileSync(tracePath,'utf8').split('\n').find(x=>x.includes('openat(') && x.includes(JSON.stringify(file)) && x.includes('O_RDONLY') && x.includes('<unfinished ...>'));
      if (workerWait) {
        blockedAt=Date.now();
        // A controlled writer releases the observed product wait, allowing clean exit.
        setTimeout(()=>{
          const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_NONBLOCK);
          fs.writeSync(fd,'not an image\n'); fs.closeSync(fd); releasedAt=Date.now();
        },1000);
      }
    } catch {}
  },100) : undefined;
  const terminal=await new Promise((resolve,reject)=>{child.once('error',reject); child.once('close',(code,signal)=>resolve({code,signal}));});
  clearTimeout(timer); clearInterval(monitor);
  assert.equal(terminal.signal,null,'Unobserved fixture/process timeouts are not acceptance RED');
  const row={label,args,...terminal,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8'),elapsedMs:Date.now()-startedAt,blockedAt,releasedAt,workerWait,tracePath,traceSha256:f.hash(fs.readFileSync(tracePath))};
  f.receipt.runs.push(row); console.log(JSON.stringify({label,code:row.code,elapsedMs:row.elapsedMs,workerWait}));
  fs.writeFileSync(path.join(f.root,'receipt.json'),JSON.stringify(f.receipt,null,2));
  return row;
}
try {
  const image=path.join(f.root,'image.png'), link=path.join(f.root,'linked.png'), fifo=path.join(f.root,'input.pipe'), text=path.join(f.root,'input.txt');
  fs.writeFileSync(image,png); fs.symlinkSync(image,link); fs.writeFileSync(text,'not an image\n'); execFileSync('mkfifo',[fifo]);
  for (const [name,file] of [['regular-png',image],['symlink-png',link]]) {
    const before=requests.length; const r=await run(name,file); assert.equal(r.code,0,r.stderr); assert.match(r.stdout,/image proof reply/); assert.equal(requests.length,before+1);
    const attached=requests.at(-1).content.find(p=>p.type==='image_url').image_url.url;
    assert.equal(attached,`data:image/png;base64,${png.toString('base64')}`);
  }
  const before=requests.length; const r=await run('fifo-rejection',fifo,true); assert.equal(r.code,1,r.stderr); assert.equal(requests.length,before);
  // JSON stdout carries the diagnostic; stderr renders the generic failure banner.
  // The acceptance boundary is the traced FIFO open and absence of provider dispatch.
  assert.match(r.stderr,/The CLI command failed/);
  if(f.phase==='red'){assert.match(r.workerWait,/openat\(.+O_RDONLY.+<unfinished/);assert.ok(r.releasedAt-r.blockedAt>=900);assert.match(JSON.parse(r.stdout).error.message,/Only image files are supported/);}
  else {assert.equal(r.blockedAt,undefined);assert.equal(fs.readFileSync(r.tracePath,'utf8').includes(JSON.stringify(fifo)),false);assert.match(JSON.parse(r.stdout).error.message,/regular file.*retry/);}
  const t=await run('text-rejection',text);assert.equal(t.code,1,t.stderr);assert.match(JSON.parse(t.stdout).error.message,/Only image files are supported/);assert.equal(requests.length,before);
  assert.deepEqual(fs.readFileSync(image),png);assert.equal(fs.statSync(fifo).isFIFO(),true);
  f.receipt.requests=requests; f.finish();
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
