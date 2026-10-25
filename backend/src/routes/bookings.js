const express = require('express');
const db = require('../db');
const {id} = require('../utils/id');
const {requireAuth,requireRole} = require('../middleware/auth');
const {paise} = require('../payments/security');
const router = express.Router();
router.use(requireAuth);
function owns(req,b) { const a=db.prepare('SELECT userId FROM artist_profiles WHERE id=?').get(b.artistId); return req.user.role==='admin'||b.organizerId===req.user.id||a?.userId===req.user.id; }
router.get('/',(req,res)=>{
 const rows=db.prepare('SELECT b.* FROM bookings b JOIN artist_profiles a ON a.id=b.artistId WHERE ? = \'admin\' OR b.organizerId=? OR a.userId=? ORDER BY b.createdAt DESC').all(req.user.role,req.user.id,req.user.id); res.json(rows);
});
router.get('/:id',(req,res)=>{const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);if(!b)return res.status(404).json({error:'Booking not found.'});if(!owns(req,b))return res.status(403).json({error:'Access denied.'});res.json(b);});
router.post('/',requireRole('organizer'),(req,res)=>{
 const {artistId,eventName,date,duration,location,notes}=req.body;
 if(![artistId,eventName,date,duration,location].every(v=>typeof v==='string'&&v.trim()))return res.status(400).json({error:'Artist, event, date, duration and location are required.'});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<new Date().toISOString().slice(0,10))return res.status(400).json({error:'Choose a valid future date.'});
 const artist=db.prepare('SELECT a.* FROM artist_profiles a JOIN users u ON u.id=a.userId WHERE a.id=? AND u.suspended=0').get(artistId);
 if(!artist)return res.status(404).json({error:'Artist not found.'});
 if(db.prepare("SELECT id FROM bookings WHERE artistId=? AND organizerId=? AND eventName=? AND date=? AND status='Pending'").get(artistId,req.user.id,eventName,date))return res.status(409).json({error:'This enquiry was already submitted.'});
 const unavailable=require('../platform/common').conflict(artistId,date+'T00:00:00.000Z',new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString());
 if(unavailable)return res.status(409).json({error:unavailable});
 const artistFeePaise=paise(artist.price);
 const booking={id:id('BK-'),artistId,organizerId:req.user.id,eventName,date,duration,location,notes:notes||"",fee:artist.price,platformFee:0,artistFeePaise,platformFeePaise:0,finalAmountPaise:artistFeePaise,paymentRequired:1,status:'Pending'};
 db.transaction(()=>{db.prepare('INSERT INTO bookings (id,artistId,organizerId,eventName,date,duration,location,notes,fee,platformFee,artistFeePaise,platformFeePaise,finalAmountPaise,paymentRequired,status) VALUES (@id,@artistId,@organizerId,@eventName,@date,@duration,@location,@notes,@fee,@platformFee,@artistFeePaise,@platformFeePaise,@finalAmountPaise,@paymentRequired,@status)').run(booking);db.prepare('INSERT INTO notifications(id,userId,text,kind) VALUES (?,?,?,?)').run(id('nt_'),artist.userId,`New booking request: ${eventName}`,'booking');})();res.status(201).json(booking);
});
router.patch('/:id/status',(req,res)=>{
 const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);if(!b)return res.status(404).json({error:'Booking not found.'});if(!owns(req,b))return res.status(403).json({error:'Access denied.'});
 if(b.workflowVersion===2)return res.status(409).json({error:'Use the quotation workflow in the booking workspace for this enquiry.'});
 const artist=db.prepare('SELECT * FROM artist_profiles WHERE id=?').get(b.artistId);const status=req.body.status;
 const isArtist=artist.userId===req.user.id, isOrganizer=b.organizerId===req.user.id;
 const allowed=(b.status==='Pending'&&isArtist&&['Accepted','Declined'].includes(status))||(['Pending','Accepted','Confirmed'].includes(b.status)&&isOrganizer&&status==='Cancelled')||(b.status==='Confirmed'&&isOrganizer&&status==='Completed'&&b.date<=new Date().toISOString().slice(0,10));
 if(!allowed)return res.status(409).json({error:'This booking status change is not permitted.'});
 let finalArtistFee=b.artistFeePaise;
 if(status==='Accepted'){
  if(req.body.finalPricePaise!==undefined)finalArtistFee=req.body.finalPricePaise;
  if(!Number.isSafeInteger(finalArtistFee)||finalArtistFee<100||finalArtistFee>1000000000)return res.status(400).json({error:'Final artist fee must be integer paise, at least INR 1.00.'});
 }
 db.transaction(()=>{
  if(status==='Accepted')db.prepare('UPDATE bookings SET artistFeePaise=?,finalAmountPaise=?,fee=? WHERE id=?').run(finalArtistFee,finalArtistFee+b.platformFeePaise,finalArtistFee/100,b.id);
  db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,b.id);
  if(status==='Cancelled'){
   const order=require('../payments/service').getOrder(b.id);
   if(order && ['paid','authorized','review_required'].includes(b.paymentStatus))require('../payments/service').flag(order.id,'Booking cancelled with a captured or authorized payment. Review capture/refund status in Razorpay.');
   else db.prepare("UPDATE bookings SET paymentStatus=? WHERE id=? AND paymentStatus!='paid'").run(order?'pending':'cancelled',b.id);
  }
  if(status==='Completed')db.prepare('UPDATE artist_profiles SET bookingsCount=bookingsCount+1 WHERE id=?').run(b.artistId);
  db.prepare('INSERT INTO notifications(id,userId,text,kind) VALUES (?,?,?,?)').run(id('nt_'),isArtist?b.organizerId:artist.userId,`Booking ${b.eventName}: ${status}`,'booking');
 })();
 res.json(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id));
});
module.exports=router;
