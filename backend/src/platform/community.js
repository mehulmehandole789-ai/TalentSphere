const express=require('express');
const C=require('./common'),{db,id,safe,fail,text,amount,artist,visible,booking}=C;
const {requireAuth,requireRole}=require('../middleware/auth');
const {rateLimit}=require('../auth/common');
const router=express.Router();
router.get('/board',safe((req,res)=>{
 const page=Math.max(1,parseInt(req.query.page,10)||1),q=String(req.query.q||'').toLowerCase();
 const rows=db.prepare("SELECT p.*,u.name AS artistName FROM collaboration_posts p JOIN artist_profiles a ON a.id=p.artistId JOIN users u ON u.id=a.userId WHERE a.visibility='public' AND a.moderationHidden=0 AND u.suspended=0 AND u.approvalStatus NOT IN ('pending','rejected') ORDER BY p.createdAt DESC").all().filter(p=>!q||[p.title,p.requiredSkill,p.genre,p.location].join(' ').toLowerCase().includes(q));
 res.json({total:rows.length,page,posts:rows.slice((page-1)*20,page*20).map(p=>({...p,applications:req.user?.id===db.prepare('SELECT userId FROM artist_profiles WHERE id=?').get(p.artistId).userId?db.prepare('SELECT e.*,u.name AS applicantName FROM collaboration_entries e JOIN artist_profiles a ON a.id=e.artistId JOIN users u ON u.id=a.userId WHERE e.postId=?').all(p.id):[],myApplication:req.user?db.prepare('SELECT e.* FROM collaboration_entries e JOIN artist_profiles a ON a.id=e.artistId WHERE e.postId=? AND a.userId=?').get(p.id,req.user.id)||null:null}))});
}));
router.post('/board',requireRole('artist'),rateLimit('board-post',20,3600000),safe((req,res)=>{
 const a=artist(req.user),b=req.body,deadline=C.iso(b.deadline);if(Date.parse(deadline)<=Date.now())throw fail(400,'Choose a future deadline.');
 const p={id:id('post_'),artistId:a.id,title:text(b.title,'Title',3,150),description:text(b.description,'Description',10,4000),requiredSkill:text(b.requiredSkill,'Required skill',2,100),genre:text(b.genre||'','Genre',0,100),location:b.remote?'Remote':text(b.location,'Location',2,150),remote:b.remote?1:0,deadline,paid:b.paid?1:0,budgetPaise:b.paid?amount(b.budgetPaise,'Budget',100):null};
 db.prepare('INSERT INTO collaboration_posts(id,artistId,title,description,requiredSkill,genre,location,remote,deadline,paid,budgetPaise) VALUES(@id,@artistId,@title,@description,@requiredSkill,@genre,@location,@remote,@deadline,@paid,@budgetPaise)').run(p);res.status(201).json(p);
}));
router.patch('/board/:id',requireRole('artist'),safe((req,res)=>{const a=artist(req.user),r=db.prepare('UPDATE collaboration_posts SET closed=1 WHERE id=? AND artistId=?').run(req.params.id,a.id);if(!r.changes)throw fail(404,'Opportunity not found.');res.json({ok:true});}));
router.post('/board/:id/apply',requireRole('artist'),rateLimit('board-apply',40,3600000),safe((req,res)=>{
 const a=artist(req.user),p=db.prepare('SELECT * FROM collaboration_posts WHERE id=?').get(req.params.id);if(!p)throw fail(404,'Opportunity not found.');visible(p.artistId,req.user);if(p.artistId===a.id||p.closed||Date.parse(p.deadline)<=Date.now())throw fail(409,'This opportunity is not open for your application.');if(db.prepare('SELECT id FROM collaboration_entries WHERE postId=? AND artistId=?').get(p.id,a.id))throw fail(409,'You already applied.');
 db.transaction(()=>{db.prepare('INSERT INTO collaboration_entries(id,postId,artistId,message) VALUES(?,?,?,?)').run(id('entry_'),p.id,a.id,text(req.body.message,'Application',5,2000));C.notify(db.prepare('SELECT userId FROM artist_profiles WHERE id=?').get(p.artistId).userId,null,'New application: '+p.title);}).immediate();res.status(201).json({ok:true});
}));
router.patch('/board/entries/:id',requireRole('artist'),safe((req,res)=>{
 const a=artist(req.user),e=db.prepare('SELECT e.*,p.artistId AS owner,p.title FROM collaboration_entries e JOIN collaboration_posts p ON p.id=e.postId WHERE e.id=?').get(req.params.id);if(!e||e.owner!==a.id)throw fail(403,'Only the opportunity owner can respond.');if(e.status!=='Pending'||!['Accepted','Declined'].includes(req.body.status))throw fail(409,'Invalid application transition.');
 db.transaction(()=>{db.prepare('UPDATE collaboration_entries SET status=? WHERE id=?').run(req.body.status,e.id);C.notify(db.prepare('SELECT userId FROM artist_profiles WHERE id=?').get(e.artistId).userId,null,'Collaboration '+e.title+': '+req.body.status);}).immediate();res.json({ok:true});
}));
router.get('/saved',requireAuth,safe((req,res)=>res.json(db.prepare("SELECT s.artistId FROM saved_artists s JOIN artist_profiles a ON a.id=s.artistId WHERE s.userId=? AND a.visibility='public'").all(req.user.id).map(v=>v.artistId))));
router.post('/saved/:id',requireRole('organizer'),safe((req,res)=>{visible(req.params.id,req.user);db.prepare('INSERT OR IGNORE INTO saved_artists(userId,artistId) VALUES(?,?)').run(req.user.id,req.params.id);res.json({ok:true});}));
router.delete('/saved/:id',requireAuth,safe((req,res)=>{db.prepare('DELETE FROM saved_artists WHERE userId=? AND artistId=?').run(req.user.id,req.params.id);res.json({ok:true});}));
router.get('/ledger',requireAuth,safe((req,res)=>{
 const rows=db.prepare('SELECT p.id,p.bookingId,p.mode,p.providerOrderId,p.receipt,b.eventName,b.status AS bookingStatus,b.paymentStatus FROM payment_orders p JOIN bookings b ON b.id=p.bookingId JOIN artist_profiles a ON a.id=b.artistId WHERE b.organizerId=? OR a.userId=? ORDER BY p.createdAt DESC').all(req.user.id,req.user.id).map(p=>({...p,transactions:db.prepare('SELECT providerPaymentId,amountPaise,status,refundedPaise,capturedAt FROM payment_transactions WHERE orderId=?').all(p.id)}));
 const totals=['test','live'].map(mode=>{const transactions=rows.filter(p=>p.mode===mode).flatMap(p=>p.transactions);return {mode,capturedPaise:transactions.filter(t=>t.capturedAt).reduce((s,t)=>s+t.amountPaise,0),refundedPaise:transactions.reduce((s,t)=>s+t.refundedPaise,0),pendingPaise:db.prepare("SELECT COALESCE(SUM(finalAmountPaise),0) n FROM bookings b JOIN artist_profiles a ON a.id=b.artistId WHERE (b.organizerId=? OR a.userId=?) AND b.status IN ('Accepted','Payment Pending') AND b.paymentStatus NOT IN ('paid','refunded','partially_refunded') AND EXISTS(SELECT 1 FROM payment_orders p WHERE p.bookingId=b.id AND p.mode=?)").get(req.user.id,req.user.id,mode).n};});
 res.json({orders:rows,totals});
}));
router.get('/receipts/:id',requireAuth,safe((req,res)=>{
 const t=db.prepare('SELECT t.*,p.bookingId,p.receipt,p.providerOrderId,p.mode FROM payment_transactions t JOIN payment_orders p ON p.id=t.orderId WHERE t.providerPaymentId=?').get(req.params.id);if(!t?.capturedAt)throw fail(404,'A verified payment receipt is not available.');const b=booking(req.user,t.bookingId);
 res.set('Content-Disposition','attachment; filename="TalentSphere-'+t.providerPaymentId+'.txt"');res.type('text/plain').send(['TalentSphere payment receipt',t.mode.toUpperCase()+' MODE', 'Receipt: '+t.receipt,'Booking: '+b.id,'Event: '+b.eventName,'Provider: Razorpay','Order: '+t.providerOrderId,'Payment: '+t.providerPaymentId,'Captured: '+t.capturedAt,'Amount: INR '+(t.amountPaise/100).toFixed(2),'Refunded: INR '+(t.refundedPaise/100).toFixed(2),'Provider status: '+t.status,'Booking status: '+b.status,'This receipt does not record an artist payout.'].join('\n'));
}));
router.post('/reports',requireAuth,rateLimit('content-report',10,3600000),safe((req,res)=>{
 const {targetType,targetId}=req.body;if(targetType==='profile')visible(targetId,req.user);else if(targetType==='review'){if(!db.prepare('SELECT id FROM reviews WHERE id=? AND bookingId IS NOT NULL AND hidden=0').get(targetId))throw fail(404,'Review not found.');}else throw fail(400,'Choose a profile or review.');
 db.prepare('INSERT INTO moderation_reports(id,reporterId,targetType,targetId,reason) VALUES(?,?,?,?,?)').run(id('report_'),req.user.id,targetType,targetId,text(req.body.reason,'Report reason',10,2000));res.status(201).json({ok:true});
}));
router.get('/moderation',requireRole('admin'),safe((req,res)=>{
 const page=Math.max(1,parseInt(req.query.page,10)||1),status=req.query.status||'open',q='%'+String(req.query.q||'').slice(0,100)+'%',where='WHERE (? = \'all\' OR status=?) AND (reason LIKE ? OR targetId LIKE ?)';
 res.json({page,total:db.prepare('SELECT COUNT(*) n FROM moderation_reports '+where).get(status,status,q,q).n,reports:db.prepare('SELECT * FROM moderation_reports '+where+' ORDER BY createdAt DESC LIMIT 20 OFFSET ?').all(status,status,q,q,(page-1)*20),audit:db.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT 50 OFFSET ?').all((page-1)*50),delivery:db.prepare("SELECT status,COUNT(*) count FROM notification_outbox GROUP BY status").all()});
}));
router.get('/admin/artists',requireRole('admin'),safe((req,res)=>{
 const page=Math.max(1,parseInt(req.query.page,10)||1),q='%'+String(req.query.q||'').slice(0,100)+'%',approval=req.query.approval||'all';
 const where="FROM artist_profiles a JOIN users u ON u.id=a.userId WHERE (u.name LIKE ? OR a.location LIKE ? OR a.category LIKE ?) AND (?='all' OR u.approvalStatus=?)",params=[q,q,q,approval,approval];
 res.json({page,total:db.prepare('SELECT COUNT(*) n '+where).get(...params).n,artists:db.prepare('SELECT a.id,a.userId,u.name,u.approvalStatus,a.visibility,a.moderationHidden,a.verified,a.category,a.location '+where+' ORDER BY u.createdAt DESC LIMIT 20 OFFSET ?').all(...params,(page-1)*20).map(a=>({...a,verification:db.prepare('SELECT details,createdAt,revoked FROM artist_verifications WHERE artistId=? ORDER BY id DESC LIMIT 1').get(a.id)||null}))});
}));
router.post('/admin/restore',requireRole('admin'),safe((req,res)=>{
 const {targetType,targetId}=req.body,note=text(req.body.note,'Restoration reason',5,2000);
 db.transaction(()=>{if(targetType==='profile'){if(!db.prepare('SELECT id FROM artist_profiles WHERE id=?').get(targetId))throw fail(404,'Profile not found.');db.prepare("UPDATE artist_profiles SET moderationHidden=0,visibility='public' WHERE id=?").run(targetId);}else if(targetType==='review'){if(!db.prepare('SELECT id FROM reviews WHERE id=?').get(targetId))throw fail(404,'Review not found.');db.prepare('UPDATE reviews SET hidden=0 WHERE id=?').run(targetId);}else throw fail(400,'Invalid content type.');db.prepare('INSERT INTO admin_audit(adminId,action,targetId,note) VALUES(?,?,?,?)').run(req.user.id,'content.restore',targetId,note);}).immediate();res.json({ok:true});
}));
router.post('/moderation/:id',requireRole('admin'),safe((req,res)=>{
 const report=db.prepare('SELECT * FROM moderation_reports WHERE id=?').get(req.params.id);if(!report)throw fail(404,'Report not found.');if(report.status!=='open'||!['hide','dismiss'].includes(req.body.action))throw fail(409,'Report is already resolved or action is invalid.');const note=text(req.body.note,'Moderation explanation',5,2000);
 db.transaction(()=>{if(req.body.action==='hide'){if(report.targetType==='review')db.prepare('UPDATE reviews SET hidden=1 WHERE id=?').run(report.targetId);else db.prepare("UPDATE artist_profiles SET visibility='private',moderationHidden=1 WHERE id=?").run(report.targetId);}
 db.prepare("UPDATE moderation_reports SET status='resolved',resolution=? WHERE id=?").run(note,report.id);db.prepare('INSERT INTO admin_audit(adminId,action,targetId,note) VALUES(?,?,?,?)').run(req.user.id,'report.'+req.body.action,report.targetId,note);}).immediate();res.json({ok:true});
}));
router.post('/verification/:id/revoke',requireRole('admin'),safe((req,res)=>{
 db.transaction(()=>{db.prepare('UPDATE artist_profiles SET verified=0 WHERE id=?').run(req.params.id);db.prepare('UPDATE artist_verifications SET revoked=1 WHERE artistId=?').run(req.params.id);db.prepare('INSERT INTO admin_audit(adminId,action,targetId,note) VALUES(?,?,?,?)').run(req.user.id,'artist.verification.revoke',req.params.id,text(req.body.note,'Reason',5,2000));}).immediate();res.json({ok:true});
}));
module.exports=router;
