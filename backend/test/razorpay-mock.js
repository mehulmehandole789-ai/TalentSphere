// MOCK PROVIDER ONLY. No network calls and no real money movement.
const crypto = require('node:crypto');
function createMock() {
  const orders = new Map(), payments = new Map();
  let sequence = 0, createCalls = 0, failCreate = false, offline = false;
  const check = () => { if (offline) throw new Error('Mock provider offline'); };
  const sdk = {
    orders: {
      async create(body) {
        check(); createCalls++;
        const order = { ...structuredClone(body), id:'order_Mock'+(++sequence), status:'created', amount_paid:0, amount_due:body.amount };
        orders.set(order.id,order);
        if(failCreate)throw new Error('Mock connection lost after remote creation');
        return structuredClone(order);
      },
      async fetch(id) { check(); if(!orders.has(id))throw new Error('Mock order not found'); return structuredClone(orders.get(id)); },
      async all({receipt}) { check(); return {items:[...orders.values()].filter(o=>o.receipt===receipt).map(o=>structuredClone(o))}; },
      async fetchPayments(id) { check(); return {items:[...payments.values()].filter(p=>p.order_id===id).map(p=>({id:p.id}))}; }
    },
    payments: { async fetch(id) { check(); if(!payments.has(id))throw new Error('Mock payment not found');return structuredClone(payments.get(id)); } }
  };
  function pay(orderId,status='captured',overrides={}) {
    const order=orders.get(orderId);
    const payment={id:'pay_Mock'+(++sequence),order_id:orderId,amount:order.amount,currency:'INR',status,captured:status==='captured',amount_refunded:0,method:'upi',created_at:Math.floor(Date.now()/1000),...overrides};
    payments.set(payment.id,payment);
    if(payment.status==='captured'){order.status='paid';order.amount_paid=payment.amount;order.amount_due=0;}
    return structuredClone(payment);
  }
  return {sdk,orders,payments,pay,get createCalls(){return createCalls;},set failCreate(v){failCreate=v;},set offline(v){offline=v;},
    signature(orderId,paymentId){return crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(orderId+'|'+paymentId).digest('hex');}};
}
module.exports={createMock};
