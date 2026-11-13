import fs from 'node:fs';
import path from 'node:path';
const [checkout,configPath,lane]=process.argv.slice(2);
if(lane!=='skills')throw Error('Unknown proof lane');
const config=JSON.parse(fs.readFileSync(configPath!,'utf8'));
const dir=path.join(config.agents.defaults.workspace,'skills','proof-skill');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'SKILL.md'),'---\nname: proof-skill\ndescription: Synthetic local report skill\n---\nReturn a read-only synthetic marker.\n');
console.log(JSON.stringify({lane,skill:'proof-skill',artifact:'workspace/skills/proof-skill/SKILL.md'}));
