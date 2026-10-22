require('dotenv').config({path:require('path').join(__dirname,'../../.env')});
const db=require('../db'),{reconcile}=require('./service'),{configuration}=require('./provider');
(async()=>{
 if(!configuration().enabled)throw new Error('Configure Razorpay keys and webhook secret before reconciliation.');
 const rows=db.prepare(`SELECT bookingId FROM payment_orders WHERE mode=? ORDER BY COALESCE(reconciledAt,createdAt) ASC LIMIT 100`).all(configuration().mode);
 let failures=0;
 for(const row of rows){try{await reconcile({locals:{}},row.bookingId);console.log('Reconciled '+row.bookingId);}catch(err){failures++;console.error('Reconciliation incomplete for '+row.bookingId+'. Check original mode/keys, provider availability and admin payment overview.');}}
 console.log(`Checked ${rows.length} saved orders; ${failures} require follow-up. No charges were initiated.`);
 if(failures)process.exitCode=1;
})().catch(()=>{console.error('Payment reconciliation unavailable. Check Razorpay configuration and database access.');process.exitCode=1;}).finally(()=>db.close());
