const express=require('express'),bcrypt=require('bcryptjs'),crypto=require('node:crypto');
const db=require('../db'),{id}=require('../utils/id');
const {signToken,requireAuth}=require('../middleware/auth');
const {publicUser,artistOut}=require('../utils/serialize');
const {normalizeEmail,validEmail,findUser,authError,rateLimit,accountBlock}=require('../auth/common');
const {sendCode,verifyCode}=require('../auth/verification');
const {deliver}=require('../auth/email');
const router=express.Router();
const dummyHash=bcrypt.hashSync(crypto.randomBytes(32).toString('hex'),10);
const safe=handler=>async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{await handler(req,res);}catch(err){
  const details=err.details||{},retry=details.resendAfterSeconds||details.retryAfterSeconds;
  if(retry)res.set('Retry-After',String(retry));
  res.status(err.status||500).json({error:err.status?err.message:'Authentication could not be completed. Please try again.',code:err.code||'AUTH_UNAVAILABLE',...details});
 }
};
router.post('/register',rateLimit('registration',10,15*60*1000),safe(async(req,res)=>{
 const {name,password,role,location,category}=req.body,email=normalizeEmail(req.body.email);
 if(typeof name!=='string'||!name.trim()||name.length>120||!validEmail(email)||typeof password!=='string')throw authError(400,'INVALID_REGISTRATION','Enter your name, a valid email address and a password.');
 if(!['artist','organizer'].includes(role))throw authError(400,'INVALID_ROLE','Choose artist or organizer.');
 if(password.length<8||Buffer.byteLength(password)>72)throw authError(400,'PASSWORD_POLICY','Password must have at least 8 characters and no more than 72 UTF-8 bytes.');
 function resume(existing){
  if(existing.emailVerified)throw authError(409,'ACCOUNT_EXISTS','An account with this email already exists. Log in or reset your password.');
  const row=db.prepare('SELECT issuedAt FROM email_verifications WHERE userId=?').get(existing.id);
  return {verificationRequired:true,email,emailSent:false,resumed:true,resendAvailableAt:row?row.issuedAt+60000:Date.now(),message:'This account is waiting for email verification. Use the latest code or request a new one. The existing password was not changed.'};
 }
 const existing=findUser(email);if(existing)return res.status(202).json(resume(existing));
 const passwordHash=await bcrypt.hash(password,10);
 const saved=db.transaction(()=>{
  const duplicate=findUser(email);if(duplicate)return {existing:duplicate};
  const userId=id('u_');
  const approvalStatus=(role==='artist'&&process.env.REQUIRE_ARTIST_APPROVAL==='true')?'pending':'not_required';
  db.prepare('INSERT INTO users(id,email,passwordHash,name,role,location,orgCategory,emailVerified,approvalStatus)VALUES(?,?,?,?,?,?,?,0,?)')
   .run(userId,email,passwordHash,name.trim(),role,location||null,role==='organizer'?category||null:null,approvalStatus);
  if(role==='artist')db.prepare(`INSERT INTO artist_profiles(id,userId,category,location,bio,skills,availability,joined,rating)
    VALUES(?,?,?,?,?,'[]','Flexible',?,0)`).run(id('art_'),userId,category||'Singers',location||'Location TBD','',String(new Date().getFullYear()));
  return {user:db.prepare('SELECT * FROM users WHERE id=?').get(userId)};
 })();
 if(saved.existing)return res.status(202).json(resume(saved.existing));
 const result=await sendCode(req.app,saved.user);
 res.status(201).json({...result,registered:true}); // No JWT is issued before verification/login.
}));
router.post('/verify-email',rateLimit('verification',30,15*60*1000),safe((req,res)=>{
 const email=normalizeEmail(req.body.email);if(!validEmail(email))throw authError(400,'INVALID_EMAIL','Enter a valid email address.');
 res.json(verifyCode(email,req.body.code));
}));
router.post('/resend-verification',rateLimit('resend',10,60*60*1000),safe(async(req,res)=>{
 const email=normalizeEmail(req.body.email);if(!validEmail(email))throw authError(400,'INVALID_EMAIL','Enter a valid email address.');
 const user=findUser(email);
 if(!user||user.emailVerified)return res.json({emailSent:false,message:'If you have an unverified account, use its latest code. Otherwise log in or register to continue.'});
 res.json(await sendCode(req.app,user));
}));
router.post('/login',rateLimit('login',30,15*60*1000),safe(async(req,res)=>{
 const email=normalizeEmail(req.body.email),password=req.body.password;
 if(!validEmail(email)||typeof password!=='string'||Buffer.byteLength(password)>72||!password.length)throw authError(401,'INVALID_CREDENTIALS','Incorrect email or password.');
 const user=findUser(email),matches=await bcrypt.compare(password,user?.passwordHash||dummyHash);
 if(!user||!matches)throw authError(401,'INVALID_CREDENTIALS','Incorrect email or password.');
 const block=accountBlock(user);if(block){const {code,message,...details}=block;throw authError(403,code,message,details);}
 res.json({token:signToken(user),user:publicUser(user)});
}));
router.get('/me',requireAuth,(req,res)=>{
 let artistProfile=null;
 if(req.user.role==='artist'){const row=db.prepare('SELECT * FROM artist_profiles WHERE userId=?').get(req.user.id);if(row)artistProfile=artistOut(row,req.user);}
 res.set('Cache-Control','no-store').json({user:publicUser(req.user),artistProfile});
});
router.post('/forgot-password',rateLimit('password-recovery',5,60*60*1000),safe(async(req,res)=>{
 const email=normalizeEmail(req.body.email);if(!validEmail(email))throw authError(400,'INVALID_EMAIL','Enter a valid email address.');
 if(!process.env.SMTP_HOST&&process.env.EMAIL_DELIVERY_MODE!=='preview'&&!req.app.locals.mailTransport)throw authError(503,'EMAIL_UNAVAILABLE','Password recovery is unavailable until the administrator configures email delivery.');
 if(!process.env.APP_URL&&!req.app.locals.mailTransport)throw authError(503,'EMAIL_UNAVAILABLE','Password recovery needs APP_URL to be configured.');
 const user=findUser(email);
 if(user&&!user.suspended){
  const token=crypto.randomBytes(32).toString('hex'),tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM password_resets WHERE userId=? OR expiresAt<?').run(user.id,Date.now());
  db.prepare('INSERT INTO password_resets(tokenHash,userId,expiresAt)VALUES(?,?,?)').run(tokenHash,user.id,Date.now()+30*60*1000);
  try{const delivery=await deliver(req.app,{to:normalizeEmail(user.email),subject:'Reset your TalentSphere password',text:`TalentSphere\nReset your password within 30 minutes: ${process.env.APP_URL}/#reset/${token}\nIgnore this message if you did not request it.`});
   if(delivery!=='smtp')return res.json({message:delivery==='development_preview'?'Development-only password recovery preview saved. No email was sent.':'Test transport accepted the reset message. No real email was sent.',delivery});
  }catch(err){db.prepare('DELETE FROM password_resets WHERE tokenHash=?').run(tokenHash);throw err.status?err:authError(502,'EMAIL_DELIVERY_FAILED','The email provider could not send the recovery message. Try again later.');}
 }
 res.json({message:'If an active account matches, a password reset link has been accepted for delivery.'});
}));
router.post('/reset-password',rateLimit('password-reset',10,15*60*1000),safe(async(req,res)=>{
 const {token,password}=req.body;
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<8||Buffer.byteLength(password)>72)throw authError(400,'INVALID_RESET','Use a valid reset link and a password of 8 to 72 UTF-8 bytes.');
 const tokenHash=crypto.createHash('sha256').update(token).digest('hex'),reset=db.prepare('SELECT * FROM password_resets WHERE tokenHash=? AND expiresAt>?').get(tokenHash,Date.now());
 if(!reset)throw authError(400,'INVALID_RESET','This reset link is invalid or has expired.');
 const passwordHash=await bcrypt.hash(password,10);
 db.transaction(()=>{
  const consumed=db.prepare('DELETE FROM password_resets WHERE tokenHash=? AND expiresAt>?').run(tokenHash,Date.now());
  if(consumed.changes!==1)throw authError(400,'INVALID_RESET','This reset link was already used or has expired.');
  db.prepare('UPDATE users SET passwordHash=?,tokenVersion=tokenVersion+1 WHERE id=?').run(passwordHash,reset.userId);
 })();res.json({message:'Password updated. Log in with your new password. Email verification is still required if not completed.'});
}));
router.post('/logout',requireAuth,(req,res)=>{db.prepare('UPDATE users SET tokenVersion=tokenVersion+1 WHERE id=?').run(req.user.id);res.json({ok:true});});
module.exports=router;
