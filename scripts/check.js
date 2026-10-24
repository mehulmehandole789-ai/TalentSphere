const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function check(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())check(p);else if(p.endsWith('.js')){const result=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);}}}
check(path.join(root,'frontend'));check(path.join(root,'backend/src'));check(path.join(root,'backend/test'));
const html=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8');for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
console.log('Backend and frontend JavaScript syntax passed. Frontend is served directly: no bundling required.');
