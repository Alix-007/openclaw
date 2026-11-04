import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {prepare} from './native-cli.mjs';
const [checkout,out,expected]=process.argv.slice(2);assert.ok(['base','head'].includes(expected));
const p=prepare(checkout,out);const {receipt,run,save}=p;
receipt.entry='Normally built public openclaw.mjs templates create/validate CLI; no production imports or mocks';
try{
 for(const [label,flag,errorCode] of [['empty-name','--name','invalid_package_name'],['empty-agent','--agent-id','invalid_agent_id']]){
  const target=path.join(p.out,label),result=await run(['templates','create',target,flag,'','--json'],label);
  const body=JSON.parse(result.stdout);const exists=fs.existsSync(target),files=exists?fs.readdirSync(target).toSorted():[];
  result.readback={body,targetExists:exists,files};save();
  if(expected==='base'){assert.equal(result.exit.code,0);assert.equal(body.ok,true);assert.deepEqual(files,['CLAW.md','package.json']);}
  else{assert.equal(result.exit.code,1);assert.equal(body.ok,false);assert.equal(body.error.code,errorCode);assert.equal(exists,false);}
 }
 for(const [label,flag,value,errorCode] of [['invalid-name','--name','invalid name','invalid_package_name'],['invalid-agent','--agent-id','INVALID','invalid_agent_id']]){
  const target=path.join(p.out,label),result=await run(['templates','create',target,flag,value,'--json'],label),body=JSON.parse(result.stdout);
  result.readback={body,targetExists:fs.existsSync(target)};save();
  assert.equal(result.exit.code,1);assert.equal(body.ok,false);assert.equal(body.error.code,errorCode);assert.equal(result.readback.targetExists,false);
 }
 for(const [label,flags,name,agentId] of [['omitted-defaults',[],'omitted-defaults','omitted-defaults'],['explicit-valid',['--name','proof-package','--agent-id','proof-worker'],'proof-package','proof-worker']]){
  const target=path.join(p.out,label),result=await run(['templates','create',target,...flags,'--json'],label);const body=JSON.parse(result.stdout);
  assert.equal(result.exit.code,0);assert.equal(body.ok,true);
  const packageJson=JSON.parse(fs.readFileSync(path.join(target,'package.json'),'utf8')),manifest=fs.readFileSync(path.join(target,'CLAW.md'),'utf8');
  assert.equal(packageJson.name,name);assert.match(manifest,new RegExp('id: "'+agentId+'"'));
  const validated=await run(['templates','validate',target,'--json'],label+'-validate');const validation=JSON.parse(validated.stdout);assert.equal(validated.exit.code,0);assert.equal(validation.ok,true);assert.equal(validation.manifest.agent.id,agentId);
  result.readback={packageName:packageJson.name,manifest,files:fs.readdirSync(target).toSorted(),validatedAgentId:validation.manifest.agent.id};save();
 }
 receipt.result='PASS';receipt.observation=expected==='base'?'RED: both explicitly empty identity options are silently dropped; create exits0 and writes two default-identity files. Omitted and valid explicit controls create valid projects.':'GREEN: both explicitly empty identity options return their canonical errors with exit1 and zero target files/directories. Omitted defaults and explicit valid identities still create and validate.';
 receipt.cleanup={productionConfigTouched:false,externalServiceOrModelCalls:false,isolatedFixtureOnly:true};save();console.log(JSON.stringify({result:receipt.result,sha:receipt.sha,observation:receipt.observation}));
}catch(error){receipt.result='SETUP_OR_PRODUCT_FAILURE';receipt.error=String(error);save();throw error;}
