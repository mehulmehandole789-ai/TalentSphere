'use strict';
const path=require('node:path'),fs=require('node:fs');
const command=process.argv[2]||'migrate',size=Number(process.argv[3]||1000);
if(command==='stress'){const dir=path.resolve(__dirname,'../../../recruitment-results');fs.mkdirSync(dir,{recursive:true});process.env.DATABASE_PATH=path.join(dir,`synthetic-${size}-${Date.now()}.db`);}
else require('dotenv').config({path:path.join(__dirname,'../../.env'),quiet:true});
const db=require('../db'),{Recruitment}=require('./service');
function synthetic(i){let seed=i+1;function word(){let result='';for(let j=0;j<8;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;result+='abcdefghijklmnopqrstuvwxyz'[seed%26];}return result;}return {name:word()+' '+word(),email:`synthetic-${i}@example.test`,phone:'919'+String(i).padStart(9,'0'),location:['Pune','Mumbai','Delhi','Chennai','Bengaluru'][i%5],Years_Experience:i%12,Notice_Period_Days:(i%5)*15,certifications:['synthetic java','synthetic sql'],external_id:String(i)};}
async function main(){const service=new Recruitment(db);await service.ready;try{
if(command==='migrate'){console.log('Recruitment migrations v1–v3 ready. Existing records preserved.');return;}
if(command==='verify'){const result=service.audit.verify();console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=1;return;}
if(!['demo','stress'].includes(command))throw new Error('Use migrate, verify, demo, or stress [record count]');
if(!Number.isInteger(size)||size<1||size>50000)throw new Error('Record count must be 1–50000');
let user=db.prepare("SELECT * FROM users WHERE role='admin' ORDER BY createdAt LIMIT 1").get();if(command==='stress'){db.prepare("INSERT INTO users(id,email,passwordHash,name,role,emailVerified) VALUES('synthetic-admin','synthetic-admin@example.test','NO_LOGIN','Synthetic stress operator','admin',1)").run();user=db.prepare("SELECT * FROM users WHERE id='synthetic-admin'").get();}if(!user)throw new Error('Create an admin first with npm run create-admin');const ctx={userId:user.id,requestId:'synthetic-'+Date.now()};
let rule=db.prepare("SELECT v.id FROM rule_versions v JOIN recruitment_rules r ON r.id=v.rule_id WHERE r.name='Synthetic demo priority' AND v.active=1").get();if(!rule){rule=service.saveRule({name:'Synthetic demo priority',expression:'(Years_Experience >= 3 AND Mandatory_Certifications_Count >= 2) AND Notice_Period_Days <= 30',priority:100},ctx);service.activate(rule.id,true,ctx);}
const apps=[],start=performance.now();let comparisons=0;for(let i=0;i<size;i++){const result=await service.ingest(synthetic(i),'SYNTHETIC_DEMO',String(i),ctx);comparisons+=result.examined;if(i<1000||command==='demo')apps.push(service.createApplication(result.candidateId,'synthetic-'+i,null,ctx).id);if(i&&i%10000===0)console.error(`Synthetic records processed: ${i}`);}
const identityMs=performance.now()-start;
// An exact-contact, swapped-name duplicate demonstrates review without merging any user accounts.
const first=synthetic(0);await service.ingest({...first,name:first.name.split(' ').reverse().join(' ')},'SYNTHETIC_SECOND_FEED','duplicate-0',ctx);
if(command==='demo'){console.log(`Seeded ${size} labeled synthetic applicants and one duplicate for admin ${user.id}. Open /recruitment.html.`);return;}
for(const applicationId of apps)await service.queue.command({op:'enqueue',applicationId},ctx);
const workers=Number(process.env.RECRUITMENT_WORKERS||4),operations=Number(process.env.RECRUITMENT_WORKLOAD||Math.ceil(size/workers));const result={recordCount:size,synthetic:true,preloadedQueueEntries:apps.length,identity:{elapsedMs:identityMs,recordsPerSecond:size/(identityMs/1000),comparisons,index:service.index.metrics()},...await require('./stress').runStress(service.queue,apps,{workers,operations},ctx),audit:service.audit.verify()};const target=path.resolve(__dirname,`../../../recruitment-results/scale-${size}.json`);fs.writeFileSync(target,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{service.close();db.close();}}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
