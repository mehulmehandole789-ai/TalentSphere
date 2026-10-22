const {test,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'talentsphere-payments-'));
process.env.DATABASE_PATH=path.join(dir,'mock-payments.db');process.env.JWT_SECRET='isolated-mock-payment-test-jwt-secret-48-characters';
process.env.RAZORPAY_MODE='test';process.env.RAZORPAY_KEY_ID='rzp_test_mockOnly';process.env.RAZORPAY_KEY_SECRET='mock-api-secret-not-real';process.env.RAZORPAY_WEBHOOK_SECRET='mock-webhook-secret-not-real';
const app=require('../src/index'),db=require('../src/db'),{createMock}=require('./razorpay-mock');
const mock=createMock();app.locals.razorpay=mock.sdk;
const mockMail=require('./mock-mail').installMockMail(app);
let server,base;const ready=new Promise(resolve=>{server=app.listen(0,'127.0.0.1',()=>{base=`http://127.0.0.1:${server.address().port}/api`;resolve();});});
after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});});
async function req(route,method='GET',body,token){await ready;const res=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
let owner,artist,outsider,admin,artistId,day=1;
async function booking(){const result=await req('/bookings','POST',{artistId,eventName:'Mock payment booking',date:'2099-12-'+String(day++).padStart(2,'0'),duration:'2 hours',location:'Pune'},owner.token);assert.equal(result.status,201);return result.data;}
async function accept(b,amount=125055){const r=await req('/bookings/'+b.id+'/status','PATCH',{status:'Accepted',finalPricePaise:amount},artist.token);assert.equal(r.status,200);return r.data;}
const checkout=(b,order,payment,signature=mock.signature(order.orderId,payment.id))=>req(`/payments/bookings/${b.id}/verify`,'POST',{razorpay_order_id:order.orderId,razorpay_payment_id:payment.id,razorpay_signature:signature},owner.token);
async function hook(event,eventId='evt_'+crypto.randomBytes(6).toString('hex'),signature,raw){await ready;const body=raw||JSON.stringify(event);const sig=signature||crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');const response=await fetch(base+'/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Razorpay-Signature':sig,'X-Razorpay-Event-Id':eventId},body});return {status:response.status,data:await response.json()};}
const eventFor=(p,event='payment.captured')=>({event,payload:{payment:{entity:{id:p.id,order_id:p.order_id}}}});
test('MOCK: fixture identities and backend final quote in integer paise',async()=>{
 for(const [name,role] of [['Owner','organizer'],['Artist','artist'],['Outsider','organizer']]){const r=await req('/auth/register','POST',{name,email:name+'@mock.test',password:'MockPassword123!',role,location:'Pune',category:'Singers'});assert.equal(r.status,201);await req('/auth/verify-email','POST',{email:name+'@mock.test',code:mockMail.latestCode(name+'@mock.test')});const logged=await req('/auth/login','POST',{email:name+'@mock.test',password:'MockPassword123!'});assert.equal(logged.status,200);if(name==='Owner')owner=logged.data;if(name==='Artist')artist=logged.data;if(name==='Outsider')outsider=logged.data;}
 artistId=(await req('/auth/me','GET',undefined,artist.token)).data.artistProfile.id;
 db.prepare("INSERT INTO users(id,name,email,passwordHash,role,emailVerified)VALUES('mock-admin','Admin','admin@mock.test','unused','admin',1)").run();admin=require('../src/middleware/auth').signToken({id:'mock-admin',role:'admin'});
 const b=await booking();assert.equal(b.artistFeePaise,1000000);assert.equal(b.paymentRequired,1);
 assert.equal((await req('/bookings/'+b.id+'/status','PATCH',{status:'Accepted',finalPricePaise:12.5},artist.token)).status,400);
 const a=await accept(b);assert.equal(a.finalAmountPaise,125055);assert.equal(a.paymentStatus,'unpaid');
 assert.equal((await req('/bookings/'+b.id+'/status','PATCH',{status:'Confirmed'},owner.token)).status,409);
});
test('MOCK: only owner can order/read/verify/reconcile/receipt; browser amounts rejected',async()=>{
 const b=await accept(await booking());
 for(const token of [outsider.token,artist.token,admin]){assert.equal((await req(`/payments/bookings/${b.id}`,'GET',undefined,token)).status,403);assert.equal((await req(`/payments/bookings/${b.id}/order`,'POST',{},token)).status,403);}
 assert.equal((await req(`/payments/bookings/${b.id}/order`,'POST',{amount:1,currency:'USD'},owner.token)).status,400);
 const order=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data;
 assert.equal(order.amountPaise,125055);assert.equal(order.currency,'INR');
 assert.equal((await req(`/payments/bookings/${b.id}/reconcile`,'POST',{},outsider.token)).status,403);
 assert.equal((await req(`/payments/bookings/${b.id}/verify`,'POST',{},artist.token)).status,403);
});
test('MOCK: concurrent initiation and retries reuse one provider order',async()=>{
 const b=await accept(await booking()),before=mock.createCalls;
 const results=await Promise.all(Array.from({length:5},()=>req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)));
 assert.equal(mock.createCalls-before,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_orders WHERE bookingId=?').get(b.id).n,1);
 assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));
 const a=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data;
 const c=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data;assert.equal(a.orderId,c.orderId);
});
test('MOCK: invalid signatures, authorization alone, capture verification, receipts and no second charge',async()=>{
 const b=await accept(await booking()),order=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data;
 const p=mock.pay(order.orderId,'authorized');
 assert.equal((await checkout(b,order,p,'0'.repeat(64))).status,400);
 assert.equal((await checkout(b,order,p)).data.booking.status,'Accepted');
 assert.equal(db.prepare('SELECT paymentStatus FROM bookings WHERE id=?').get(b.id).paymentStatus,'authorized');
 assert.equal((await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).status,409);
 mock.payments.get(p.id).status='captured';mock.payments.get(p.id).captured=true;mock.orders.get(order.orderId).status='paid';
 const captured=await checkout(b,order,p);assert.equal(captured.data.booking.status,'Confirmed');assert.equal(captured.data.booking.paymentStatus,'paid');
 assert.equal((await checkout(b,order,p)).data.booking.status,'Confirmed');
 const receipt=await req('/payments/receipts/'+p.id,'GET',undefined,owner.token);assert.equal(receipt.status,200);assert.equal(receipt.data.transaction.amountPaise,125055);assert.equal(receipt.data.mode,'test');assert.match(receipt.data.payoutStatus,/not an artist payout/);
 assert.equal((await req('/payments/receipts/'+p.id,'GET',undefined,outsider.token)).status,403);
 assert.equal((await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).status,409);
});
test('MOCK: failed and abandoned sessions, expiry and retry do not prove payment failure',async()=>{
 const b=await accept(await booking()),order=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data;
 mock.pay(order.orderId,'failed',{error_code:'BAD_REQUEST_ERROR'});
 assert.equal((await req(`/payments/bookings/${b.id}`,'GET',undefined,owner.token)).data.booking.paymentStatus,'failed');
 await req(`/payments/bookings/${b.id}/session`,'POST',{action:'dismissed'},owner.token);
 assert.equal((await req(`/payments/bookings/${b.id}`,'GET',undefined,owner.token)).data.displayStatus,'abandoned');
 db.prepare("UPDATE payment_orders SET sessionState='open',sessionExpiresAt=0 WHERE bookingId=?").run(b.id);
 assert.equal((await req(`/payments/bookings/${b.id}`,'GET',undefined,owner.token)).data.displayStatus,'failed');
 db.prepare('UPDATE payment_orders SET sessionExpiresAt=? WHERE bookingId=?').run(Date.now()-1,b.id);
 assert.equal((await req(`/payments/bookings/${b.id}`,'GET',undefined,owner.token)).data.displayStatus,'expired');
 assert.equal((await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data.orderId,order.orderId);
});
test('MOCK: raw webhook signatures, duplicate delivery, delayed callback recovery and out-of-order events',async()=>{
 const b=await accept(await booking()),order=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data,p=mock.pay(order.orderId);
 assert.equal((await hook(eventFor(p),'invalid_sig','f'.repeat(64))).status,400);
 const raw='  '+JSON.stringify(eventFor(p))+'\n';const first=await hook(eventFor(p),'evt_duplicate',undefined,raw);assert.equal(first.status,200);
 assert.equal((await hook(eventFor(p),'evt_duplicate',undefined,raw)).data.duplicate,true);
 assert.equal((await hook(eventFor(p),'evt_duplicate')).status,400);
 const notices=db.prepare("SELECT COUNT(*) n FROM notifications WHERE text LIKE 'Payment captured:%' AND userId=?").get(owner.user.id).n;
 await hook(eventFor(p,'payment.authorized'));
 assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(b.id).status,'Confirmed');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE text LIKE 'Payment captured:%' AND userId=?").get(owner.user.id).n,notices);
 const late=await accept(await booking()),lo=(await req(`/payments/bookings/${late.id}/order`,'POST',{},owner.token)).data;
 mock.pay(lo.orderId);const recovered=await req(`/payments/bookings/${late.id}`,'GET',undefined,owner.token);assert.equal(recovered.data.booking.paymentStatus,'paid');assert.equal(recovered.data.booking.status,'Confirmed');
});
test('MOCK: amount/currency/order mismatches and late cancellation capture require review',async()=>{
 for(const override of [{amount:1},{currency:'USD'},{order_id:'order_wrong'}]){
 const b=await accept(await booking()),o=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data,p=mock.pay(o.orderId,'captured',override);
 const response=await checkout(b,o,p);assert.equal(response.data.booking.status,'Accepted');assert.equal(response.data.booking.paymentStatus,'review_required');
 }
 const b=await accept(await booking()),o=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data;
 const cancelled=await req('/bookings/'+b.id+'/status','PATCH',{status:'Cancelled'},owner.token);assert.equal(cancelled.data.paymentStatus,'pending');const p=mock.pay(o.orderId);await hook(eventFor(p));
 const r=await req(`/payments/bookings/${b.id}`,'GET',undefined,owner.token);assert.equal(r.data.booking.status,'Cancelled');assert.equal(r.data.booking.paymentStatus,'review_required');assert.equal(r.data.transactions[0].status,'captured');
});
test('MOCK: provider outage retries webhook; interrupted creation recovers by receipt without a second order',async()=>{
 const b=await accept(await booking());mock.failCreate=true;const before=mock.createCalls;
 assert.equal((await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).status,502);mock.failCreate=false;
 const order=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data;assert.equal(mock.createCalls-before,1);assert.ok(order.orderId);
 const p=mock.pay(order.orderId);mock.offline=true;assert.equal((await hook(eventFor(p),'evt_retry')).status,503);mock.offline=false;
 assert.equal((await hook(eventFor(p),'evt_retry')).status,200);assert.equal((await req(`/payments/bookings/${b.id}`,'GET',undefined,owner.token)).data.booking.status,'Confirmed');
});
test('MOCK: admin filters and review notes cannot fabricate captures or payouts',async()=>{
 assert.equal((await req('/payments/admin/orders','GET',undefined,owner.token)).status,403);
 const result=await req('/payments/admin/orders?status=review_required&mode=test','GET',undefined,admin);assert.equal(result.status,200);assert.ok(result.data.total>=4);
 const order=result.data.orders[0];assert.equal((await req(`/payments/admin/bookings/${order.bookingId}/review-note`,'POST',{note:'Reviewed in mock dashboard; refund pending.'},admin)).status,200);
 assert.equal(db.prepare('SELECT paymentStatus FROM bookings WHERE id=?').get(order.bookingId).paymentStatus,'review_required');
 const history=await req('/payments/history','GET',undefined,outsider.token);assert.deepEqual(history.data,[]);
});
test('MOCK: multiple captures and refunds preserve transaction facts and flag admin review',async()=>{
 const b=await accept(await booking()),o=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data;
 const first=mock.pay(o.orderId);await hook(eventFor(first));
 mock.pay(o.orderId);const multiple=await req(`/payments/bookings/${b.id}`,'GET',undefined,owner.token);
 assert.equal(multiple.data.booking.paymentStatus,'review_required');assert.match(multiple.data.order.reviewReason,/Multiple captured/);
 const refunded=await accept(await booking()),order=(await req(`/payments/bookings/${refunded.id}/order`,'POST',{},owner.token)).data,p=mock.pay(order.orderId);
 await hook(eventFor(p));mock.payments.get(p.id).amount_refunded=p.amount;mock.payments.get(p.id).status='refunded';
 assert.equal((await hook({event:'refund.processed',payload:{refund:{entity:{payment_id:p.id}}}})).status,200);
 const snapshot=(await req(`/payments/bookings/${refunded.id}`,'GET',undefined,owner.token)).data;
 assert.equal(snapshot.booking.paymentStatus,'review_required');assert.equal(snapshot.transactions[0].status,'refunded');assert.equal(snapshot.transactions[0].refundedPaise,125055);
});
test('MOCK: key/mode rotation cannot silently create a second order; no unknown-order remint',async()=>{
 const b=await accept(await booking()),o=(await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).data,previous=process.env.RAZORPAY_KEY_ID;
 process.env.RAZORPAY_KEY_ID='rzp_test_rotatedMock';assert.equal((await req(`/payments/bookings/${b.id}/order`,'POST',{},owner.token)).status,409);process.env.RAZORPAY_KEY_ID=previous;
 const c=await accept(await booking());mock.failCreate=true;assert.equal((await req(`/payments/bookings/${c.id}/order`,'POST',{},owner.token)).status,502);mock.failCreate=false;
 const local=db.prepare('SELECT * FROM payment_orders WHERE bookingId=?').get(c.id);for(const [key,value] of mock.orders)if(value.receipt===local.receipt)mock.orders.delete(key);
 const before=mock.createCalls;assert.equal((await req(`/payments/bookings/${c.id}/order`,'POST',{},owner.token)).status,409);assert.equal(mock.createCalls,before);
 assert.ok(o.orderId);
});
