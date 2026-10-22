const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'talentsphere-browser-'));
process.env.DATABASE_PATH=path.join(dir,'browser.db');process.env.JWT_SECRET='browser-test-secret-at-least-forty-eight-characters';
process.env.APP_URL='http://localhost:4000';
// MOCK Razorpay SDK/Checkout only: no credentials, network charges or QR scans.
process.env.RAZORPAY_MODE='test';process.env.RAZORPAY_KEY_ID='rzp_test_browserMock';process.env.RAZORPAY_KEY_SECRET='browser-mock-secret-not-real';process.env.RAZORPAY_WEBHOOK_SECRET='browser-mock-hook-not-real';
const app=require('../backend/src/index'),db=require('../backend/src/db');
const mockMail=require('../backend/test/mock-mail').installMockMail(app);
const paymentMock=require('../backend/test/razorpay-mock').createMock();app.locals.razorpay=paymentMock.sdk;
(async()=>{
 let browser,server;
 try{
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('https://checkout.razorpay.com/v1/checkout.js',route=>route.fulfill({contentType:'application/javascript',body:`/* MOCK Checkout, no real Razorpay UI */ window.Razorpay=class{constructor(options){this.options=options;this.events={};window.__mockCheckout=this;}on(name,fn){this.events[name]=fn;}open(){window.__mockCheckoutOpened=true;}close(){window.__mockCheckoutOpened=false;}};`}));
 const page=await context.newPage(),errors=[];
 fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
 page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR:',e.message);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 async function nav(view){await page.goto(base+'#'+view);await page.locator('#topnav').waitFor();await page.waitForFunction(view=>state.view===view.split('/')[0]&&!state.loading,view);if(['artist-dashboard','organizer-dashboard','admin-dashboard','events'].includes(view)){await page.screenshot({path:path.join(__dirname,'../test-results/'+view+'-'+page.viewportSize().width+'.png'),fullPage:true});}}
 async function click(action){await page.locator(`[data-action="${action}"]`).first().click();}
 async function register(role,name,email){
  await nav('register');await page.locator(`[data-action="setregrole"][data-role="${role}"]`).click();await page.locator('#reg-name').fill(name);await page.locator('#reg-email').fill(email);await page.locator('#reg-pass').fill('Browser<Symbols>&123!');await page.locator('#reg-loc').fill('Pune, IN');await click('do-register');
  await page.waitForFunction(()=>state.view==='verify-email'&&!state.loading&&!state.authBusy);assert.equal(await page.evaluate(()=>authToken()),null);
  await page.reload();await page.locator('#verification-code').waitFor();assert.equal(await page.locator('#verify-email').inputValue(),email);assert.equal(await page.locator('[data-action="resend-code"]').isDisabled(),true);
  await page.locator('#verification-code').fill(mockMail.latestCode(email));await click('verify-code');await page.waitForFunction(()=>state.view==='login'&&!state.loading&&!state.authBusy);
  await login(email,role);
 }

 // Recovery uses captured mail and a disposable account; no real email is sent.
 const recoveryEmail='browser-recovery@example.test';
 assert.equal((await page.request.post(base+'/api/auth/register',{data:{name:'Recovery Test',email:recoveryEmail,password:'OriginalPassword123!',role:'organizer'}})).status(),201);
 await nav('login');await page.locator('[data-view="forgot"]').click();await page.locator('#forgot-email').fill(recoveryEmail);
 await page.locator('#forgot-email').press('Enter');
 await page.getByRole('status').filter({hasText:'password recovery preview'}).count();
 await page.waitForFunction(()=>state.view==='forgot'&&!state.authBusy&&!!state.authNotice);
 assert.match(await page.locator('.auth-feedback').innerText(),/No real email was sent/);
 const resetToken=mockMail.messages.at(-1).text.match(/#reset\/([a-f0-9]{64})/)[1];
 await nav('reset/'+resetToken);await page.reload();await page.locator('#reset-confirm').waitFor();
 await page.locator('#reset-password').fill('Recovered<Password>123!');await page.locator('#reset-confirm').fill('DifferentPassword123!');
 await click('reset-password');await page.getByRole('alert').filter({hasText:'Passwords do not match'}).waitFor();
 await page.locator('#reset-password').fill('Recovered<Password>123!');await page.locator('#reset-confirm').fill('Recovered<Password>123!');
 await page.locator('#reset-confirm').press('Enter');await page.waitForFunction(()=>state.view==='login'&&!state.authBusy);
 assert.match(await page.locator('.auth-feedback').innerText(),/Password updated/);assert.equal(await page.evaluate(()=>authToken()),null);
 await nav('reset/invalid');await page.getByRole('alert').filter({hasText:'reset link is invalid'}).waitFor();assert.equal(await page.locator('#reset-password').count(),0);
 await nav('landing');await page.locator('.hero-photo').evaluate(img=>img.decode());assert.match(await page.title(),/TalentSphere/);assert.equal((await page.request.get(base+'/favicon.svg')).status(),200);assert.ok(await page.getByText('No artists listed yet.',{exact:false}).count());
 await register('artist','Browser Artist','browser-artist@example.test');
 await nav('artist-portfolio');await page.locator('#prof-bio').fill('Original acoustic performances');await page.locator('#prof-skills').fill('Guitar, Vocals');await page.locator('#prof-price').fill('12500');await click('save-profile');await page.getByText('Profile updated.',{exact:true}).waitFor();
 await page.locator('#portfolio-file').setInputFiles({name:'portfolio.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO8sAAAAASUVORK5CYII=','base64')});await click('upload-portfolio');await page.locator('.portfolio-image').waitFor();
 await page.reload();await page.locator('#prof-bio').waitFor();assert.equal(await page.locator('#prof-bio').inputValue(),'Original acoustic performances');assert.equal(await page.locator('.portfolio-image').count(),1);
 // Uploaded media must be previewable by keyboard and Escape must restore focus.
 const artistId=db.prepare("SELECT a.id FROM artist_profiles a JOIN users u ON u.id=a.userId WHERE u.email='browser-artist@example.test'").get().id;
 await nav('artist-profile/'+artistId);await page.locator('[data-action="preview-media"]').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#media-dialog').evaluate(el=>el.open),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#media-dialog').evaluate(el=>el.open),false);assert.equal(await page.locator('[data-action="preview-media"]').evaluate(el=>el===document.activeElement),true);
 await click('logout');await page.waitForFunction(()=>state.role===null&&!state.loading);
 await register('organizer' ,'Browser Organizer','browser-organizer@example.test');
 await nav('create-event');for(const [id,value] of Object.entries({'ev-name':'Browser Concert','ev-desc':'Live acoustic music evening','ev-date':'2099-12-01','ev-time':'18:00','ev-loc':'Pune','ev-venue':'Studio','ev-budget':'25000','ev-deadline':'2099-11-01'}))await page.locator('#'+id).fill(value);await click('publish-event');await page.waitForFunction(()=>state.view==='events'&&!state.loading);assert.ok(await page.getByText('Browser Concert',{exact:true}).count());
 await nav('explore');await page.locator('[data-bind="explore-q"]').fill('Guitar');assert.equal(await page.locator('[data-action="clear-filter"][data-filter="q"]').count(),1);assert.equal(await page.locator('.artist-card').count(),1);await page.locator('[data-bind="explore-availability"]').selectOption('Flexible');await page.locator('[data-action="book"]').first().click();await page.getByText('Nothing is charged now.',{exact:false}).waitFor();assert.ok(await page.getByText('Quoted total',{exact:true}).count());await page.locator('#bk-event').fill('Browser Booking');await page.locator('#bk-date').fill('2099-11-20');await page.locator('#bk-loc').fill('Studio, Pune');await page.locator('#bk-notes').fill('Acoustic set please');await click('send-booking-request');await page.waitForFunction(()=>state.view==='booking-review'&&!state.loading);
 await nav('organizer-bookings');assert.ok(await page.getByText('Browser Booking',{exact:true}).count());assert.ok(await page.getByText('Acoustic set please',{exact:true}).count());
 await click('logout');await page.waitForFunction(()=>state.role===null&&!state.loading);
 async function login(email,role){await nav('login');await page.locator('#login-email').fill(email);await page.locator('#login-pass').fill('Browser<Symbols>&123!');await page.locator('#login-pass').press('Enter');await page.waitForFunction(role=>state.role===role&&state.view===role+'-dashboard'&&!state.loading,role);}
 await login('browser-artist@example.test','artist');await nav('artist-bookings');await page.locator('[id^="final-price-"]').fill('12650.75');await page.locator('[data-action="booking-status"][data-status="Accepted"]').click();await page.waitForFunction(()=>BOOKINGS[0]?.status==='Accepted'&&!state.loading);
 await nav('events');await page.locator('[data-view="event-detail"]').first().click();await click('apply');await page.locator('#app-msg').fill('Available for an acoustic set');await click('submit-application');await page.waitForFunction(()=>state.view==='event-detail'&&!state.loading);
 await click('logout');await page.waitForFunction(()=>state.role===null&&!state.loading);await login('browser-organizer@example.test','organizer');await nav('organizer-applications');await page.locator('[data-action="app-respond"][data-status="Accepted"]').click();await page.waitForFunction(()=>APPLICATIONS[0]?.status==='Accepted'&&!state.loading);
 await nav('organizer-bookings');await page.getByRole('button',{name:'Pay Now',exact:true}).click();await page.locator('[data-action="start-checkout"]').waitFor();
 await page.locator('[data-action="start-checkout"]').click();await page.waitForFunction(()=>window.__mockCheckoutOpened===true);
 const providerOrderId=await page.evaluate(()=>window.__mockCheckout.options.order_id);
 assert.equal(paymentMock.orders.get(providerOrderId).amount,1265075);
 // Abandoned and failed MOCK Checkout attempts must reuse the same saved provider order.
 await page.evaluate(()=>window.__mockCheckout.options.modal.ondismiss());await page.waitForFunction(()=>PAYMENT_DETAIL?.displayStatus==='abandoned'&&!checkoutInProgress&&!state.loading);
 await page.locator('[data-action="start-checkout"]').click();await page.waitForFunction(()=>window.__mockCheckoutOpened===true);assert.equal(await page.evaluate(()=>window.__mockCheckout.options.order_id),providerOrderId);
 paymentMock.pay(providerOrderId,'failed',{error_code:'BAD_REQUEST_ERROR'});await page.evaluate(()=>window.__mockCheckout.events['payment.failed']());await page.waitForFunction(()=>PAYMENT_DETAIL?.booking.paymentStatus==='failed'&&!checkoutInProgress&&!state.loading);
 await page.locator('[data-action="start-checkout"]').click();await page.waitForFunction(()=>window.__mockCheckoutOpened===true);assert.equal(paymentMock.createCalls,1);
 const payment=paymentMock.pay(providerOrderId);
 await page.evaluate(async result=>window.__mockCheckout.options.handler(result),{razorpay_order_id:providerOrderId,razorpay_payment_id:payment.id,razorpay_signature:paymentMock.signature(providerOrderId,payment.id)});
 await page.waitForFunction(()=>PAYMENT_DETAIL?.booking.paymentStatus==='paid'&&!state.loading);
 await page.reload();await page.waitForFunction(()=>PAYMENT_DETAIL?.booking.paymentStatus==='paid'&&!state.loading);
 const paidBookingId=await page.evaluate(()=>PAYMENT_DETAIL.booking.id);
 await page.getByRole('button',{name:'View receipt',exact:true}).click();await page.waitForFunction(()=>state.view==='receipt'&&!state.loading);assert.ok(await page.getByText('Capture receipt',{exact:true}).count());assert.ok(await page.getByText('Test payment receipt / No real money',{exact:true}).count());
 await nav('organizer-bookings');await page.locator('.status-Confirmed').waitFor();
 // Collaboration UI: a real proposal, and recipient-only response.
 await click('logout');await page.waitForFunction(()=>state.role===null&&!state.loading);
 await register('artist','Second Creator','second-creator@example.test');
 const secondId=db.prepare("SELECT a.id FROM artist_profiles a JOIN users u ON u.id=a.userId WHERE u.email='second-creator@example.test'").get().id;
 // Viewing another artist never exposes their editor. The workspace link opens the owner only.
 await nav('artist-profile/'+artistId);
 assert.equal(await page.locator('[data-action="save-profile"],[data-action="upload-portfolio"],[data-action="remove-media"]').count(),0);
 await page.getByRole('button',{name:'My portfolio',exact:true}).click();
 await page.locator('[data-profile-editor]').waitFor();
 assert.equal(await page.locator('[data-profile-editor]').getAttribute('data-profile-editor'),secondId);
 assert.equal(await page.locator('#prof-bio').inputValue(),'');
 await click('logout');await page.waitForFunction(()=>state.role===null&&!state.loading);await login('browser-artist@example.test','artist');
 await nav('collaborate');await page.locator(`[data-action="collab-request"][data-id="${secondId}"]`).click();await page.locator('#collab-message').fill('Co-write an acoustic original next month');await click('send-collaboration');await page.waitForFunction(()=>state.view==='collaborate'&&!state.loading);assert.equal(await page.locator('[data-action="collab-respond"]').count(),0);
 await click('logout');await page.waitForFunction(()=>state.role===null&&!state.loading);await login('second-creator@example.test','artist');await nav('collaborate');await page.locator('[data-action="collab-respond"][data-status="Declined"]').click();await page.waitForFunction(()=>COLLABORATIONS[0]?.status==='Declined'&&!state.loading);
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});for(const view of ['artist-dashboard','artist-portfolio','artist-bookings','artist-applications','collaborate','notifications']){await nav(view);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`${view} overflow at ${width}`);}}
 // Admin account created only in this disposable database.
 const hash=require('../backend/node_modules/bcryptjs').hashSync('Browser<Symbols>&123!',10);
 db.prepare("INSERT INTO users(id,name,email,passwordHash,role,emailVerified) VALUES('browser-admin','Browser Admin','browser-admin@example.test',?,'admin',1)").run(hash);
 await click('logout');await page.waitForFunction(()=>state.role===null&&!state.loading);await login('browser-admin@example.test','admin');
 await nav('admin-users');await page.locator(`[data-action="admin-verify"][data-id="${secondId}"]`).click();await page.waitForFunction(()=>ADMIN_USERS.some(u=>u.email==='second-creator@example.test'&&u.verified)&&!state.loading);
 const secondUser=db.prepare("SELECT id FROM users WHERE email='second-creator@example.test'").get().id;
 await page.locator(`[data-action="admin-suspend"][data-id="${secondUser}"]`).click();await page.waitForFunction(()=>ADMIN_USERS.some(u=>u.email==='second-creator@example.test'&&u.suspended)&&!state.loading);
 await page.locator(`[data-action="admin-suspend"][data-id="${secondUser}"]`).click();await page.waitForFunction(()=>ADMIN_USERS.some(u=>u.email==='second-creator@example.test'&&!u.suspended)&&!state.loading);
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});for(const view of ['admin-dashboard','admin-users','admin-events','admin-bookings','admin-payments']){await nav(view);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`${view} overflow at ${width}`);}}
 await click('logout');await page.waitForFunction(()=>state.role===null&&!state.loading);await login('browser-organizer@example.test','organizer');
 // Render all available pages and check responsive overflow at desktop/tablet/mobile sizes.
 for(const width of [1440,768,390]){
 await page.setViewportSize({width,height:900});
 for(const view of ['landing','explore','events','organizer-dashboard','organizer-applications','organizer-bookings','payment-history','payment/'+paidBookingId,'receipt/'+payment.id]){
 await nav(view);if(view.startsWith('payment/')){await page.evaluate(()=>document.getElementById('toastwrap').replaceChildren());await page.screenshot({path:path.join(__dirname,`../test-results/mock-payment-${width}.png`),fullPage:true});}const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);if(overflow)console.log(await page.evaluate(()=>Array.from(document.querySelectorAll("body *")).filter(e=>e.getBoundingClientRect().right>innerWidth+2).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,20)));assert.equal(overflow,false,`${view} overflows at ${width}px`);
 }
 }
 await page.setViewportSize({width:390,height:844});await nav('explore');await page.locator('[data-action="toggle-filters"]').click();await page.locator('[data-bind="explore-category"]').selectOption('Singers');assert.equal(await page.locator('[data-action="clear-filter"][data-filter="category"]').count(),1);await page.locator('[data-action="clear-filter"][data-filter="category"]').click();assert.equal(await page.locator('[data-action="clear-filter"][data-filter="category"]').count(),0);await page.locator('[data-bind="explore-q"]').fill('NoArtistMatchesThis');await page.getByText('No artists match your filters',{exact:true}).waitFor();await page.locator('[data-action="reset-filters"]').last().click();assert.ok(await page.locator('.artist-card').count());
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});for(const view of ['login','register','verify-email','account-status','forgot','about','artist-profile/'+artistId,'book/'+artistId,'does-not-exist']){await nav(view);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`${view} overflow at ${width}`);}}
 await nav('does-not-exist');await page.getByText('404 / Page not found',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await nav('landing');fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});await page.locator('.hero-photo').evaluate(img=>img.decode());await page.evaluate(()=>document.getElementById('toastwrap').replaceChildren());await page.screenshot({path:path.join(__dirname,'../test-results/mobile-home.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Browser passed: MOCK email password recovery/reset/confirmation/reload/invalid links, registration/verification/cooldown/refresh, login/logout, profile/media persistence, discovery, event publishing, applications, artist acceptance, MOCK Razorpay abandoned/failed/retry/capture-confirmation/receipt/refresh, collaboration proposals/decline, admin verification/suspension/restore, refresh and responsive overflow at 390/768/1440 px. Gallery keyboard preview, mobile active filters/reset, booking summary, favicon, titles and public/error pages also passed. No browser errors or failed API responses.');
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(err=>{console.error(err);process.exitCode=1;});
