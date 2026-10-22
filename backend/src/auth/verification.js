const crypto = require('node:crypto');
const db = require('../db');
const {normalizeEmail,findUser,authError} = require('./common');
const {deliver,verificationMessage} = require('./email');
const TTL=10*60*1000, COOLDOWN=60*1000, WINDOW=60*60*1000, MAX_SENDS=5, MAX_ATTEMPTS=5;
function digest(userId,generationId,code){return crypto.createHmac('sha256',process.env.EMAIL_VERIFICATION_SECRET||process.env.JWT_SECRET).update('email-verification|'+userId+'|'+generationId+'|'+code).digest('hex');}
function deliveryDetails(user,row){return {verificationRequired:true,email:normalizeEmail(user.email),resendAvailableAt:row.issuedAt+COOLDOWN,resendAfterSeconds:Math.max(0,Math.ceil((row.issuedAt+COOLDOWN-Date.now())/1000)),expiresInSeconds:600};}
const reserve=db.transaction((user,code)=>{
 const now=Date.now(),previous=db.prepare('SELECT * FROM email_verifications WHERE userId=?').get(user.id);
 if(previous&&now-previous.issuedAt<COOLDOWN)throw authError(429,'RESEND_COOLDOWN','Wait 60 seconds between code requests.',deliveryDetails(user,previous));
 const windowStartedAt=previous&&now-previous.windowStartedAt<WINDOW?previous.windowStartedAt:now;
 const sendCount=windowStartedAt===previous?.windowStartedAt?previous.sendCount+1:1;
 if(sendCount>MAX_SENDS)throw authError(429,'RESEND_LIMIT','The hourly code request limit has been reached. Try again later.',{verificationRequired:true,email:normalizeEmail(user.email),retryAfterSeconds:Math.ceil((windowStartedAt+WINDOW-now)/1000)});
 const generationId=crypto.randomBytes(24).toString('hex');
 db.prepare(`INSERT INTO email_verifications(userId,generationId,codeHash,expiresAt,attempts,deliveryStatus,issuedAt,windowStartedAt,sendCount)
 VALUES(?,?,?,?,0,'delivering',?,?,?) ON CONFLICT(userId) DO UPDATE SET generationId=excluded.generationId,codeHash=excluded.codeHash,
 expiresAt=excluded.expiresAt,attempts=0,deliveryStatus='delivering',issuedAt=excluded.issuedAt,windowStartedAt=excluded.windowStartedAt,sendCount=excluded.sendCount,consumedAt=NULL`)
 .run(user.id,generationId,digest(user.id,generationId,code),now+TTL,now,windowStartedAt,sendCount);
 return db.prepare('SELECT * FROM email_verifications WHERE userId=?').get(user.id);
});
async function sendCode(app,user){
 if(user.emailVerified)return {verificationRequired:false,emailSent:false,message:'Use login to continue. No new verification code was issued.'};
 const code=crypto.randomInt(0,1000000).toString().padStart(6,'0');
 const challenge=reserve(user,code);
 try{
  const delivery=await deliver(app,verificationMessage(user,code));
  const result=db.prepare("UPDATE email_verifications SET deliveryStatus=? WHERE userId=? AND generationId=? AND consumedAt IS NULL").run(delivery,user.id,challenge.generationId);
  if(!result.changes)throw authError(409,'CODE_REPLACED','A newer code has replaced this request. Use the latest code.');
  return {...deliveryDetails(user,challenge),emailSent:delivery==='smtp',delivery,
   message:delivery==='smtp'?'Verification email accepted for delivery. Check your inbox and spam folder.':delivery==='development_preview'?'Development-only email preview saved. No email was sent. Open the local preview to read your code.':'Automated test transport accepted the verification message. No real email was sent.'};
 }catch(error){
  db.prepare("UPDATE email_verifications SET codeHash=NULL,deliveryStatus='failed' WHERE userId=? AND generationId=?").run(user.id,challenge.generationId);
  const err=error.status?error:authError(502,'EMAIL_DELIVERY_FAILED','Email delivery could not be confirmed. Your account is saved; request a new code after the cooldown.');
  err.details={...err.details,...deliveryDetails(user,challenge),emailSent:false};
  throw err;
 }
}
// Returned errors are thrown AFTER commit, so failed guesses cannot roll back the attempt counter.
const consume=db.transaction((email,code)=>{
 const user=findUser(email),row=user&&db.prepare('SELECT * FROM email_verifications WHERE userId=?').get(user.id);
 if(!user||!row)return authError(400,'INVALID_CODE','The code is incorrect or unavailable. Request a new code.');
 if(user.emailVerified||row.consumedAt)return authError(409,'CODE_USED','This code was already used. Log in to continue.');
 if(!['smtp','development_preview','test_transport'].includes(row.deliveryStatus)||!row.codeHash)return authError(400,'CODE_UNAVAILABLE','No delivered code is active. Request a new code.');
 if(row.expiresAt<=Date.now())return authError(400,'CODE_EXPIRED','This code has expired. Request a new code.');
 if(row.attempts>=MAX_ATTEMPTS)return authError(429,'CODE_ATTEMPTS_EXCEEDED','Too many incorrect codes. Request a replacement after the resend cooldown.');
 const expected=Buffer.from(row.codeHash,'hex'),actual=Buffer.from(digest(user.id,row.generationId,code),'hex');
 if(!crypto.timingSafeEqual(expected,actual)){
  db.prepare('UPDATE email_verifications SET attempts=attempts+1 WHERE userId=? AND generationId=?').run(user.id,row.generationId);
  const left=MAX_ATTEMPTS-row.attempts-1;
  return authError(left?400:429,left?'INVALID_CODE':'CODE_ATTEMPTS_EXCEEDED',left?'The code is incorrect. Check the latest email.':'Too many incorrect codes. Request a replacement after the cooldown.',{attemptsRemaining:left});
 }
 const updated=db.prepare("UPDATE email_verifications SET codeHash=NULL,consumedAt=?,deliveryStatus='consumed' WHERE userId=? AND generationId=? AND consumedAt IS NULL").run(Date.now(),user.id,row.generationId);
 if(updated.changes!==1)return authError(409,'CODE_USED','This code has already been used.');
 db.prepare("UPDATE users SET emailVerified=1,emailVerifiedAt=?,tokenVersion=tokenVersion+1 WHERE id=? AND emailVerified=0").run(new Date().toISOString(),user.id);
 return {message:'Your email is verified. Log in to continue.',emailVerified:true};
});
function verifyCode(email,code){
 if(typeof code!=='string'||!/^\d{6}$/.test(code))throw authError(400,'INVALID_CODE_FORMAT','Enter the six-digit code from your latest email.');
 const result=consume(email,code);if(result instanceof Error)throw result;return result;
}
module.exports={sendCode,verifyCode,TTL,COOLDOWN,MAX_SENDS,MAX_ATTEMPTS};
