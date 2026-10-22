const {test,beforeEach,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-email-auth-'));
process.env.DATABASE_PATH=path.join(dir,'auth.test.db');process.env.JWT_SECRET='isolated-email-auth-test-secret-over-48-characters';process.env.EMAIL_DELIVERY_MODE='smtp';
delete process.env.SMTP_HOST;delete process.env.SMTP_FROM;delete process.env.REQUIRE_ARTIST_APPROVAL;
const Database=require('better-sqlite3'),bcrypt=require('bcryptjs');
const legacyPassword=' Legacy<Symbols>&123! ',legacyHash=bcrypt.hashSync(legacyPassword,10);
const old=new Database(process.env.DATABASE_PATH);old.exec(fs.readFileSync(path.join(__dirname,'../src/db/schema.sql'),'utf8'));
old.prepare('INSERT INTO users(id,email,passwordHash,name,role)VALUES(?,?,?,?,?)').run('legacy',' Legacy@Example.TEST ',legacyHash,'Legacy Owner','organizer');old.close();
const app=require('../src/index'),db=require('../src/db'),{installMockMail}=require('./mock-mail');
// index loads .env; remove real mail credentials again so missing-mail tests stay isolated.
delete process.env.SMTP_HOST;delete process.env.SMTP_FROM;
let mail=installMockMail(app),server,base,sequence=0;
const ready=new Promise(resolve=>{server=app.listen(0,'127.0.0.1',()=>{base=`http://127.0.0.1:${server.address().port}/api`;resolve();});});
beforeEach(()=>{db.prepare('DELETE FROM auth_rate_limits').run();}); // Disposable test DB only; production limits never have a reset endpoint.
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(dir,{recursive:true,force:true});});
async function request(route,method='POST',body={},token){await ready;const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:method==='GET'?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),retryAfter:response.headers.get('retry-after')};}
const userFor=email=>db.prepare('SELECT * FROM users WHERE LOWER(TRIM(email))=?').get(email.trim().toLowerCase());
function ageCode(email){db.prepare('UPDATE email_verifications SET issuedAt=? WHERE userId=?').run(Date.now()-61000,userFor(email).id);}
async function register(overrides={}){const payload={name:'Test Creator',email:`creator${++sequence}@example.test`,password:' Strong<Password>&123! ',role:'artist',location:'Pune',category:'Singers',...overrides};const result=await request('/auth/register','POST',payload);return {payload,result,user:userFor(payload.email)};}
async function verify(payload,code=mail.latestCode(payload.email)){return request('/auth/verify-email','POST',{email:payload.email,code});}
async function login(payload,password=payload.password){return request('/auth/login','POST',{email:payload.email,password});}
async function verifiedFixture(overrides={}){const fixture=await register(overrides);assert.equal(fixture.result.status,201);assert.equal((await verify(fixture.payload)).status,200);return fixture;}
let adminToken;
test('password recovery replaces links, expires, consumes once, preserves verification and revokes sessions',async()=>{
 const previousUrl=process.env.APP_URL;process.env.APP_URL='http://localhost:4000';
 try{
  const f=await verifiedFixture(),session=await login(f.payload);
  async function resetLink(){
   const result=await request('/auth/forgot-password','POST',{email:f.payload.email.toUpperCase()});
   assert.equal(result.status,200);assert.equal(result.data.token,undefined);
   const message=mail.messages.at(-1);assert.equal(message.to,f.payload.email);
   return message.text.match(/#reset\/([a-f0-9]{64})/)[1];
  }
  const first=await resetLink(),second=await resetLink(),password=' Recovered<Password>&123! ';
  assert.equal((await request('/auth/reset-password','POST',{token:first,password})).status,400);
  const hash=crypto.createHash('sha256').update(second).digest('hex');
  db.prepare('UPDATE password_resets SET expiresAt=? WHERE tokenHash=?').run(Date.now()-1,hash);
  assert.equal((await request('/auth/reset-password','POST',{token:second,password})).status,400);
  const token=await resetLink();
  assert.equal((await request('/auth/reset-password','POST',{token,password:'short'})).status,400);
  assert.equal((await request('/auth/reset-password','POST',{token,password})).status,200);
  assert.equal((await request('/auth/reset-password','POST',{token,password})).status,400);
  assert.equal((await login(f.payload)).status,401);assert.equal((await login(f.payload,password)).status,200);
  assert.equal((await request('/auth/me','GET',{},session.data.token)).status,401);
  const unverified=await register();await request('/auth/forgot-password','POST',{email:unverified.payload.email});
  const unverifiedToken=mail.messages.at(-1).text.match(/#reset\/([a-f0-9]{64})/)[1];
  assert.equal((await request('/auth/reset-password','POST',{token:unverifiedToken,password})).status,200);
  assert.equal((await login(unverified.payload,password)).data.code,'EMAIL_UNVERIFIED');
 }finally{if(previousUrl===undefined)delete process.env.APP_URL;else process.env.APP_URL=previousUrl;}
});
test('password recovery does not disclose unknown accounts and failed mail invalidates the link',async()=>{
 const previousUrl=process.env.APP_URL;process.env.APP_URL='http://localhost:4000';
 try{
  const before=mail.messages.length,unknown=await request('/auth/forgot-password','POST',{email:'unknown-recovery@example.test'});
  assert.equal(unknown.status,200);assert.equal(mail.messages.length,before);
  const f=await register();let failedMessage;
  app.locals.mailTransport={sendMail:async message=>{failedMessage=message;throw Error('private SMTP failure');}};
  const failed=await request('/auth/forgot-password','POST',{email:f.payload.email});
  assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed.data).includes('private SMTP'));
  const token=failedMessage.text.match(/#reset\/([a-f0-9]{64})/)[1];
  assert.equal((await request('/auth/reset-password','POST',{token,password:'Replacement123!'})).status,400);
 }finally{mail=installMockMail(app);if(previousUrl===undefined)delete process.env.APP_URL;else process.env.APP_URL=previousUrl;}
});
function admin(){if(!adminToken){db.prepare("INSERT INTO users(id,name,email,passwordHash,role,emailVerified)VALUES('auth-admin','Admin','admin@example.test','unused','admin',1)").run();adminToken=require('../src/middleware/auth').signToken({id:'auth-admin',role:'admin'});}return adminToken;}
test('legacy migration never verifies, resets passwords, changes roles, or changes original email',async()=>{
 const user=userFor('legacy@example.test');assert.equal(user.emailVerified,0);assert.equal(user.approvalStatus,'not_required');assert.equal(user.passwordHash,legacyHash);assert.equal(user.role,'organizer');assert.equal(user.email,' Legacy@Example.TEST ');
 const blocked=await login({email:'LEGACY@example.test',password:legacyPassword});assert.equal(blocked.status,403);assert.equal(blocked.data.code,'EMAIL_UNVERIFIED');
 assert.equal((await request('/auth/resend-verification','POST',{email:'legacy@example.test'})).status,200);
 assert.equal((await verify({email:'legacy@example.test'})).status,200);assert.equal((await login({email:'  LEGACY@example.test  ',password:legacyPassword})).status,200);
 assert.equal(userFor('legacy@example.test').passwordHash,legacyHash);
});
test('MOCK email: new registration is unverified, no JWT or OTP response, branded HTML and plain text, HMAC storage',async()=>{
 const f=await register();assert.equal(f.result.status,201);assert.equal(f.result.data.token,undefined);assert.equal(f.result.data.user,undefined);assert.equal(f.result.data.code,undefined);assert.equal(f.result.data.emailSent,false);assert.equal(f.result.data.delivery,'test_transport');assert.equal(f.user.emailVerified,0);
 const row=db.prepare('SELECT * FROM email_verifications WHERE userId=?').get(f.user.id),code=mail.latestCode(f.payload.email);
 assert.match(code,/^\d{6}$/);assert.equal(row.codeHash.length,64);assert.notEqual(row.codeHash,code);assert.ok(row.expiresAt-Date.now()>590000&&row.expiresAt-Date.now()<=600000);
 assert.ok(bcrypt.compareSync(f.payload.password,f.user.passwordHash));const message=mail.messages.at(-1);assert.match(message.html,/TalentSphere/);assert.match(message.html,/10 minutes/);assert.ok(message.html.includes(code));assert.ok(message.text.includes(code));
});
test('incorrect password is generic even when unverified; correct password reveals only the appropriate gate',async()=>{
 const f=await register();const wrong=await login(f.payload,'Incorrect<Pass>123!');assert.equal(wrong.status,401);assert.equal(wrong.data.code,'INVALID_CREDENTIALS');assert.equal(wrong.data.verificationRequired,undefined);
 const blocked=await login(f.payload);assert.equal(blocked.status,403);assert.equal(blocked.data.code,'EMAIL_UNVERIFIED');assert.equal(blocked.data.verificationRequired,true);
 const unknown=await login({email:'nobody@example.test',password:'Incorrect<Pass>123!'});assert.equal(unknown.data.error,wrong.data.error);
});
test('wrong codes commit attempt counters; valid code is consumed once without auto-login',async()=>{
 const f=await register(),code=mail.latestCode(f.payload.email),wrong=code==='000000'?'000001':'000000';
 const bad=await verify(f.payload,wrong);assert.equal(bad.status,400);assert.equal(bad.data.attemptsRemaining,4);assert.equal(db.prepare('SELECT attempts FROM email_verifications WHERE userId=?').get(f.user.id).attempts,1);
 const ok=await verify(f.payload,code);assert.equal(ok.status,200);assert.equal(ok.data.emailVerified,true);assert.equal(ok.data.token,undefined);
 const row=db.prepare('SELECT * FROM email_verifications WHERE userId=?').get(f.user.id);assert.equal(row.codeHash,null);assert.ok(row.consumedAt);assert.equal((await verify(f.payload,code)).status,409);assert.equal((await login(f.payload)).status,200);
});
test('expiry is server-enforced and resend invalidates the previous code',async()=>{
 const f=await register(),oldCode=mail.latestCode(f.payload.email);db.prepare('UPDATE email_verifications SET expiresAt=? WHERE userId=?').run(Date.now()-1,f.user.id);
 assert.equal((await verify(f.payload,oldCode)).data.code,'CODE_EXPIRED');ageCode(f.payload.email);
 assert.equal((await request('/auth/resend-verification','POST',{email:f.payload.email})).status,200);const replacement=mail.latestCode(f.payload.email);
 if(oldCode!==replacement)assert.equal((await verify(f.payload,oldCode)).status,400);assert.equal((await verify(f.payload,replacement)).status,200);
});
test('60-second cooldown and five-per-hour account resend limit persist in the database',async()=>{
 const f=await register(),before=mail.messages.length;const cooldown=await request('/auth/resend-verification','POST',{email:f.payload.email});assert.equal(cooldown.status,429);assert.equal(cooldown.data.code,'RESEND_COOLDOWN');assert.ok(Number(cooldown.retryAfter)>0);assert.equal(mail.messages.length,before);
 ageCode(f.payload.email);db.prepare('UPDATE email_verifications SET sendCount=5 WHERE userId=?').run(f.user.id);
 const limit=await request('/auth/resend-verification','POST',{email:f.payload.email});assert.equal(limit.status,429);assert.equal(limit.data.code,'RESEND_LIMIT');assert.equal(mail.messages.length,before);
});
test('five wrong attempts block even the correct code; a rate-limited replacement resets attempts',async()=>{
 const f=await register(),code=mail.latestCode(f.payload.email),wrong=code==='111111'?'222222':'111111';
 for(let i=0;i<5;i++)assert.equal((await verify(f.payload,wrong)).status,i===4?429:400);
 assert.equal((await verify(f.payload,code)).data.code,'CODE_ATTEMPTS_EXCEEDED');assert.equal(userFor(f.payload.email).emailVerified,0);
 ageCode(f.payload.email);assert.equal((await request('/auth/resend-verification','POST',{email:f.payload.email})).status,200);assert.equal((await verify(f.payload)).status,200);
});
test('duplicate registration safely resumes an unverified account without changing its password or profile',async()=>{
 const f=await register(),before=mail.messages.length;const repeated=await register({...f.payload,name:'Replacement Name',email:f.payload.email.toUpperCase(),password:'ReplacementPassword123!'});
 assert.equal(repeated.result.status,202);assert.equal(repeated.result.data.resumed,true);assert.equal(mail.messages.length,before);assert.equal(userFor(f.payload.email).passwordHash,f.user.passwordHash);assert.equal(userFor(f.payload.email).name,f.user.name);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE LOWER(TRIM(email))=?').get(f.payload.email).n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM artist_profiles WHERE userId=?').get(f.user.id).n,1);
 await verify(f.payload);assert.equal((await login(f.payload)).status,200);assert.equal((await login(f.payload,'ReplacementPassword123!')).status,401);assert.equal((await register(f.payload)).result.status,409);
});
test('concurrent verification consumes exactly one code; concurrent resend emits one replacement',async()=>{
 const f=await register();ageCode(f.payload.email);const before=mail.messages.length;
 const sends=await Promise.all([request('/auth/resend-verification','POST',{email:f.payload.email}),request('/auth/resend-verification','POST',{email:f.payload.email})]);assert.deepEqual(sends.map(r=>r.status).sort(),[200,429]);assert.equal(mail.messages.length,before+1);
 const code=mail.latestCode(f.payload.email);const results=await Promise.all([verify(f.payload,code),verify(f.payload,code)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});
test('MOCK SMTP failure leaves a recoverable account, never exposes internal error or claims delivery',async()=>{
 app.locals.mailTransport={sendMail:async()=>{throw new Error('private smtp credentials must not leak');}};
 const f=await register();assert.equal(f.result.status,502);assert.equal(f.result.data.verificationRequired,true);assert.equal(f.result.data.emailSent,false);assert.ok(!JSON.stringify(f.result.data).includes('private smtp'));assert.equal(f.user.emailVerified,0);assert.equal(db.prepare('SELECT codeHash FROM email_verifications WHERE userId=?').get(f.user.id).codeHash,null);
 mail=installMockMail(app);assert.equal((await request('/auth/resend-verification','POST',{email:f.payload.email})).status,429);ageCode(f.payload.email);assert.equal((await request('/auth/resend-verification','POST',{email:f.payload.email})).status,200);assert.equal((await verify(f.payload)).status,200);assert.equal((await login(f.payload)).status,200);
});
test('missing SMTP explicitly fails after saving the account; registration retry does not duplicate it',async()=>{
 delete app.locals.mailTransport;const f=await register();assert.equal(f.result.status,503);assert.equal(f.result.data.code,'EMAIL_UNAVAILABLE');assert.equal(f.result.data.emailSent,false);assert.ok(f.user);assert.equal(f.user.emailVerified,0);
 const retry=await register(f.payload);assert.equal(retry.result.status,202);assert.equal(retry.user.id,f.user.id);mail=installMockMail(app);ageCode(f.payload.email);await request('/auth/resend-verification','POST',{email:f.payload.email});assert.equal((await verify(f.payload)).status,200);
});
test('email verification does not approve accounts, and admin approval does not verify emails',async()=>{
 process.env.REQUIRE_ARTIST_APPROVAL='true';const f=await register();delete process.env.REQUIRE_ARTIST_APPROVAL;assert.equal(f.user.approvalStatus,'pending');
 assert.equal((await verify(f.payload)).status,200);assert.equal(userFor(f.payload.email).approvalStatus,'pending');assert.equal((await login(f.payload)).data.code,'APPROVAL_PENDING');assert.equal((await login(f.payload,'wrong-password')).data.code,'INVALID_CREDENTIALS');
 assert.equal((await request('/admin/users/'+f.user.id+'/approval','PATCH',{approvalStatus:'rejected'},admin())).status,200);assert.equal((await login(f.payload)).data.code,'APPROVAL_REJECTED');
 assert.equal((await request('/admin/users/'+f.user.id+'/approval','PATCH',{approvalStatus:'approved'},admin())).status,200);assert.equal((await login(f.payload)).status,200);
 const unverified=await register();await request('/admin/users/'+unverified.user.id+'/approval','PATCH',{approvalStatus:'approved'},admin());assert.equal(userFor(unverified.payload.email).emailVerified,0);assert.equal((await login(unverified.payload)).data.code,'EMAIL_UNVERIFIED');
 const profile=db.prepare('SELECT * FROM artist_profiles WHERE userId=?').get(unverified.user.id);await request('/admin/artists/'+profile.id+'/verify','PATCH',{},admin());assert.equal(userFor(unverified.payload.email).emailVerified,0);
});
test('JWT persistence, logout revocation, role permissions, and unverified-token rejection',async()=>{
 const f=await verifiedFixture(),logged=await login(f.payload);assert.equal((await request('/auth/me','GET',{},logged.data.token)).status,200);assert.equal((await request('/admin/users','GET',{},logged.data.token)).status,403);
 assert.equal((await request('/auth/logout','POST',{},logged.data.token)).status,200);assert.equal((await request('/auth/me','GET',{},logged.data.token)).status,401);
 const unverified=await register();const token=require('../src/middleware/auth').signToken(unverified.user);const blocked=await request('/bookings','GET',{},token);assert.equal(blocked.status,403);assert.equal(blocked.data.code,'EMAIL_UNVERIFIED');
});
test('password symbols/whitespace remain exact and bcrypt truncation cannot accept a suffixed password',async()=>{
 const f=await verifiedFixture();assert.equal((await login(f.payload)).status,200);assert.equal((await login(f.payload,f.payload.password.trim())).status,401);
 const maximum=await verifiedFixture({password:'X'.repeat(72)});assert.equal((await login(maximum.payload)).status,200);assert.equal((await login(maximum.payload,'X'.repeat(72)+'suffix')).status,401);
});
test('registration, verification and resend rate limits are persistent and independent from login',async()=>{
 const f=await verifiedFixture();const subject=crypto.createHash('sha256').update('127.0.0.1').digest('hex');
 for(const scope of ['registration','verification','resend'])db.prepare('INSERT OR REPLACE INTO auth_rate_limits(scope,subject,count,resetsAt)VALUES(?,?,100,?)').run(scope,subject,Date.now()+60000);
 assert.equal((await register()).result.status,429);assert.equal((await verify(f.payload,'123456')).status,429);assert.equal((await request('/auth/resend-verification','POST',{email:f.payload.email})).status,429);assert.equal((await login(f.payload)).status,200);
});
test('development email preview is rejected outside explicit development mode',()=>{
 const previousMode=process.env.EMAIL_DELIVERY_MODE,previousEnv=process.env.NODE_ENV;process.env.EMAIL_DELIVERY_MODE='preview';process.env.NODE_ENV='production';
 assert.throws(()=>require('../src/auth/email').validateEmailConfiguration(),/requires NODE_ENV=development/);process.env.NODE_ENV='development';assert.doesNotThrow(()=>require('../src/auth/email').validateEmailConfiguration());process.env.EMAIL_DELIVERY_MODE=previousMode;if(previousEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousEnv;
});

test('LOCAL PREVIEW ONLY writes a branded private email without claiming delivery and its code verifies',async()=>{
 const previousMode=process.env.EMAIL_DELIVERY_MODE,previousEnv=process.env.NODE_ENV;
 const previewDir=path.resolve(__dirname,'../.mail-preview');
 let createdFile;
 try{
  process.env.NODE_ENV='development';process.env.EMAIL_DELIVERY_MODE='preview';delete app.locals.mailTransport;
  const f=await register();assert.equal(f.result.status,201);assert.equal(f.result.data.emailSent,false);assert.equal(f.result.data.delivery,'development_preview');
  const files=fs.readdirSync(previewDir).filter(name=>name.endsWith('.json'));
  for(const name of files){const filename=path.join(previewDir,name),message=JSON.parse(fs.readFileSync(filename,'utf8'));if(message.to===f.payload.email){createdFile=filename;assert.equal(message.developmentOnly,true);assert.match(message.warning,/No email was sent/);assert.match(message.html,/TalentSphere/);const code=message.text.match(/code is: (\d{6})/)[1];assert.equal((await verify(f.payload,code)).status,200);break;}}
  assert.ok(createdFile,'A development-only file was written for the disposable test account');
 }finally{
  if(createdFile){assert.equal(path.dirname(createdFile),previewDir);fs.unlinkSync(createdFile);}
  if(previousMode===undefined)delete process.env.EMAIL_DELIVERY_MODE;else process.env.EMAIL_DELIVERY_MODE=previousMode;
  if(previousEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousEnv;
  mail=installMockMail(app);
 }
});
