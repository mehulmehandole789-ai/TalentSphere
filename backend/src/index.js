require("dotenv").config({path: require("path").join(__dirname,"../.env")});
if (process.env.PORT && (!/^\d+$/.test(process.env.PORT) || Number(process.env.PORT)<1 || Number(process.env.PORT)>65535)) throw new Error("PORT must be a number from 1 to 65535.");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /change-this|replace-with/.test(process.env.JWT_SECRET)) throw new Error("Set JWT_SECRET to a random value of at least 32 characters in backend/.env.");
if (process.env.SMTP_HOST && (!process.env.SMTP_FROM || (process.env.SMTP_USER && !process.env.SMTP_PASS))) throw new Error("SMTP requires SMTP_FROM and SMTP_PASS when SMTP_USER is set.");
const path = require("path");
const express = require("express");
const cors = require("cors");

const { attachUser } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const artistRoutes = require("./routes/artists");
const eventRoutes = require("./routes/events");
const bookingRoutes = require("./routes/bookings");
const applicationRoutes = require("./routes/applications");
const collaborationRoutes = require("./routes/collaborations");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");

require("./payments/provider").configuration();
require("./auth/email").validateEmailConfiguration();
const app = express();

app.disable("x-powered-by");
app.use(cors({origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : false}));
app.use((req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","same-origin");res.setHeader("X-Frame-Options","DENY");next();});
// Signature verification must see the exact bytes, before JSON parsing or auth middleware.
app.post("/api/payments/webhook",express.raw({type:"application/json",limit:"1mb"}),async(req,res)=>{
 try {
  if(!Buffer.isBuffer(req.body))return res.status(400).json({error:"Expected the raw JSON webhook body."});
  res.json(await require("./payments/service").webhook(app,req.body,req.headers["x-razorpay-signature"],req.headers["x-razorpay-event-id"]));
 }catch(err){res.status(err.status||503).json({error:err.status?err.message:"Webhook reconciliation unavailable. Retry later."});}
});
app.use("/api/auth",(req,res,next)=>{
 const requestId=require("crypto").randomUUID();res.set("X-Request-Id",requestId);
 if(process.env.AUTH_AUDIT_LOG==="true"){
  const known=["/register","/login","/verify-email","/resend-verification","/me","/logout","/forgot-password","/reset-password"];
  const action=known.includes(req.path)?req.path:"unknown";
  res.on("finish",()=>console.info(JSON.stringify({event:"auth_request",requestId,action,status:res.statusCode})));
 }
 next();
});
app.use('/api/media',attachUser,require('./platform/media').router);
// Streaming imports must reach their consumer before any body buffering middleware.
app.use('/api/recruitment', (req,res,next)=>{
 if(req.method!=='POST'||req.path!=='/imports')return next();
 attachUser(req,res,()=>require('./recruitment/routes').router(req,res,next));
});
app.use(express.json({limit:"7mb"}));
app.use("/api",(req,res,next)=>{
 for(const value of Object.values(req.query))if(typeof value!=="string")return res.status(400).json({error:"Query parameters must be text."});
 function valid(value,key){if(key==='expression'&&req.method==='POST'&&['/recruitment/rules','/recruitment/rules/validate'].includes(req.path))return typeof value==='string'&&value.length<=4096&&!/\u0000/.test(value);if(key==="password"&&req.path.startsWith("/auth/"))return typeof value==="string"&&value.length<=4096;if(typeof value==="string")return value.length<=12000 && !/[<>\u0000]/.test(value);if(Array.isArray(value))return value.length<=(req.path==='/recruitment/templates'?512:50)&&value.every(valid);if(value&&typeof value==="object")return Object.entries(value).every(([name,item])=>valid(item,name));return true;}
 if(req.path.endsWith("/portfolio"))return next();
 const textKeys=["name","email","password","role","location","category","bio","availability","eventId","artistId","toId","message","eventName","date","duration","notes","description","token","time","venue","talent","budget","deadline","status"];
 if(!req.body || Array.isArray(req.body) || typeof req.body!=="object")return res.status(400).json({error:"Expected a JSON object."});
 for(const key of textKeys)if(req.body[key]!==undefined && typeof req.body[key]!=="string")return res.status(400).json({error:`${key} must be text.`});
 if(!valid(req.body))return res.status(400).json({error:"Input contains unsupported characters or is too long."});
 next();
});
app.use(attachUser);
app.use('/api/recruitment',require('./recruitment/routes').router);

app.get("/api/health", (req, res) => {require("./db").prepare("SELECT 1").get();res.json({ ok: true, database:"sqlite" });});
app.get("/config.js",(req,res)=>res.type("application/javascript").send(`window.TALENTSPHERE_API_BASE=${JSON.stringify(process.env.PUBLIC_API_BASE || "/api").replace(/</g,"\\u003c")};`));

app.use('/api/studio',require('./platform/profiles'));
app.use('/api/studio',require('./platform/community'));
app.use('/api/studio',require('./platform/bookings').router);
app.use("/api/auth", authRoutes);
app.use("/api/artists", artistRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", require("./routes/payments"));
app.use("/api/applications", applicationRoutes);
app.use("/api/collaborations", collaborationRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);

// Serve the frontend as static files so the whole app can run from one process.
const frontendDir = path.join(__dirname, "..", "..", "frontend");
app.use(express.static(frontendDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.use("/api", (req,res)=>res.status(404).json({error:"API route not found."}));

// Central error handler
app.use((err, req, res, next) => {
  const status = err.status || (err.code?.startsWith("SQLITE_CONSTRAINT") ? 400 : 500);
  res.status(status).json({ error: status === 500 ? "Something went wrong on the server." : "Invalid request. Check the submitted fields." });
});

module.exports = app;
if (require.main === module) {
 const PORT = process.env.PORT || 4000;
 require('./platform/outbox').start(app);
 require('./recruitment/routes').service.ready.then(()=>{
 const server=app.listen(PORT,()=>console.log(`TalentSphere running at http://localhost:${PORT}`));
 server.on("error",err=>{console.error(`Startup failed: ${err.code}. Check PORT and database configuration.`);process.exitCode=1;});
 }).catch(()=>{console.error('Recruitment initialization failed; startup stopped.');process.exitCode=1;});
}
