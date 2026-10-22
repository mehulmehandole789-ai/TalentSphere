const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const {authError,normalizeEmail} = require('./common');
const previewDir=path.join(__dirname,'../../.mail-preview');
function validateEmailConfiguration() {
 const mode=process.env.EMAIL_DELIVERY_MODE||'smtp';
 if(!['smtp','preview'].includes(mode))throw new Error('EMAIL_DELIVERY_MODE must be smtp or preview.');
 if(mode==='preview'&&process.env.NODE_ENV!=='development')throw new Error('Local email preview requires NODE_ENV=development. Never enable it in production.');
 if(process.env.EMAIL_VERIFICATION_SECRET&&process.env.EMAIL_VERIFICATION_SECRET.length<32)throw new Error('EMAIL_VERIFICATION_SECRET must contain at least 32 characters.');
 if(process.env.SMTP_HOST&&(!process.env.SMTP_FROM||(process.env.SMTP_USER&&!process.env.SMTP_PASS)))throw new Error('SMTP requires SMTP_FROM and SMTP_PASS when SMTP_USER is supplied.');
 if(process.env.SMTP_PORT&&(!/^\d+$/.test(process.env.SMTP_PORT)||+process.env.SMTP_PORT<1||+process.env.SMTP_PORT>65535))throw new Error('SMTP_PORT must be a valid port number.');
}
async function deliver(app, message) {
 // In-process injection is used only by automated tests; there is no HTTP mock switch.
 if(app.locals.mailTransport){await app.locals.mailTransport.sendMail(message);return 'test_transport';}
 if((process.env.EMAIL_DELIVERY_MODE||'smtp')==='preview'){
  validateEmailConfiguration();
  await fs.mkdir(previewDir,{recursive:true});
  const filename=path.join(previewDir,Date.now()+'-'+crypto.randomUUID()+'.json');
  await fs.writeFile(filename,JSON.stringify({developmentOnly:true,warning:'LOCAL PREVIEW ONLY. No email was sent.',to:message.to,subject:message.subject,text:message.text,html:message.html},null,2),{encoding:'utf8',mode:0o600});
  return 'development_preview';
 }
 if(!process.env.SMTP_HOST||!process.env.SMTP_FROM)throw authError(503,'EMAIL_UNAVAILABLE','Email delivery is not configured. Your account is saved; ask the administrator to configure SMTP, then request a new code.');
 const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',
  auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
 try{
  const result=await transport.sendMail({...message,from:process.env.SMTP_FROM});
  if(!result.accepted?.length)throw new Error('SMTP did not accept the recipient.');
  return 'smtp';
 }catch(err){throw authError(502,'EMAIL_DELIVERY_FAILED','Email delivery could not be confirmed. Your account is saved. Wait for the resend cooldown, then request a new code.');}
 finally{transport.close();}
}
function escapeHtml(text){return String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function verificationMessage(user,code){
 const name=escapeHtml(user.name);
 return {to:normalizeEmail(user.email),subject:'Verify your TalentSphere email',
  text:`TalentSphere\n\nHi ${user.name},\nYour email verification code is: ${code}\n\nThis code expires in 10 minutes and can be used once. Enter it on the TalentSphere verification page. Requesting a replacement invalidates this code. If you did not request this, ignore this email.\n\nTalentSphere - Independent talent. Meaningful connections.`,
  html:`<!doctype html><html><body style="margin:0;background:#faf8f4;color:#28262d;font:16px Arial,sans-serif"><table role="presentation" style="width:100%;max-width:560px;margin:32px auto;background:white;border:1px solid #dfdbe3;border-radius:16px"><tr><td style="padding:36px"><p style="font:600 26px Georgia,serif;color:#6246a6">TalentSphere</p><h1 style="font:400 30px Georgia,serif">Verify your email.</h1><p>Hi ${name},</p><p>Enter this code on the TalentSphere verification page:</p><p style="font-size:36px;letter-spacing:8px;background:#f0edf4;color:#6246a6;padding:20px;text-align:center;font-weight:bold">${code}</p><p>This code expires in <strong>10 minutes</strong> and can be used once. A replacement invalidates this code.</p><p style="font-size:13px;color:#67636e">If you did not request this, ignore this email. No account can be signed in without your password and email verification.</p><hr style="border:0;border-top:1px solid #dfdbe3"><p style="font-size:12px;color:#67636e">Independent talent. Meaningful connections.</p></td></tr></table></body></html>`};
}
module.exports={deliver,verificationMessage,validateEmailConfiguration};
