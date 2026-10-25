const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-connected-'));process.env.DATABASE_PATH=path.join(dir,'platform.db');process.env.MEDIA_DIR=path.join(dir,'media');process.env.JWT_SECRET='connected-workflow-test-secret-48-characters-minimum';process.env.RAZORPAY_MODE='test';process.env.RAZORPAY_KEY_ID='rzp_test_connected';process.env.RAZORPAY_KEY_SECRET='connected-mock-secret';process.env.RAZORPAY_WEBHOOK_SECRET='connected-mock-webhook';
const app=require('../src/index'),db=require('../src/db'),{signToken}=require('../src/middleware/auth'),mock=require('./razorpay-mock').createMock();app.locals.razorpay=mock.sdk;
let server,base;const ready=new Promise(r=>{server=app.listen(0,'127.0.0.1',()=>{base='http://127.0.0.1:'+server.address().port+'/api';r();});});
after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});});
const tokens={};for(const [key,role] of [['artist','artist'],['client','organizer'],['other','organizer'],['second','artist'],['admin','admin']]){db.prepare('INSERT INTO users(id,email,passwordHash,name,role,emailVerified) VALUES(?,?,?,?,?,1)').run(key,key+'@test.local','fixture','Fixture '+key,role);tokens[key]=signToken({id:key,role});if(role==='artist')db.prepare("INSERT INTO artist_profiles(id,userId,category,location,rating) VALUES(?,?,'Singers','Pune',0)").run(key+'-profile',key);}
async function req(route,method='GET',body,who='client'){await ready;const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+tokens[who]}:{})},body:body===undefined?undefined:JSON.stringify(body)});let data;try{data=await r.json();}catch{}return {status:r.status,data};}
const day='2099-10-20',start=day+'T12:00:00Z',end=day+'T14:00:00Z';let pkg,first;
const enquiry=(startsAt=start,endsAt=end,who='client')=>req('/studio/enquiries','POST',{artistId:'artist-profile',eventName:'Connected event',location:'Pune',startsAt,endsAt,timeZone:'Asia/Kolkata',packageId:pkg?.id},who);
const quote=async b=>{const r=await req('/studio/bookings/'+b.id+'/quotes','POST',{items:[{description:'Performance',quantity:2,amountPaise:150000},{description:'Travel',amountPaise:50000}],terms:'Cancellation on written notice; discuss any refund with the artist.',expiresAt:new Date(Date.now()+86400000).toISOString()},'artist');assert.equal(r.status,201,JSON.stringify(r.data));return r.data.quotes[0];};
const accept=(b,q,who='client')=>req('/studio/bookings/'+b.id+'/quotes/'+q.id+'/accept','POST',{},who);
async function pay(b){const order=await req('/payments/bookings/'+b.id+'/order','POST',{});assert.equal(order.status,200,JSON.stringify(order.data));const p=mock.pay(order.data.orderId);const r=await req('/payments/bookings/'+b.id+'/verify','POST',{razorpay_order_id:order.data.orderId,razorpay_payment_id:p.id,razorpay_signature:mock.signature(order.data.orderId,p.id)});return {r,p,order};}
test('stage 1: profile and packages protect ownership, validate links and preserve visibility',async()=>{
 assert.equal((await req('/studio/profile','PATCH',{genres:['Jazz'],languages:['Hindi','English'],serviceLocations:['Pune'],timeZone:'Asia/Kolkata',socialLinks:['https://example.com/artist']},'artist')).status,200);
 assert.equal((await req('/studio/profile','PATCH',{socialLinks:['javascript:alert(1)']},'artist')).status,400);
 assert.equal((await req('/studio/profile','PATCH',{genres:['Jazz']},'client')).status,403);
 const p=await req('/studio/packages','POST',{name:'Acoustic set',description:'A live acoustic performance',durationMinutes:120,basePricePaise:300000,included:'Vocals and guitar',equipment:'PA required',travelPaise:50000,extras:[{name:'Extra set',amountPaise:100000}],cancellationTerms:'Written cancellation terms apply.'},'artist');assert.equal(p.status,201);pkg=p.data;
 assert.equal((await req('/studio/packages/'+pkg.id,'PATCH',{active:false},'second')).status,404);
 await req('/studio/profile','PATCH',{visibility:'private'},'artist');assert.equal((await req('/artists/artist-profile','GET',undefined,null)).status,404);assert.equal((await req('/studio/artists/artist-profile','GET',undefined,null)).status,404);await req('/studio/profile','PATCH',{visibility:'public'},'artist');
});
test('stage 1: protected disk uploads validate content and public media respects private profiles',async()=>{
 await ready;const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO8sAAAAASUVORK5CYII=','base64');
 let r=await fetch(base+'/media',{method:'POST',headers:{Authorization:'Bearer '+tokens.artist,'Content-Type':'image/png'},body:bytes});assert.equal(r.status,201);const m=await r.json();assert.ok(fs.readdirSync(process.env.MEDIA_DIR).length);assert.equal((await req('/studio/profile','PATCH',{photo:m.url},'second')).status,400);
 assert.equal((await req('/studio/profile','PATCH',{photo:m.url,cover:m.url},'artist')).status,200);assert.equal((await fetch(base.replace('/api','')+m.url)).status,200);
 await req('/studio/profile','PATCH',{visibility:'private'},'artist');assert.equal((await fetch(base.replace('/api','')+m.url)).status,404);await req('/studio/profile','PATCH',{visibility:'public'},'artist');
 r=await fetch(base+'/media',{method:'POST',headers:{Authorization:'Bearer '+tokens.artist,'Content-Type':'image/png'},body:Buffer.from('not an image')});assert.equal(r.status,400);
});
test('stage 1: availability has consistent offsets, private notes, ranges and owner deletion',async()=>{
 const b=await req('/studio/availability','POST',{startsAt:'2099-11-01T10:00:00+05:30',endsAt:'2099-11-01T12:00:00+05:30',note:'Private medical appointment'},'artist');assert.equal(b.status,201);assert.equal(b.data.startsAt,'2099-11-01T04:30:00.000Z');
 assert.equal((await req('/studio/availability','POST',{startsAt:'2099-11-01T10:00:00',endsAt:'2099-11-01T12:00:00'},'artist')).status,400);
 const a=await req('/studio/artists/artist-profile/availability?from=2099-11-01T00:00:00Z&to=2099-11-03T00:00:00Z','GET',undefined,null);assert.equal(a.status,200);assert.ok(!JSON.stringify(a.data).includes('medical'));assert.equal((await req('/studio/availability/'+b.data.id,'DELETE',{},'second')).status,404);
});
test('stage 2: enquiries do not block each other; quote ownership, totals and concurrent acceptance are enforced',async()=>{
 const a=await enquiry(),b=await enquiry(start,end,'other');assert.equal(a.status,201);assert.equal(b.status,201);first=a.data;
 assert.equal((await req('/studio/bookings/'+first.id,'GET',undefined,'other')).status,403);
 assert.equal((await req('/studio/bookings/'+first.id+'/quotes','POST',{items:[]},'second')).status,403);
 const qa=await quote(first),qb=await quote(b.data);assert.equal(qa.totalPaise,350000);
 const results=await Promise.all([accept(first,qa),accept(b.data,qb,'other')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 if(results[0].status!==200){await req('/studio/bookings/'+b.data.id+'/transition','POST',{status:'Cancelled'},'other');assert.equal((await accept(first,qa)).status,200);}
 const saved=(await req('/studio/bookings/'+first.id)).data;assert.equal(saved.agreedSnapshot.totalPaise,350000);assert.equal(saved.finalAmountPaise,350000);
 await req('/studio/packages/'+pkg.id,'PATCH',{active:false},'artist');assert.equal((await req('/studio/bookings/'+first.id)).data.agreedSnapshot.package.name,'Acoustic set');pkg=null;
 assert.equal((await req('/bookings/'+first.id+'/status','PATCH',{status:'Accepted',finalPricePaise:100},'artist')).status,409);
});
test('stage 2: verified capture confirms, duplicate webhooks are idempotent and receipts belong to participants',async()=>{
 const {r,p}=await pay(first);assert.equal(r.status,200);assert.equal(r.data.booking.status,'Confirmed');assert.equal(r.data.booking.finalAmountPaise,350000);
 const event=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:p.id,order_id:p.order_id}}}}),signature=crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(event).digest('hex');
 const hook=()=>fetch(base+'/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Razorpay-Signature':signature,'X-Razorpay-Event-Id':'evt_connected_duplicate'},body:event});assert.equal((await hook()).status,200);assert.equal((await (await hook()).json()).duplicate,true);assert.equal(db.prepare("SELECT COUNT(*) n FROM booking_timeline WHERE bookingId=? AND status='Confirmed'").get(first.id).n,1);
 for(const who of ['client','artist']){const receipt=await fetch(base+'/studio/receipts/'+p.id,{headers:{Authorization:'Bearer '+tokens[who]}});assert.equal(receipt.status,200);assert.match(await receipt.text(),/TEST MODE/);}
 assert.equal((await req('/studio/receipts/'+p.id,'GET',undefined,'other')).status,403);
});
test('stage 2: late captures and conflicting captures enter resolution instead of confirming',async()=>{
 const a=(await enquiry('2099-10-22T12:00:00Z','2099-10-22T14:00:00Z')).data,q=await quote(a);await accept(a,q);const o=await req('/payments/bookings/'+a.id+'/order','POST',{});db.prepare('UPDATE bookings SET reservationExpiresAt=? WHERE id=?').run(Date.now()-1,a.id);const p=mock.pay(o.data.orderId);
 const result=await req('/payments/bookings/'+a.id+'/verify','POST',{razorpay_order_id:o.data.orderId,razorpay_payment_id:p.id,razorpay_signature:mock.signature(o.data.orderId,p.id)});assert.notEqual(result.data.booking.status,'Confirmed');assert.equal(result.data.booking.paymentStatus,'review_required');
 const b=(await enquiry('2099-10-23T12:00:00Z','2099-10-23T14:00:00Z')).data,qb=await quote(b);await accept(b,qb);db.prepare("INSERT INTO availability_blocks(id,artistId,startsAt,endsAt) VALUES('unexpected-conflict','artist-profile','2099-10-23T12:00:00.000Z','2099-10-23T14:00:00.000Z')").run();assert.equal((await req('/payments/bookings/'+b.id+'/order','POST',{})).status,409);
});
test('stage 3: messages are participant-only, paginated, unread and rate limited',async()=>{
 assert.equal((await req('/studio/bookings/'+first.id+'/messages','POST',{text:'Private message from client'})).status,201);assert.equal((await req('/studio/bookings/'+first.id+'/messages','GET',undefined,'other')).status,403);assert.equal((await req('/studio/bookings/'+first.id+'/messages','GET',undefined,'admin')).status,403);
 assert.equal((await req('/studio/bookings/'+first.id,'GET',undefined,'artist')).data.unread,1);await req('/studio/bookings/'+first.id+'/read','POST',{},'artist');assert.equal((await req('/studio/bookings/'+first.id,'GET',undefined,'artist')).data.unread,0);
 for(let i=0;i<31;i++)db.prepare('INSERT INTO booking_messages(bookingId,senderId,text) VALUES(?,?,?)').run(first.id,'client','Message '+i);
 const page=(await req('/studio/bookings/'+first.id+'/messages','GET',undefined,'artist')).data;assert.equal(page.messages.length,30);assert.ok(page.nextBefore);assert.ok((await req('/studio/bookings/'+first.id+'/messages?before='+page.nextBefore,'GET',undefined,'artist')).data.messages.length>0);
 const results=await Promise.all(Array.from({length:31},()=>req('/studio/bookings/'+first.id+'/messages','POST',{text:'Rate limit check'},'artist')));assert.ok(results.some(r=>r.status===429));
});
test('stage 3: only completed client bookings can review, one per booking, real aggregate and moderation audit',async()=>{
 assert.equal((await req('/studio/bookings/'+first.id+'/review','POST',{rating:5,text:'An excellent performance.'})).status,409);
 db.prepare('UPDATE bookings SET startsAt=?,endsAt=?,date=? WHERE id=?').run('2020-01-01T10:00:00Z','2020-01-01T12:00:00Z','2020-01-01',first.id);
 assert.equal((await req('/studio/bookings/'+first.id+'/transition','POST',{status:'Completed'},'artist')).status,409);assert.equal((await req('/studio/bookings/'+first.id+'/transition','POST',{status:'Completed'})).status,200);
 assert.equal((await req('/studio/bookings/'+first.id+'/review','POST',{rating:6,text:'An excellent performance.'})).status,400);assert.equal((await req('/studio/bookings/'+first.id+'/review','POST',{rating:5,text:'An excellent performance.'})).status,201);assert.equal((await req('/studio/bookings/'+first.id+'/review','POST',{rating:3,text:'Duplicate review request.'})).status,409);
 let publicProfile=(await req('/artists/artist-profile','GET',undefined,null)).data;assert.equal(publicProfile.artist.rating,5);assert.equal(publicProfile.artist.reviews,1);
 await req('/studio/reports','POST',{targetType:'review',targetId:publicProfile.reviews[0].id,reason:'Please review the wording in this review.'},'other');assert.equal((await req('/studio/moderation','GET',undefined,'client')).status,403);const reports=(await req('/studio/moderation','GET',undefined,'admin')).data;assert.equal((await req('/studio/moderation/'+reports.reports[0].id,'POST',{action:'hide',note:'Moderated for this isolated test.'},'admin')).status,200);assert.equal((await req('/artists/artist-profile','GET',undefined,null)).data.artist.reviews,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_audit').get().n,1);
});
test('stage 3: notification email failures leave committed bookings and a retryable outbox',async()=>{
 const count=db.prepare('SELECT COUNT(*) n FROM bookings').get().n;app.locals.mailTransport={sendMail:async()=>{throw Error('offline');}};await require('../src/platform/outbox').flush(app);assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,count);assert.ok(db.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE status='pending' AND attempts>0").get().n>0);
});
test('stage 4: collaboration duplicate applications, owner permissions and saved artists',async()=>{
 const post=await req('/studio/board','POST',{title:'Acoustic collaboration',description:'Looking for a creative partner for a live set.',requiredSkill:'Guitar',genre:'Acoustic',remote:true,deadline:'2099-11-01T12:00:00Z',paid:true,budgetPaise:500000},'artist');assert.equal(post.status,201);
 assert.equal((await req('/studio/board/'+post.data.id+'/apply','POST',{message:'I would like to work on this set.'},'second')).status,201);assert.equal((await req('/studio/board/'+post.data.id+'/apply','POST',{message:'Duplicate application'},'second')).status,409);const entry=(await req('/studio/board','GET',undefined,'artist')).data.posts[0].applications[0];assert.equal((await req('/studio/board/entries/'+entry.id,'PATCH',{status:'Accepted'},'second')).status,403);assert.equal((await req('/studio/board/entries/'+entry.id,'PATCH',{status:'Accepted'},'artist')).status,200);
 assert.equal((await req('/studio/saved/artist-profile','POST',{})).status,200);assert.deepEqual((await req('/studio/saved')).data,['artist-profile']);
});
test('simultaneous provider captures cannot confirm overlapping bookings even with historical duplicate holds',async()=>{
 const startsAt='2099-12-21T10:00:00Z',endsAt='2099-12-21T12:00:00Z';
 const a=(await enquiry(startsAt,endsAt)).data,qa=await quote(a);await accept(a,qa);
 const firstOrder=(await req('/payments/bookings/'+a.id+'/order','POST',{})).data;
 // Fixture an expired/replaced reservation, then an old order arriving concurrently.
 db.prepare('UPDATE bookings SET reservationExpiresAt=? WHERE id=?').run(Date.now()-1,a.id);
 const b=(await enquiry(startsAt,endsAt)).data,qb=await quote(b);await accept(b,qb);
 const secondOrder=(await req('/payments/bookings/'+b.id+'/order','POST',{})).data;
 db.prepare("UPDATE bookings SET status='Payment Pending',reservationExpiresAt=? WHERE id=?").run(Date.now()+600000,a.id);
 const payments=[mock.pay(firstOrder.orderId),mock.pay(secondOrder.orderId)];
 const results=await Promise.all([a,b].map((row,i)=>{const o=[firstOrder,secondOrder][i],p=payments[i];return req('/payments/bookings/'+row.id+'/verify','POST',{razorpay_order_id:o.orderId,razorpay_payment_id:p.id,razorpay_signature:mock.signature(o.orderId,p.id)});}));
 assert.ok(results.every(r=>r.status===200));assert.equal(db.prepare("SELECT COUNT(*) n FROM bookings WHERE id IN (?,?) AND status='Confirmed'").get(a.id,b.id).n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM bookings WHERE id IN (?,?) AND paymentStatus='review_required'").get(a.id,b.id).n,1);
});
test('moderated profiles require admin restoration, verification has records, and admin queries are role protected',async()=>{
 await req('/studio/reports','POST',{targetType:'profile',targetId:'artist-profile',reason:'Please investigate this reported profile.'},'other');const report=(await req('/studio/moderation','GET',undefined,'admin')).data.reports[0];
 assert.equal((await req('/studio/moderation/'+report.id,'POST',{action:'hide',note:'Profile hidden for isolated moderation test.'},'admin')).status,200);
 assert.equal((await req('/studio/profile','PATCH',{visibility:'public'},'artist')).status,409);assert.equal((await req('/artists/artist-profile','GET',undefined,null)).status,404);
 assert.equal((await req('/studio/admin/restore','POST',{targetType:'profile',targetId:'artist-profile',note:'Reviewed and cleared by administrator.'},'client')).status,403);
 assert.equal((await req('/studio/admin/restore','POST',{targetType:'profile',targetId:'artist-profile',note:'Reviewed and cleared by administrator.'},'admin')).status,200);
 assert.equal((await req('/admin/artists/artist-profile/verify','PATCH',{details:'Reviewed submitted profile information only.'},'admin')).status,200);
 let artist=(await req('/artists/artist-profile','GET',undefined,null)).data.artist;assert.equal(artist.verified,true);assert.match(artist.verification.details,/profile information/);
 await req('/studio/verification/artist-profile/revoke','POST',{note:'Review expired and must be repeated.'},'admin');artist=(await req('/artists/artist-profile','GET',undefined,null)).data.artist;assert.equal(artist.verified,false);
 assert.equal((await req('/studio/admin/artists?q=Singers','GET',undefined,'client')).status,403);assert.ok((await req('/studio/admin/artists?q=Singers','GET',undefined,'admin')).data.total>=1);
});
test('outdated and expired quotations cannot be accepted and invalid quantities never silently change totals',async()=>{
 const b=(await enquiry('2099-12-25T10:00:00Z','2099-12-25T12:00:00Z')).data,old=await quote(b),current=await quote(b);
 assert.equal((await accept(b,old)).status,409);
 assert.equal((await req('/studio/bookings/'+b.id+'/quotes','POST',{items:[{description:'Invalid quantity',quantity:1.5,amountPaise:100}],terms:'Terms valid for testing',expiresAt:new Date(Date.now()+3600000).toISOString()},'artist')).status,400);
 db.prepare('UPDATE booking_quotes SET expiresAt=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),current.id);
 assert.equal((await accept(b,current)).status,409);assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(b.id).status,'Expired');
});
