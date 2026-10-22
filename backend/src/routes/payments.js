const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { id } = require('../utils/id');
const service = require('../payments/service');
const { configuration } = require('../payments/provider');
const router = express.Router();
const safe = fn => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { await fn(req, res); }
  catch (err) { res.status(err.status || 503).json({ error: err.status ? err.message : 'Razorpay could not be reached. Refresh payment status before retrying.' }); }
};
router.use(requireAuth);
router.get('/history', safe((req, res) => {
  const rows = db.prepare(`SELECT p.*,b.eventName,b.status AS bookingStatus,b.paymentStatus FROM payment_orders p
    JOIN bookings b ON b.id=p.bookingId WHERE p.userId=? ORDER BY p.createdAt DESC`).all(req.user.id);
  res.json(rows.map(p => ({ ...p, transactions: db.prepare('SELECT * FROM payment_transactions WHERE orderId=? ORDER BY createdAt DESC').all(p.id) })));
}));
router.get('/admin/orders', requireRole('admin'), safe((req, res) => {
  const { status, mode, q, page } = req.query;
  const index = Math.max(1, Number.parseInt(page,10) || 1);
  const where = ['1=1'], params = [];
  if (status) { where.push('(p.status=? OR EXISTS(SELECT 1 FROM payment_transactions t WHERE t.orderId=p.id AND t.status=?))'); params.push(status,status); }
  if (mode) { where.push('p.mode=?'); params.push(mode); }
  if (q) { where.push('(p.bookingId LIKE ? OR p.providerOrderId LIKE ? OR p.receipt LIKE ? OR EXISTS(SELECT 1 FROM payment_transactions t WHERE t.orderId=p.id AND t.providerPaymentId LIKE ?))'); params.push(...Array(4).fill('%'+q.slice(0,120)+'%')); }
  const sql = `FROM payment_orders p JOIN bookings b ON b.id=p.bookingId WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...params).n;
  const rows = db.prepare(`SELECT p.*,b.eventName,b.status AS bookingStatus,b.paymentStatus ${sql} ORDER BY p.createdAt DESC LIMIT 25 OFFSET ?`).all(...params,(index-1)*25);
  res.json({ total, page:index, orders:rows.map(p=>({ ...p, transactions:db.prepare('SELECT * FROM payment_transactions WHERE orderId=?').all(p.id),
    reviewLog:db.prepare('SELECT note,adminId,createdAt FROM payment_review_log WHERE orderId=? ORDER BY createdAt DESC').all(p.id) })) });
}));
router.post('/admin/bookings/:id/reconcile', requireRole('admin'), safe(async(req,res)=>{
  if (!service.getOrder(req.params.id)) throw service.fail(404,'Payment order not found.');
  await service.reconcile(req.app,req.params.id);
  res.json(service.snapshot(req.params.id));
}));
router.post('/admin/bookings/:id/review-note', requireRole('admin'), safe((req,res)=>{
  const order=service.getOrder(req.params.id), note=req.body.note;
  if (!order) throw service.fail(404,'Payment order not found.');
  if (typeof note!=='string' || note.trim().length<5 || note.length>2000) throw service.fail(400,'Enter a review note of 5 to 2000 characters.');
  db.prepare('INSERT INTO payment_review_log(id,orderId,adminId,note) VALUES(?,?,?,?)').run(id('pr_'),order.id,req.user.id,note.trim());
  res.json({ok:true}); // An admin note cannot mark funds paid/refunded or change provider facts.
}));
router.get('/receipts/:id', safe((req,res)=>{
  const transaction=db.prepare('SELECT * FROM payment_transactions WHERE providerPaymentId=?').get(req.params.id);
  if (!transaction || !transaction.capturedAt) throw service.fail(404,'No verified capture receipt is available.');
  const order=db.prepare('SELECT * FROM payment_orders WHERE id=?').get(transaction.orderId);
  service.owner(req.user,order.bookingId);
  const details=service.snapshot(order.bookingId);
  res.json({ receiptReference:order.receipt,bookingId:order.bookingId,eventName:details.booking.eventName,artistName:details.artistName,
    provider:'Razorpay',flow:order.flow,mode:order.mode,providerOrderId:order.providerOrderId,transaction,
    bookingStatus:details.booking.status,paymentStatus:details.booking.paymentStatus,payoutStatus:'Not tracked: receipt of funds is not an artist payout.' });
}));
router.get('/bookings/:id', safe(async(req,res)=>{
  service.owner(req.user,req.params.id);
  let warning=null;
  if(service.getOrder(req.params.id)){
    try{await service.reconcile(req.app,req.params.id);}catch(err){warning=err.status?err.message:'Provider status could not be refreshed. Saved status is shown; do not pay again until reconciliation completes.';}
  }
  res.json({...service.snapshot(req.params.id),warning});
}));
router.post('/bookings/:id/order', safe(async(req,res)=>{
  if(Object.keys(req.body).length)throw service.fail(400,'Do not submit amounts, currency or payment identifiers. The server uses the saved booking quote.');
  res.json(await service.initiate(req.app,req.user,req.params.id));
}));
router.post('/bookings/:id/verify', safe(async(req,res)=>{
  await service.verifyCheckout(req.app,req.user,req.params.id,req.body);
  res.json(service.snapshot(req.params.id));
}));
router.post('/bookings/:id/session', safe(async(req,res)=>{
  service.owner(req.user,req.params.id);
  if(!['dismissed','timeout'].includes(req.body.action))throw service.fail(400,'Invalid Checkout session event.');
  db.prepare('UPDATE payment_orders SET sessionState=?,updatedAt=datetime(\'now\') WHERE bookingId=?').run(req.body.action,req.params.id);
  // This records UI abandonment only. It never changes the provider payment state.
  res.json(service.snapshot(req.params.id));
}));
router.post('/bookings/:id/reconcile', safe(async(req,res)=>{
  service.owner(req.user,req.params.id);
  await service.reconcile(req.app,req.params.id);
  res.json(service.snapshot(req.params.id));
}));
router.get('/configuration', (req,res)=>{const c=configuration();res.json({enabled:c.enabled,mode:c.mode,upiFlow:'standard_checkout',dedicatedQrEnabled:false});});
module.exports = router;
