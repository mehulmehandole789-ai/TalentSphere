'use strict';
const crypto=require('node:crypto');
function canonical(v){if(v===undefined)return 'null';if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
const digest=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
class Audit {
 constructor(db){this.db=db;}
 append(ctx,action,entity,id,oldValue,newValue){if(!this.db.inTransaction)throw new Error('Audit requires a state transaction');const previous=this.db.prepare('SELECT sequence,hash FROM Activity_Log ORDER BY sequence DESC LIMIT 1').get();const row={sequence:(previous?.sequence||0)+1,User_ID:ctx?.userId||null,Timestamp:new Date().toISOString(),Action_Type:action,entity,entity_id:String(id),correlation_id:ctx?.requestId||crypto.randomUUID(),Old_Value:canonical(oldValue),New_Value:canonical(newValue),previous_hash:previous?.hash||'GENESIS'};const hash=digest(row);this.db.prepare('INSERT INTO Activity_Log VALUES(@sequence,@User_ID,@Timestamp,@Action_Type,@entity,@entity_id,@correlation_id,@Old_Value,@New_Value,@previous_hash,@hash)').run({...row,hash});return row.sequence;}
 verify(){let previous='GENESIS',sequence=0;for(const row of this.db.prepare('SELECT * FROM Activity_Log ORDER BY sequence').iterate()){const {hash,...payload}=row;if(row.sequence!==++sequence||row.previous_hash!==previous||digest(payload)!==hash)return {valid:false,sequence};previous=hash;}return {valid:true,entries:sequence,head:previous};}
}
module.exports={Audit,canonical,digest};
