const express=require('express');
const C=require('./common'),{db,id,safe,fail,text,amount,range,zone,booking,visible,conflict,timeline,notify,expire}=C;
const {requireAuth,requireRole}=require('../middleware/auth');
const {limited}=require('../auth/common');
const router=express.Router();router.use(requireAuth);
router.use((req,res,next)=>{expire();res.set('Cache-Control','no-store');next();});
function load(b,user){
 const quotes=db.prepare('SELECT * FROM booking_quotes WHERE bookingId=? ORDER BY rowid DESC').all(b.id).map(q=>({...q,items:JSON.parse(q.items),snapshot:JSON.parse(q.snapshot)}));
 return {...b,agreedSnapshot:b.agreedSnapshot?JSON.parse(b.agreedSnapshot):null,quotes,
 timeline:db.prepare('SELECT status,note,createdAt FROM booking_timeline WHERE bookingId=? ORDER BY id').all(b.id),
 unread:db.prepare('SELECT COUNT(*) n FROM booking_messages WHERE bookingId=? AND senderId!=? AND id>COALESCE((SELECT lastId FROM booking_reads WHERE bookingId=? AND userId=?),0)').get(b.id,user.id,b.id,user.id).n,
 review:db.prepare('SELECT id,rating,text,hidden FROM reviews WHERE bookingId=?').get(b.id)||null};
}
router.post('/enquiries',requireRole('organizer'),safe((req,res)=>{
 const b=req.body,a=visible(b.artistId,req.user),r=range(b.startsAt,b.endsAt);
 if(Date.parse(r.startsAt)<Date.now())throw fail(400,'Choose a future event time.');
 const p=b.packageId?db.prepare('SELECT * FROM artist_packages WHERE id=? AND artistId=? AND active=1').get(b.packageId,a.id):null;if(b.packageId&&!p)throw fail(400,'This package is unavailable.');
 const item={id:id('BK-'),artistId:a.id,organizerId:req.user.id,eventName:text(b.eventName,'Event name',2,150),date:r.startsAt.slice(0,10),duration:String(Math.round((Date.parse(r.endsAt)-Date.parse(r.startsAt))/60000))+' minutes',location:text(b.location,'Location',2,300),notes:text(b.notes||'','Notes',0,3000),...r,timeZone:zone(b.timeZone),packageId:p?.id||null,fee:(p?.basePricePaise||Math.round(a.price*100))/100,artistFeePaise:p?.basePricePaise||Math.round(a.price*100)};
 db.transaction(()=>{db.prepare("INSERT INTO bookings(id,artistId,organizerId,eventName,date,duration,location,notes,startsAt,endsAt,timeZone,packageId,fee,platformFee,artistFeePaise,platformFeePaise,finalAmountPaise,paymentRequired,status,workflowVersion) VALUES(@id,@artistId,@organizerId,@eventName,@date,@duration,@location,@notes,@startsAt,@endsAt,@timeZone,@packageId,@fee,0,@artistFeePaise,0,@artistFeePaise,1,'Requested',2)").run(item);timeline(item,'Requested',req.user.id);notify(a.userId,item.id,'New enquiry: '+item.eventName);}) .immediate();
 res.status(201).json(load(booking(req.user,item.id),req.user));
}));
router.get('/bookings',safe((req,res)=>{
 const rows=db.prepare("SELECT b.*,a.userId AS artistUserId,u.name AS artistName,c.name AS clientName FROM bookings b JOIN artist_profiles a ON a.id=b.artistId JOIN users u ON u.id=a.userId JOIN users c ON c.id=b.organizerId WHERE b.organizerId=? OR a.userId=? ORDER BY b.createdAt DESC").all(req.user.id,req.user.id);
 const page=Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1)),q=String(req.query.q||'').toLowerCase(),filtered=rows.filter(b=>(!req.query.status||b.status===req.query.status)&&(!q||[b.eventName,b.artistName,b.clientName].join(' ').toLowerCase().includes(q)));
 res.json({total:filtered.length,page,bookings:filtered.slice((page-1)*20,page*20).map(b=>load(b,req.user))});
}));
router.get('/bookings/:id',safe((req,res)=>res.json(load(booking(req.user,req.params.id,true),req.user))));
router.post('/bookings/:id/quotes',requireRole('artist'),safe((req,res)=>{
 const b=booking(req.user,req.params.id);if(b.artistUserId!==req.user.id)throw fail(403,'Only the booked artist may quote.');if(b.workflowVersion!==2||!['Requested','Quoted'].includes(b.status))throw fail(409,'This enquiry cannot receive a quotation.');
 const data=req.body;if(!Array.isArray(data.items)||!data.items.length||data.items.length>20)throw fail(400,'Use 1–20 quotation line items.');
 const items=data.items.map(v=>{if(v.quantity!==undefined&&(!Number.isInteger(v.quantity)||v.quantity<1||v.quantity>100))throw fail(400,'Item quantities must be integers from 1 to 100.');return {description:text(v.description,'Item description',1,200),quantity:v.quantity||1,amountPaise:amount(v.amountPaise)};});
 const totalPaise=amount(items.reduce((s,v)=>s+v.quantity*v.amountPaise,0),'Total',100),expiresAt=C.iso(data.expiresAt);
 if(Date.parse(expiresAt)<=Date.now()||Date.parse(expiresAt)>Math.min(Date.now()+30*86400000,Date.parse(b.startsAt)))throw fail(400,'Quote expiry must be before the event, within the next 30 days.');
 const p=b.packageId?db.prepare('SELECT * FROM artist_packages WHERE id=?').get(b.packageId):null;
 const quote={id:id('qt_'),bookingId:b.id,items:JSON.stringify(items),totalPaise,terms:text(data.terms,'Quotation terms',5,4000),expiresAt,snapshot:JSON.stringify({eventName:b.eventName,location:b.location,startsAt:b.startsAt,endsAt:b.endsAt,timeZone:b.timeZone,package:p?{...p,extras:JSON.parse(p.extras)}:null})};
 db.transaction(()=>{const current=booking(req.user,b.id);if(!['Requested','Quoted'].includes(current.status))throw fail(409,'This enquiry can no longer receive a quotation.');db.prepare('INSERT INTO booking_quotes(id,bookingId,items,totalPaise,terms,expiresAt,snapshot) VALUES(@id,@bookingId,@items,@totalPaise,@terms,@expiresAt,@snapshot)').run(quote);db.prepare("UPDATE bookings SET status='Quoted' WHERE id=?").run(b.id);timeline(b,'Quoted',req.user.id,'Quotation '+quote.id);notify(b.organizerId,b.id,'Quotation received: '+b.eventName);}).immediate();res.status(201).json(load(booking(req.user,b.id),req.user));
}));
router.post('/bookings/:id/quotes/:quoteId/accept',requireRole('organizer'),safe((req,res)=>{
 db.transaction(()=>{
 const b=booking(req.user,req.params.id);if(b.organizerId!==req.user.id||b.workflowVersion!==2||b.status!=='Quoted')throw fail(409,'Only the client can accept a current quotation.');
 const q=db.prepare('SELECT * FROM booking_quotes WHERE bookingId=? ORDER BY rowid DESC LIMIT 1').get(b.id);
 if(!q||q.id!==req.params.quoteId||Date.parse(q.expiresAt)<=Date.now())throw fail(409,'Quotation expired or superseded.');
 if(Date.parse(b.startsAt)<=Date.now())throw fail(409,'The event has already started.');
 const reason=conflict(b.artistId,b.startsAt,b.endsAt,b.id);if(reason)throw fail(409,reason);
 const snapshot=JSON.stringify({...JSON.parse(q.snapshot),quoteId:q.id,items:JSON.parse(q.items),terms:q.terms,totalPaise:q.totalPaise,acceptedAt:new Date().toISOString()});
 db.prepare('UPDATE booking_quotes SET acceptedAt=? WHERE id=?').run(new Date().toISOString(),q.id);
 db.prepare("UPDATE bookings SET status='Accepted',acceptedQuoteId=?,agreedSnapshot=?,artistFeePaise=?,finalAmountPaise=?,fee=?,reservationExpiresAt=? WHERE id=?").run(q.id,snapshot,q.totalPaise,q.totalPaise,q.totalPaise/100,Math.min(Date.now()+15*60000,Date.parse(b.startsAt)),b.id);
 timeline(b,'Accepted',req.user.id,'Accepted quote '+q.id+'; payment reservation lasts up to 15 minutes.');notify(b.artistUserId,b.id,'Quotation accepted: '+b.eventName);
 }).immediate();res.json(load(booking(req.user,req.params.id),req.user));
}));
router.post('/bookings/:id/transition',safe((req,res)=>{
 db.transaction(()=>{
 const b=booking(req.user,req.params.id,true),target=req.body.status,isClient=b.organizerId===req.user.id,isArtist=b.artistUserId===req.user.id,isAdmin=req.user.role==='admin';
 if(b.workflowVersion!==2)throw fail(409,'Use the existing booking controls for this historical booking.');
 const allowed=(target==='Declined'&&isArtist&&['Requested','Quoted'].includes(b.status))||(target==='Cancelled'&&(isClient||isArtist||isAdmin)&&['Requested','Quoted','Accepted','Payment Pending','Confirmed'].includes(b.status))||(target==='Completed'&&isClient&&b.status==='Confirmed'&&Date.parse(b.endsAt)<=Date.now());
 if(!allowed)throw fail(409,'This booking transition is not permitted.');
 if(target==='Cancelled'&&['paid','authorized','review_required'].includes(b.paymentStatus)){const order=require('../payments/service').getOrder(b.id);if(order)require('../payments/service').flag(order.id,'Booking cancelled after payment or authorization. Review the provider refund status.');}
 db.prepare('UPDATE bookings SET status=? WHERE id=?').run(target,b.id);timeline(b,target,req.user.id,text(req.body.note||'','Note',0,1000));notify(isClient?b.artistUserId:b.organizerId,b.id,'Booking '+b.eventName+': '+target);
 }).immediate();res.json(load(booking(req.user,req.params.id,true),req.user));
}));
router.get('/bookings/:id/messages',safe((req,res)=>{
 booking(req.user,req.params.id);const before=Math.max(1,parseInt(req.query.before,10)||Number.MAX_SAFE_INTEGER);
 const rows=db.prepare('SELECT m.*,u.name AS senderName FROM booking_messages m JOIN users u ON u.id=m.senderId WHERE bookingId=? AND m.id<? ORDER BY m.id DESC LIMIT 30').all(req.params.id,before);
 res.json({messages:rows.reverse(),nextBefore:rows.length===30?rows[0].id:null});
}));
router.post('/bookings/:id/read',safe((req,res)=>{booking(req.user,req.params.id);const last=db.prepare('SELECT COALESCE(MAX(id),0) n FROM booking_messages WHERE bookingId=?').get(req.params.id).n;db.prepare('INSERT INTO booking_reads(bookingId,userId,lastId) VALUES(?,?,?) ON CONFLICT(bookingId,userId) DO UPDATE SET lastId=excluded.lastId').run(req.params.id,req.user.id,last);res.json({ok:true});}));
router.post('/bookings/:id/messages',safe((req,res)=>{
 const b=booking(req.user,req.params.id),message=text(req.body.text,'Message',1,3000);
 if(limited('booking-message',req.user.id,30,60000))throw fail(429,'Message limit reached. Please wait one minute.');
 db.transaction(()=>{db.prepare('INSERT INTO booking_messages(bookingId,senderId,text) VALUES(?,?,?)').run(b.id,req.user.id,message);notify(req.user.id===b.organizerId?b.artistUserId:b.organizerId,b.id,'New message about '+b.eventName);}).immediate();res.status(201).json({ok:true});
}));
router.post('/bookings/:id/review',requireRole('organizer'),safe((req,res)=>{
 db.transaction(()=>{const b=booking(req.user,req.params.id);if(b.organizerId!==req.user.id||b.status!=='Completed')throw fail(409,'Reviews are available to the client after a completed booking.');if(db.prepare('SELECT id FROM reviews WHERE bookingId=?').get(b.id))throw fail(409,'This booking already has a review.');
 if(!Number.isInteger(req.body.rating)||req.body.rating<1||req.body.rating>5)throw fail(400,'Rating must be 1–5.');
 db.prepare('INSERT INTO reviews(id,artistId,author,rating,text,bookingId,authorId) VALUES(?,?,?,?,?,?,?)').run(id('rv_'),b.artistId,req.user.name,req.body.rating,text(req.body.text,'Review',10,2000),b.id,req.user.id);notify(b.artistUserId,b.id,'A verified-booking review was added for '+b.eventName);}).immediate();res.status(201).json({ok:true});
}));
module.exports={router,load};
