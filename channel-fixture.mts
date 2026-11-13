import fs from 'node:fs';
import path from 'node:path';
const [checkout,configPath,lane]=process.argv.slice(2);
if(lane!=='channels')throw Error('Unknown lane');
const cfg=JSON.parse(fs.readFileSync(configPath!,'utf8'));
const dir=path.join(path.dirname(configPath!),'diagnostic-plugin');fs.mkdirSync(dir);
const ids=['report-error','report-normal'];
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'channel-report-proof',version:'1.0.0',openclaw:{extensions:['./index.cjs']}}));
fs.writeFileSync(path.join(dir,'openclaw.plugin.json'),JSON.stringify({id:'channel-report-proof',activation:{onStartup:true},channels:ids,channelConfigs:Object.fromEntries(ids.map(id=>[id,{schema:{type:'object',additionalProperties:false,properties:{enabled:{type:'boolean'}}}}])),configSchema:{type:'object'}}));
const warning='snapshot\x1b[2J failed\nFORGED warning\rrewrite\tcell\u202e';
const message='Issue\x1b[31m text\nFORGED issue';
const fix='fix\x1b]2;FORGED TITLE\x07 here\rrewrite';
fs.writeFileSync(path.join(dir,'index.cjs'),`module.exports={id:'channel-report-proof',register(api){
  for(const id of ${JSON.stringify(ids)})api.registerChannel({plugin:{id,
    meta:{id,label:id,selectionLabel:id,docsPath:'/channels/'+id,blurb:'Synthetic read-only channel status fixture'},
    capabilities:{chatTypes:['direct']},
    config:{listAccountIds:()=>['default'],resolveAccount:()=>({accountId:'default',enabled:true,configured:true}),inspectAccount:()=>({accountId:'default',enabled:true,configured:true}),isEnabled:()=>true,isConfigured:()=>true},
    status:{buildAccountSnapshot:()=>({accountId:'default',enabled:true,configured:true,running:true,connected:true}),
      buildChannelSummary:()=>{if(id==='report-error')throw new Error(${JSON.stringify(warning)});return{configured:true,running:true};},
      collectStatusIssues:()=>id==='report-error'?[{channel:id,accountId:'default',kind:'runtime',message:${JSON.stringify(message)},fix:${JSON.stringify(fix)}}]:[]}
  }});
}};`);
cfg.plugins={allow:['channel-report-proof'],load:{paths:[dir]},slots:{memory:'none'},entries:{'channel-report-proof':{enabled:true}}};cfg.channels=Object.fromEntries(ids.map(id=>[id,{enabled:true}]));fs.writeFileSync(configPath!,JSON.stringify(cfg));
console.log(JSON.stringify({lane,plugin:'channel-report-proof',channels:ids,warning,message,fix,scope:'public plugin status hooks only, no outbound adapter or real channel messages'}));
