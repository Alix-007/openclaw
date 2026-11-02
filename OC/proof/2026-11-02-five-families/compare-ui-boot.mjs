import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const [baseCheckout,baseMetricsFile,headCheckout,headMetricsFile,outputFile]=process.argv.slice(2);
const base=JSON.parse(fs.readFileSync(baseMetricsFile)),head=JSON.parse(fs.readFileSync(headMetricsFile));
const normalize=s=>s.replace(/(?<=-)[A-Za-z0-9_-]{8}(?=\.(?:js|css)(?:\.map)?)/g,'HASH0000');
const assets=d=>new Map(d.metrics.routeBoot.chat.assets.filter(x=>x.type==='js').map(x=>[normalize(x.file),x]));
const before=assets(base),after=assets(head);assert.deepEqual([...before.keys()].sort(),[...after.keys()].sort());
const chunks=[];
for(const key of [...before.keys()].sort()){
 const b=before.get(key),h=after.get(key);const bs=fs.readFileSync(path.join(baseCheckout,'dist/control-ui',b.file),'utf8'),hs=fs.readFileSync(path.join(headCheckout,'dist/control-ui',h.file),'utf8');
 chunks.push({chunk:key,baseRaw:b.rawBytes,headRaw:h.rawBytes,baseGzip:b.gzipBytes,headGzip:h.gzipBytes,sameAfterAssetHashNormalization:normalize(bs)===normalize(hs),baseSha256:createHash('sha256').update(bs).digest('hex'),headSha256:createHash('sha256').update(hs).digest('hex')});
}
const modules=d=>new Map(d.moduleAttribution.chat.modules.map(x=>[x.module,x.rawBytes]));
const bm=modules(base),hm=modules(head);const changedMappedModules=[...new Set([...bm.keys(),...hm.keys()])].sort().filter(m=>bm.get(m)!==hm.get(m)).map(m=>({module:m,baseRaw:bm.get(m),headRaw:hm.get(m)}));
const result={scope:'Local fixed-environment build attribution, not a CI pass or a claim to have normalized CI artifacts',base:base.metrics.routeBoot.chat.js,head:head.metrics.routeBoot.chat.js,chunks,changedMappedModules};fs.writeFileSync(outputFile,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({chunks:chunks.length,changedAfterHashNormalization:chunks.filter(x=>!x.sameAfterAssetHashNormalization).length,changedMappedModules:changedMappedModules.length}));
