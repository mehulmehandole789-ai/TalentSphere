const crypto = require('node:crypto');
const db = require('../db');
function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function validEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function findUser(email) { return db.prepare('SELECT * FROM users WHERE LOWER(TRIM(email))=?').get(normalizeEmail(email)); }
function authError(status, code, message, details = {}) { return Object.assign(new Error(message), {status, code, details}); }
const limited = db.transaction((scope, subject, maximum, windowMs) => {
 const now=Date.now(), row=db.prepare('SELECT * FROM auth_rate_limits WHERE scope=? AND subject=?').get(scope,subject);
 if (!row || row.resetsAt<=now) {
  db.prepare('INSERT INTO auth_rate_limits(scope,subject,count,resetsAt) VALUES(?,?,1,?) ON CONFLICT(scope,subject) DO UPDATE SET count=1,resetsAt=excluded.resetsAt').run(scope,subject,now+windowMs);
 } else {
  if(row.count>=maximum) return Math.ceil((row.resetsAt-now)/1000);
  db.prepare('UPDATE auth_rate_limits SET count=count+1 WHERE scope=? AND subject=?').run(scope,subject);
 }
 db.prepare('DELETE FROM auth_rate_limits WHERE resetsAt<?').run(now);
 return 0;
});
function rateLimit(scope, maximum, windowMs) {
 return (req,res,next)=>{
  // Store only a one-way fingerprint of the IP, never an address or verification code.
  const subject=crypto.createHash('sha256').update(req.ip||'unknown').digest('hex');
  const retryAfter=limited(scope,subject,maximum,windowMs);
  if(retryAfter)return res.status(429).set('Retry-After',String(retryAfter)).json({error:'Too many '+scope.replaceAll('-',' ')+' attempts. Try again later.',code:'RATE_LIMITED',retryAfterSeconds:retryAfter});
  next();
 };
}
function accountBlock(user) {
 if(user.suspended)return {code:'ACCOUNT_SUSPENDED',message:'Your account is suspended. Contact the administrator.'};
 if(!user.emailVerified)return {code:'EMAIL_UNVERIFIED',message:'Verify your email before logging in.',verificationRequired:true,email:normalizeEmail(user.email)};
 if(user.approvalStatus==='pending')return {code:'APPROVAL_PENDING',message:'Your email is verified. Your account is waiting for administrator approval.'};
 if(user.approvalStatus==='rejected')return {code:'APPROVAL_REJECTED',message:'Your email is verified, but your account approval was rejected. Contact the administrator.'};
 if(!['not_required','approved'].includes(user.approvalStatus))return {code:'ACCOUNT_UNAVAILABLE',message:'Your account needs administrator review.'};
 return null;
}
module.exports={limited,normalizeEmail,validEmail,findUser,authError,rateLimit,accountBlock};
