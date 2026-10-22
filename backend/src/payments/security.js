const crypto = require('node:crypto');
function paise(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Object.assign(new Error('Enter an INR amount with no more than two decimal places.'), { status: 400 });
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result < 0 || result > 1000000000) throw Object.assign(new Error('Invalid INR amount.'), { status: 400 });
  return result;
}
function verifyHmac(message, signature, secret) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature) || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(message).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
module.exports = { paise, verifyHmac };
