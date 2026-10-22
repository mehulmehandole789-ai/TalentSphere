const Razorpay = require('razorpay');

function configuration() {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const mode = process.env.RAZORPAY_MODE || 'test';
  if (!['test', 'live'].includes(mode)) throw new Error('RAZORPAY_MODE must be test or live.');
  const values = [keyId, keySecret, webhookSecret];
  if (values.some(Boolean) && !values.every(Boolean)) {
    throw new Error('Configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET together, or leave all unset.');
  }
  if (keyId && !keyId.startsWith(`rzp_${mode}_`)) throw new Error('Razorpay key ID must match RAZORPAY_MODE. Start with Test Mode keys.');
  return { keyId, keySecret, webhookSecret, mode, enabled: values.every(Boolean) };
}
function client(app) {
  const config = configuration();
  if (!config.enabled) {
    const err = new Error('Payments are unavailable until the administrator configures Razorpay Test Mode keys and a webhook secret.');
    err.status = 503;
    throw err;
  }
  // Injection is only accessible to in-process automated tests, never from HTTP.
  return app.locals.razorpay || new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
}
module.exports = { configuration, client };
