const db = require('../db');
const { id } = require('../utils/id');
const { configuration, client } = require('./provider');
const { verifyHmac } = require('./security');
const crypto = require('node:crypto');
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const getOrder = bookingId => db.prepare('SELECT * FROM payment_orders WHERE bookingId=?').get(bookingId);
const getBooking = bookingId => db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId);

function owner(user, bookingId) {
  const booking = getBooking(bookingId);
  if (!booking) throw fail(404, 'Booking not found.');
  if (booking.organizerId !== user.id) throw fail(403, 'Only the booking owner can access private payment details.');
  return booking;
}
function compatible(order) {
  const config = configuration();
  if (order.mode !== config.mode || order.keyId !== config.keyId) {
    throw fail(409, 'This order belongs to different Razorpay keys or mode. Ask an administrator to reconcile it using the original account keys.');
  }
}
const flag = db.transaction((orderId, reason) => {
  db.prepare("UPDATE payment_orders SET status='review_required',reviewReason=?,updatedAt=? WHERE id=?").run(reason, now(), orderId);
  const order = db.prepare('SELECT * FROM payment_orders WHERE id=?').get(orderId);
  db.prepare("UPDATE bookings SET paymentStatus='review_required' WHERE id=?").run(order.bookingId);
});
function validateOrder(local, remote) {
  return remote && remote.id && remote.amount === local.amountPaise && remote.currency === 'INR' &&
    remote.receipt === local.receipt && remote.notes?.bookingId === local.bookingId &&
    remote.notes?.paymentRecordId === local.id && (!local.providerOrderId || remote.id === local.providerOrderId);
}

// Every provider observation is applied in one short database transaction. Never await inside it.
const saveObservation = db.transaction((localId, remoteOrder, payment) => {
  const order = db.prepare('SELECT * FROM payment_orders WHERE id=?').get(localId);
  const booking = getBooking(order.bookingId);
  if (!validateOrder(order, remoteOrder) || payment.order_id !== remoteOrder.id ||
      payment.amount !== order.amountPaise || payment.currency !== 'INR' ||
      booking.finalAmountPaise !== order.amountPaise || !/^pay_[A-Za-z0-9]+$/.test(payment.id || '')) {
    flag(order.id, 'Provider amount, currency or booking association does not match the saved order.');
    return;
  }
  if (!['created', 'authorized', 'captured', 'failed', 'refunded'].includes(payment.status)) return;
  if (payment.status === 'captured' && payment.captured !== true) {
    flag(order.id, 'Provider reported capture inconsistently. Manual reconciliation is required.');
    return;
  }
  const existing = db.prepare('SELECT * FROM payment_transactions WHERE providerPaymentId=?').get(payment.id);
  if (existing && existing.orderId !== order.id) {
    flag(order.id, 'A provider payment identifier is already associated with another booking.');
    return;
  }
  const rank = { created: 0, failed: 1, authorized: 2, captured: 3, partially_refunded: 4, refunded: 5 };
  const refunded = Number.isSafeInteger(payment.amount_refunded) ? payment.amount_refunded : 0;
  if (refunded < 0 || refunded > order.amountPaise) { flag(order.id, 'Provider refund amount is invalid.'); return; }
  let status = refunded === order.amountPaise ? 'refunded' : refunded > 0 ? 'partially_refunded' : payment.status;
  // Old authorized/failed events must never reverse a captured or refunded observation.
  if (existing && rank[existing.status] > rank[status]) status = existing.status;
  const capturedAt = existing?.capturedAt || (['captured', 'partially_refunded', 'refunded'].includes(status) ? now() : null);
  const failureCode = status === 'failed' && /^[A-Z0-9_]{1,80}$/.test(payment.error_code || '') ? payment.error_code : null;
  db.prepare(`INSERT INTO payment_transactions
    (providerPaymentId,orderId,amountPaise,currency,status,method,refundedPaise,failureCode,failureMessage,providerCreatedAt,capturedAt)
    VALUES(@providerPaymentId,@orderId,@amountPaise,'INR',@status,@method,@refundedPaise,@failureCode,@failureMessage,@providerCreatedAt,@capturedAt)
    ON CONFLICT(providerPaymentId) DO UPDATE SET status=excluded.status,method=excluded.method,
    refundedPaise=MAX(payment_transactions.refundedPaise,excluded.refundedPaise),failureCode=excluded.failureCode,
    failureMessage=excluded.failureMessage,capturedAt=COALESCE(payment_transactions.capturedAt,excluded.capturedAt),updatedAt=datetime('now')`).run({
      providerPaymentId: payment.id, orderId: order.id, amountPaise: order.amountPaise, status,
      method: /^[a-z_]{1,30}$/.test(payment.method || '') ? payment.method : null,
      refundedPaise: refunded, failureCode,
      failureMessage: status === 'failed' ? 'Razorpay reported this payment attempt as failed.' : null,
      providerCreatedAt: Number.isSafeInteger(payment.created_at) ? payment.created_at : null, capturedAt
    });
  const transactions = db.prepare('SELECT * FROM payment_transactions WHERE orderId=?').all(order.id);
  const received = transactions.filter(t => t.capturedAt);
  if (received.length > 1) { flag(order.id, 'Multiple captured payments detected. Review and refund any duplicate in Razorpay.'); return; }
  if (order.reviewReason) return; // Exceptions require explicit admin review, never auto-confirm.
  let paymentStatus = transactions.some(t => t.status === 'authorized') ? 'authorized' : transactions.some(t => t.status === 'failed') ? 'failed' : 'pending';
  if (received.length) {
    const paid = received[0];
    paymentStatus = paid.status === 'captured' ? 'paid' : paid.status;
    if (['Cancelled', 'Declined'].includes(booking.status)) {
      flag(order.id, 'Payment captured after a booking was cancelled or declined. Review/refund in Razorpay; the booking stays cancelled.'); return;
    }
    if (!['Accepted', 'Confirmed', 'Completed'].includes(booking.status)) {
      flag(order.id, 'Payment arrived outside the accepted booking lifecycle.'); return;
    }
    if (paymentStatus === 'paid' && booking.status === 'Accepted') {
      db.prepare("UPDATE bookings SET status='Confirmed' WHERE id=? AND status='Accepted'").run(booking.id);
      const artist = db.prepare('SELECT userId FROM artist_profiles WHERE id=?').get(booking.artistId);
      for (const userId of [booking.organizerId, artist?.userId].filter(Boolean)) {
        db.prepare('INSERT INTO notifications(id,userId,text,kind) VALUES(?,?,?,?)').run(id('nt_'), userId, `Payment captured: booking ${booking.eventName} confirmed. Artist payout is not recorded.`, 'booking');
      }
    } else if (paymentStatus !== 'paid') {
      flag(order.id, 'Payment was refunded or partially refunded. Review the booking and refund in the Razorpay Dashboard.'); return;
    }
  }
  db.prepare('UPDATE bookings SET paymentStatus=? WHERE id=?').run(paymentStatus, booking.id);
  db.prepare('UPDATE payment_orders SET status=?,updatedAt=?,reconciledAt=? WHERE id=?').run(
    paymentStatus === 'paid' ? 'captured' : paymentStatus, now(), now(), order.id);
});

async function recoverOrder(app, local) {
  const sdk = client(app);
  compatible(local);
  if (local.providerOrderId) return local;
  // An interrupted request may already have created an order. Never blindly create another.
  const result = await sdk.orders.all({ receipt: local.receipt, count: 100 });
  const matches = (result.items || []).filter(o => o.receipt === local.receipt);
  if (matches.length !== 1 || !validateOrder(local, matches[0])) {
    if (matches.length > 0) flag(local.id, 'Ambiguous or mismatched order creation. Check the Razorpay receipt reference.');
    throw fail(409, 'Order creation is unresolved. An administrator must inspect the Razorpay receipt reference before retrying. No second order was created.');
  }
  db.prepare("UPDATE payment_orders SET providerOrderId=?,status='created',updatedAt=? WHERE id=? AND providerOrderId IS NULL").run(matches[0].id, now(), local.id);
  return getOrder(local.bookingId);
}
async function reconcile(app, bookingId) {
  let local = getOrder(bookingId);
  if (!local) return;
  const sdk = client(app);
  compatible(local);
  if (!local.providerOrderId) {
    if (local.status === 'creating' && Date.now() - Date.parse(local.createdAt + 'Z') < 60000) throw fail(409, 'An order is being prepared. Wait a moment and refresh.');
    local = await recoverOrder(app, local);
  }
  const remote = await sdk.orders.fetch(local.providerOrderId);
  if (!validateOrder(local, remote)) { flag(local.id, 'Provider order does not match the saved booking.'); return; }
  const result = await sdk.orders.fetchPayments(local.providerOrderId);
  // Fetch individually for current state, rather than trusting an old webhook/list snapshot.
  for (const summary of result.items || []) {
    const payment = await sdk.payments.fetch(summary.id);
    saveObservation(local.id, remote, payment);
  }
  db.prepare('UPDATE payment_orders SET reconciledAt=? WHERE id=?').run(now(), local.id);
}
async function initiate(app, user, bookingId) {
  const booking = owner(user, bookingId);
  if (booking.status !== 'Accepted' || !booking.paymentRequired || ['paid','authorized','review_required','refunded','partially_refunded'].includes(booking.paymentStatus)) throw fail(409, 'Only an accepted, unpaid booking can be paid.');
  if (!Number.isSafeInteger(booking.finalAmountPaise) || booking.finalAmountPaise < 100) throw fail(400, 'The saved final price must be at least INR 1.00. Ask the artist to review the quote.');
  const sdk = client(app), config = configuration();
  let local = getOrder(bookingId);
  if (!local) {
    const record = { id: id('po_'), bookingId, userId: user.id, receipt: id('ts_'), keyId: config.keyId, mode: config.mode, amountPaise: booking.finalAmountPaise };
    const result = db.prepare(`INSERT OR IGNORE INTO payment_orders(id,bookingId,userId,receipt,keyId,mode,amountPaise)
      VALUES(@id,@bookingId,@userId,@receipt,@keyId,@mode,@amountPaise)`).run(record);
    local = getOrder(bookingId);
    if (result.changes) {
      try {
        const remote = await sdk.orders.create({ amount: local.amountPaise, currency: 'INR', receipt: local.receipt, partial_payment: false,
          notes: { bookingId, paymentRecordId: local.id } });
        if (!validateOrder(local, remote)) { flag(local.id, 'Created order did not match the booking.'); throw fail(502, 'Provider order mismatch. Contact support.'); }
        db.prepare("UPDATE payment_orders SET providerOrderId=?,status='created',updatedAt=? WHERE id=?").run(remote.id, now(), local.id);
      } catch (err) {
        db.prepare("UPDATE payment_orders SET status='creation_unknown',updatedAt=? WHERE id=? AND status='creating'").run(now(), local.id);
        if (err.status) throw err;
        throw fail(502, 'Razorpay did not confirm order creation. Refresh to reconcile before trying again; no duplicate order will be created.');
      }
    }
  }
  await reconcile(app, bookingId);
  local = getOrder(bookingId);
  const fresh = owner(user, bookingId);
  if (fresh.status !== 'Accepted' || local.reviewReason || ['captured', 'review_required'].includes(local.status)) throw fail(409, 'This booking is paid, cancelled or requires review. Refresh its payment status.');
  db.prepare("UPDATE payment_orders SET sessionState='open',sessionExpiresAt=?,updatedAt=? WHERE id=?").run(Date.now() + 15 * 60 * 1000, now(), local.id);
  return { keyId: config.keyId, orderId: local.providerOrderId, amountPaise: local.amountPaise, currency: 'INR', mode: local.mode,
    bookingId, sessionExpiresAt: getOrder(bookingId).sessionExpiresAt };
}
async function verifyCheckout(app, user, bookingId, body) {
  owner(user, bookingId);
  const local = getOrder(bookingId);
  if (!local?.providerOrderId) throw fail(404, 'No saved payment order exists for this booking.');
  compatible(local);
  if (body.razorpay_order_id !== local.providerOrderId || !/^pay_[A-Za-z0-9]+$/.test(body.razorpay_payment_id || '') ||
      !verifyHmac(`${local.providerOrderId}|${body.razorpay_payment_id}`, body.razorpay_signature, configuration().keySecret)) throw fail(400, 'Invalid Checkout payment signature.');
  const sdk = client(app);
  const [remote, payment] = await Promise.all([sdk.orders.fetch(local.providerOrderId), sdk.payments.fetch(body.razorpay_payment_id)]);
  saveObservation(local.id, remote, payment);
}
function snapshot(bookingId) {
  const booking = getBooking(bookingId), order = getOrder(bookingId);
  const transactions = order ? db.prepare('SELECT * FROM payment_transactions WHERE orderId=? ORDER BY createdAt DESC,providerPaymentId').all(order.id) : [];
  let displayStatus = order && booking.paymentStatus === 'unpaid' ? 'pending' : booking.paymentStatus;
  if (order && !['paid', 'authorized', 'review_required', 'refunded', 'partially_refunded', 'cancelled'].includes(displayStatus)) {
    if (order.sessionState === 'dismissed') displayStatus = 'abandoned';
    else if (order.sessionState === 'timeout' || (order.sessionExpiresAt && order.sessionExpiresAt < Date.now())) displayStatus = 'expired';
  }
  return { booking, order, transactions, displayStatus, mode: order?.mode || configuration().mode, configured: configuration().enabled,
    artistName: db.prepare('SELECT u.name FROM users u JOIN artist_profiles a ON a.userId=u.id WHERE a.id=?').get(booking.artistId)?.name || 'Artist',
    canPay: booking.status === 'Accepted' && booking.paymentRequired === 1 && !order?.reviewReason && !['paid','authorized','refunded','partially_refunded','review_required'].includes(booking.paymentStatus) };
}
async function webhook(app, raw, signature, eventId) {
  const config = configuration();
  if (!config.enabled) throw fail(503, 'Razorpay webhooks are not configured.');
  if (!verifyHmac(raw, signature, config.webhookSecret)) throw fail(400, 'Invalid webhook signature.');
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { throw fail(400, 'Malformed webhook JSON.'); }
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(eventId || '')) throw fail(400, 'A Razorpay event identifier is required.');
  const bodyHash = crypto.createHash('sha256').update(raw).digest('hex');
  const previous = db.prepare('SELECT * FROM payment_webhook_events WHERE eventId=?').get(eventId);
  if (previous && previous.bodyHash !== bodyHash) throw fail(400, 'Webhook event identifier was reused with a different body.');
  if (previous?.status === 'processed') return { duplicate: true };
  db.prepare(`INSERT INTO payment_webhook_events(eventId,eventType,bodyHash) VALUES(?,?,?) ON CONFLICT(eventId)
    DO UPDATE SET attempts=attempts+1,status='processing'`).run(eventId, String(event.event || '').slice(0,100), bodyHash);
  try {
    if (['payment.authorized','payment.captured','payment.failed','order.paid','refund.processed','refund.failed'].includes(event.event)) {
      const paymentId = event.payload?.payment?.entity?.id || event.payload?.refund?.entity?.payment_id;
      const sdk = client(app);
      let remoteOrderId = event.payload?.order?.entity?.id;
      const observedPayment = paymentId ? await sdk.payments.fetch(paymentId) : null;
      if (observedPayment) remoteOrderId = observedPayment.order_id;
      if (remoteOrderId) {
        let local = db.prepare('SELECT * FROM payment_orders WHERE providerOrderId=?').get(remoteOrderId);
        if (!local) {
          const remote = await sdk.orders.fetch(remoteOrderId);
          local = db.prepare('SELECT * FROM payment_orders WHERE receipt=?').get(remote.receipt || '');
          if (local && validateOrder(local, remote)) db.prepare('UPDATE payment_orders SET providerOrderId=? WHERE id=? AND providerOrderId IS NULL').run(remote.id, local.id);
          else local = null; // Unrelated account activity never confirms a TalentSphere booking.
        }
        if (local) {
          compatible(local);
          if (observedPayment) saveObservation(local.id, await sdk.orders.fetch(remoteOrderId), observedPayment);
          await reconcile(app, local.bookingId);
        }
      }
    }
    db.prepare("UPDATE payment_webhook_events SET status='processed',processedAt=? WHERE eventId=?").run(now(), eventId);
  } catch (err) {
    db.prepare("UPDATE payment_webhook_events SET status='retry' WHERE eventId=?").run(eventId);
    throw fail(503, 'Webhook reconciliation is temporarily unavailable. Retry this event.');
  }
  return { ok: true };
}
module.exports = { owner, getOrder, snapshot, initiate, verifyCheckout, reconcile, webhook, flag, fail };
