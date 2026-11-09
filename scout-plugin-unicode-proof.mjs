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
const load=name=>import(pathToFileURL(path.join(checkout,name)));
fs.mkdirSync(output,{recursive:true});
assert.equal(git('rev-parse','HEAD'),expected);
assert.equal(git('status','--porcelain','--untracked-files=no'),'');
const index=fs.readFileSync(path.join(checkout,'dist/control-ui/index.html'));
const build=JSON.parse(index.toString().match(/globalThis\.OPENCLAW_CONTROL_UI_BUILD_INFO=(\{[^<]+\});<\/script>/)[1]);
assert.equal(build.commit,expected);assert.equal(build.dirty,false);
const {startBuiltControlUiE2eServer,installMockGateway}=await load('ui/src/test-helpers/control-ui-e2e.ts');
const {defaultControlUiFeatureMethods}=await load('ui/src/test-helpers/control-ui-e2e-defaults.ts');
const {createPluginDeclaredSurface}=await load('ui/src/test-helpers/plugins-e2e-fixtures.test-support.ts');
const {normalizeConfigGroups}=await load('src/plugins/manifest-config-groups.ts');
const {ConfigSchemaResponseSchema}=await load('packages/gateway-protocol/src/schema/config.ts');
const require=createRequire(path.join(checkout,'package.json'));
const {Value}=require('typebox/value');
const {chromium}=require('playwright');
const files=['ui/src/pages/plugins/settings-editor.tsx','ui/src/pages/plugins/settings-view.tsx','ui/src/components/config-form.search.ts','src/plugins/manifest-config-groups.ts'];
const sourceHashes=Object.fromEntries(files.map(name=>[name,hash(fs.readFileSync(path.join(checkout,name)))]));
const receipt={startedAt:new Date().toISOString(),head:expected,build,indexSha256:hash(index),collectorSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),sourceHashes,status:'SETUP',scenes:[],errors:[],limitations:['Normally built production UI and native Linux Chromium. The official synthetic Gateway supplies schema-valid authored plugin metadata and records reads/writes. This does not prove real plugin installation, a live Gateway, provider runtime, model calls, or other operating systems.','Source metadata is passed through the canonical authored-group normalizer and validated with the public config.schema response schema. Product filtering and DOM rendering are not mocked.']};
let browser,server,page;
const save=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
const object=properties=>({type:'object',additionalProperties:false,properties});
async function scene(form,locale='en-US'){
  const sceneName=form+'-'+locale;
  const groupTitle='Café section'.normalize(form), parentTitle='Résumé parent'.normalize(form), leafTitle='Détail'.normalize(form);
  const plugin={id:'unicode-settings-proof',name:'Unicode Settings Proof',packageName:'unicode-settings-proof',description:'Synthetic authored settings metadata for a local UI search acceptance check.',version:'1.0.0',kind:['plugin'],origin:'workspace',installed:true,enabled:false,state:'disabled',category:'tool',removable:true};
  const configSchema=object({enabled:{type:'boolean',title:'Enabled'},storage:{...object({path:{type:'string',title:'Directory'}}),title:parentTitle},detail:{type:'string',title:leafTitle}});
  const groupRaw=[{id:'general',title:groupTitle,properties:['enabled']}];
  const groups=normalizeConfigGroups(groupRaw,configSchema);assert.deepEqual(groups,groupRaw);
  const entrySchema=object({enabled:{type:'boolean'},config:configSchema,hooks:object({allowConversationAccess:{type:'boolean',title:'Allow conversation access'}})});
  const config={plugins:{entries:{[plugin.id]:{enabled:false,config:{enabled:true,storage:{path:'retained/path'},detail:'unchanged'},hooks:{allowConversationAccess:false}}}}};
  const schema={schema:object({plugins:object({entries:object({[plugin.id]:entrySchema})})}),uiHints:{['plugins.entries.'+plugin.id+'.config']:{groups}},version:'synthetic-ui-acceptance',generatedAt:'2026-11-09T00:00:00.000Z'};
  assert.ok(Value.Check(ConfigSchemaResponseSchema,schema),'Synthetic config.schema must satisfy the actual public response schema');
  const sourceJson=JSON.stringify({config,schema});
  const context=await browser.newContext({viewport:{width:1280,height:950},locale,serviceWorkers:'block'});
  if(locale==='de')await context.addInitScript(()=>localStorage.setItem('openclaw.i18n.locale','de'));
  const p=await context.newPage();page=p;p.setDefaultTimeout(12000);p.on('pageerror',e=>receipt.errors.push({scene:form,error:String(e)}));
  const inspection={ok:true,reviewToken:'a'.repeat(64),plugin:{id:plugin.id,name:plugin.name,origin:plugin.origin,installed:true,enabled:false},source:{kind:'path',path:'/tmp/synthetic-unicode-plugin'},declared:createPluginDeclaredSurface(),components:{mapped:[],skills:[],mcpServers:[],commands:[],hooks:[],lspServers:[],unavailable:{capabilities:[],mcpServers:[],lspServers:[]}},grants:{hooks:{allowPromptInjection:{effective:false},allowConversationAccess:{effective:false}}}};
  const gateway=await installMockGateway(p,{serverVersion:build.version,serverCommit:build.commit,serverBuiltAt:build.builtAt,serverBuildId:build.buildId,operatorScopes:['operator.read','operator.write','operator.admin'],featureMethods:[...defaultControlUiFeatureMethods,'plugins.list','plugins.inspect','plugins.controlUi.list','plugins.catalog.get'],methodResponses:{'plugins.list':{plugins:[plugin],diagnostics:[],mutationAllowed:true,generation:0},'plugins.inspect':inspection,'plugins.controlUi.list':{revision:'empty',plugins:[],diagnostics:[]},'config.get':{config,hash:'synthetic-config-'+form,issues:[],path:'/tmp/synthetic-unicode-plugin/openclaw.json',raw:JSON.stringify(config,null,2),resolved:config,sourceConfig:config,valid:true},'config.schema':schema}});
  const result={form,locale,metadata:{groupTitle,parentTitle,leafTitle,groupCodePoints:[...groupTitle].map(c=>c.codePointAt(0)),parentCodePoints:[...parentTitle].map(c=>c.codePointAt(0))},sourceJsonSha256:hash(sourceJson),cases:[]};receipt.scenes.push(result);
  await p.goto(server.baseUrl+'settings/plugins/'+plugin.id+'?view=settings');
  const editor=p.locator('openclaw-plugin-settings-editor');await editor.waitFor({state:'visible'});
  const input=editor.locator('input[type="search"]');await input.waitFor({state:'visible'});
  await editor.locator('[data-setting="storage.path"]').waitFor({state:'visible'});
  result.initial=await editor.locator('[data-setting]').evaluateAll(rows=>rows.map(row=>({setting:row.getAttribute('data-setting'),label:row.querySelector('.plugin-editor__title')?.textContent})));assert.equal(result.initial.length,4);
  assert.ok(result.initial.some(row=>row.label===parentTitle+': Directory'));
  assert.equal(await editor.locator('.plugin-editor__section h2').first().textContent(),groupTitle);
  await p.screenshot({path:path.join(output,sceneName+'-initial.png'),fullPage:true});
  const opposite=form==='NFD'?'NFC':'NFD';
  const cases=[
    {name:'group-same-form-control',query:groupTitle,expected:['enabled']},
    {name:'group-canonical-mismatch',query:'Café section'.normalize(opposite),expected:['enabled'],gap:true},
    {name:'ancestor-same-form-control',query:parentTitle,expected:['storage.path']},
    {name:'ancestor-canonical-mismatch',query:'Résumé parent'.normalize(opposite),expected:['storage.path'],gap:true},
    {name:'leaf-already-canonical-control',query:'Détail'.normalize(opposite),expected:['detail']},
    {name:'ascii-control',query:'  ENABLED  ',expected:['enabled']},
    {name:'permission-section-control',query:await editor.locator('.plugin-editor__section h2').last().textContent(),expected:['hooks.allowConversationAccess']},
    {name:'different-accent-control',query:'Cafè section',expected:[]},
    {name:'compatibility-only-control',query:'Ｃａｆé section',expected:[]},
  ];
  if(locale==='de'){
    const label=await editor.locator('[data-setting="hooks.allowConversationAccess"] .plugin-editor__title').textContent();assert.equal(label,'Gesprächskontext lesen');
    cases.push({name:'translated-permission-same-form-control',query:label,expected:['hooks.allowConversationAccess']},{name:'translated-permission-canonical-mismatch',query:label.normalize('NFD'),expected:['hooks.allowConversationAccess'],gap:true});
  }
  for(const check of cases){
    await input.fill(check.query);await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const actual=await editor.locator('[data-setting]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-setting')));
    const got={...check,actual,inputValue:await input.inputValue(),emptyMessage:await editor.locator('.settings-empty').count()?await editor.locator('.settings-empty').textContent():null};result.cases.push(got);
    assert.equal(got.inputValue,check.query,'The typed query must not be rewritten');
    if(!check.gap)assert.deepEqual(actual,check.expected,check.name);
    if(check.gap)await p.screenshot({path:path.join(output,sceneName+'-'+check.name+'.png'),fullPage:true});
  }
  await input.fill('');await editor.locator('[data-setting="storage.path"]').waitFor({state:'visible'});
  result.final=await editor.locator('[data-setting]').evaluateAll(rows=>rows.map(row=>({setting:row.getAttribute('data-setting'),label:row.querySelector('.plugin-editor__title')?.textContent})));
  assert.deepEqual(result.final,result.initial,'Searching must preserve original labels and identities');
  assert.equal(JSON.stringify({config,schema}),sourceJson);
  result.writeCounts={};for(const method of ['config.set','config.patch','config.apply','plugins.install','plugins.setEnabled','plugins.uninstall']){result.writeCounts[method]=(await gateway.getRequests(method)).length;assert.equal(result.writeCounts[method],0);}
  result.schemaReads=await gateway.getRequests('config.schema');assert.ok(result.schemaReads.length>0);
  result.status=result.cases.filter(c=>c.gap).every(c=>JSON.stringify(c.actual)===JSON.stringify(c.expected))?'GREEN':result.cases.filter(c=>c.gap).every(c=>c.actual.length===0)?'RED_CANONICAL_METADATA_HIDDEN':'UNEXPECTED';
  await context.close();page=undefined;save();
}
try{
  server=await startBuiltControlUiE2eServer(path.join(checkout,'dist/control-ui'));receipt.baseUrl=server.baseUrl;
  const served=Buffer.from(await(await fetch(server.baseUrl)).arrayBuffer());assert.equal(hash(served),receipt.indexSha256);
  const entry=index.toString().match(/<script[^>]+src="([^"]+)"/)[1];const body=Buffer.from(await(await fetch(new URL(entry,server.baseUrl))).arrayBuffer());assert.equal(hash(body),hash(fs.readFileSync(path.join(checkout,'dist/control-ui',entry))));receipt.served={indexSha256:hash(served),entryPath:entry,entrySha256:hash(body)};
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  await scene('NFD');await scene('NFC');await scene('NFC','de');
  assert.deepEqual(Object.fromEntries(files.map(name=>[name,hash(fs.readFileSync(path.join(checkout,name)))])),sourceHashes);assert.equal(git('rev-parse','HEAD'),expected);
  receipt.status=receipt.scenes.every(s=>s.status==='RED_CANONICAL_METADATA_HIDDEN')?'RED_CANONICAL_METADATA_HIDDEN':receipt.scenes.every(s=>s.status==='GREEN')?'GREEN':'UNEXPECTED';
}catch(error){receipt.status='BLOCKED';receipt.error=String(error);if(page){receipt.failureDom=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}}
finally{await browser?.close();await server?.close();receipt.finishedAt=new Date().toISOString();receipt.cleanup='Closed all owned Chromium contexts and the owned built-UI server. No real files, plugins, providers, channels, model or Gateway changed; no config/plugin write RPCs admitted.';save();}
console.log(JSON.stringify({status:receipt.status,head:expected,output,error:receipt.error,scenes:receipt.scenes.map(s=>({form:s.form,locale:s.locale,status:s.status,cases:s.cases.map(c=>({name:c.name,actual:c.actual,expected:c.expected}))}))}));process.exitCode=receipt.status==='BLOCKED'||receipt.status==='UNEXPECTED'?2:0;
