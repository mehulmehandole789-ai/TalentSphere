require('dotenv').config({path:require('path').join(__dirname,'../../.env')});
const bcrypt=require('bcryptjs'),db=require('../db'),{id}=require('../utils/id');
const email=(process.env.ADMIN_EMAIL||'').trim().toLowerCase(),password=process.env.ADMIN_PASSWORD||'';
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||Buffer.byteLength(password)>72){console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (12 to 72 bytes) in backend/.env or your environment.');process.exitCode=1;}
else if(db.prepare('SELECT id FROM users WHERE email=?').get(email)){console.error('That email already exists. No account was changed.');process.exitCode=1;}
else{db.prepare('INSERT INTO users(id,email,passwordHash,name,role) VALUES(?,?,?,?,?)').run(id('u_'),email,bcrypt.hashSync(password,12),process.env.ADMIN_NAME||'Administrator','admin');console.log('Administrator created with an unverified email. Request a code from the verification page, verify your email, then log in. Remove ADMIN_PASSWORD from your environment.');}
db.close();
