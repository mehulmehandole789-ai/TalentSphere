const {db}=require('./common');
const {deliver}=require('../auth/email');
let running=false;
async function flush(app){
 if(running)return;running=true;
 try{const rows=db.prepare("SELECT o.*,u.email FROM notification_outbox o JOIN users u ON u.id=o.userId WHERE o.status='pending' AND o.nextAttemptAt<=? ORDER BY o.id LIMIT 10").all(Date.now());
 for(const row of rows){try{const result=await deliver(app,{to:row.email,from:process.env.SMTP_FROM,subject:'TalentSphere booking update',text:'TalentSphere\n\n'+row.text+'\n\nOpen your TalentSphere booking workspace for details.'});db.prepare("UPDATE notification_outbox SET status=?,attempts=attempts+1,lastError=NULL WHERE id=?").run(result==='development_preview'?'preview':'sent',row.id);}catch{db.prepare("UPDATE notification_outbox SET attempts=attempts+1,nextAttemptAt=?,lastError=? WHERE id=?").run(Date.now()+Math.min(86400000,60000*2**Math.min(row.attempts,10)),'Email could not be delivered; in-app notification remains available.',row.id);}}
 }finally{running=false;}
}
function start(app){const tick=()=>{require('./common').expire();flush(app).catch(()=>{});};const timer=setInterval(tick,30000);timer.unref();return()=>clearInterval(timer);}
module.exports={flush,start};
