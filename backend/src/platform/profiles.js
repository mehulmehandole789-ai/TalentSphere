const express=require('express');
const C=require('./common');
const {db,id,safe,text,amount,list,range,zone,artist,visible,fail}=C;
const {requireRole}=require('../middleware/auth');
const router=express.Router();
function details(a){const d=JSON.parse(a.details||'{}');d.audioMedia=(d.performanceMedia||[]).filter(url=>db.prepare("SELECT id FROM artist_uploads WHERE id=? AND kind='audio'").get(url.replace('/api/media/','')));return d;}
router.get('/artists/:id',safe((req,res)=>{
 const a=visible(req.params.id,req.user),p=details(a);res.json({details:p,visibility:a.visibility,packages:db.prepare('SELECT * FROM artist_packages WHERE artistId=? AND active=1').all(a.id).map(v=>({...v,extras:JSON.parse(v.extras)})),verification:db.prepare('SELECT details,createdAt FROM artist_verifications WHERE artistId=? AND revoked=0 ORDER BY id DESC LIMIT 1').get(a.id)||null});
}));
router.get('/artists/:id/availability',safe((req,res)=>{
 const a=visible(req.params.id,req.user);
 const from=C.iso(req.query.from||new Date().toISOString()),to=C.iso(req.query.to||new Date(Date.now()+90*86400000).toISOString());
 if(to<=from||Date.parse(to)-Date.parse(from)>366*86400000)throw fail(400,'Choose a period of up to one year.');
 const blocks=db.prepare('SELECT startsAt,endsAt FROM availability_blocks WHERE artistId=? AND startsAt<? AND endsAt>?').all(a.id,to,from);
 const confirmed=db.prepare("SELECT startsAt,endsAt,date FROM bookings WHERE artistId=? AND status IN ('Confirmed','Completed')").all(a.id).map(b=>({startsAt:b.startsAt||b.date+'T00:00:00.000Z',endsAt:b.endsAt||new Date(Date.parse(b.date+'T00:00:00Z')+86400000).toISOString()})).filter(b=>b.startsAt<to&&b.endsAt>from);
 let available=null;if(req.query.startsAt&&req.query.endsAt){const r=range(req.query.startsAt,req.query.endsAt);available=!C.conflict(a.id,r.startsAt,r.endsAt);}
 res.json({timeZone:details(a).timeZone||'Asia/Kolkata',unavailable:[...blocks,...confirmed],available});
}));
router.get('/profile',requireRole('artist'),safe((req,res)=>{const a=artist(req.user);res.json({artist:require('../utils/serialize').artistOut(a,req.user),details:details(a),visibility:a.visibility,uploads:db.prepare('SELECT id,mime,kind,bytes FROM artist_uploads WHERE artistId=?').all(a.id).map(v=>({...v,url:'/api/media/'+v.id})),blocks:db.prepare('SELECT * FROM availability_blocks WHERE artistId=? ORDER BY startsAt').all(a.id),packages:db.prepare('SELECT * FROM artist_packages WHERE artistId=? ORDER BY createdAt DESC').all(a.id).map(v=>({...v,extras:JSON.parse(v.extras)}))});}));
router.patch('/profile',requireRole('artist'),safe((req,res)=>{
 const a=artist(req.user),next={...details(a)},body=req.body;
 for(const key of ['genres','languages','serviceLocations'])if(body[key]!==undefined)next[key]=list(body[key],key);
 for(const key of ['travelPreferences','equipment','venueRequirements'])if(body[key]!==undefined)next[key]=text(body[key],key,0,2000);
 if(body.timeZone!==undefined)next.timeZone=zone(body.timeZone);
 if(body.socialLinks!==undefined){if(!Array.isArray(body.socialLinks)||body.socialLinks.length>8)throw fail(400,'Use up to eight social links.');next.socialLinks=body.socialLinks.map(value=>{let u;try{u=new URL(value);}catch{throw fail(400,'Social links must be HTTPS URLs.');}if(u.protocol!=='https:'||u.username||u.password||u.href.length>500)throw fail(400,'Social links must be HTTPS URLs.');return u.href;});}
 for(const key of ['photo','cover','performanceMedia'])if(body[key]!==undefined){const values=key==='performanceMedia'?body[key]:body[key]?[body[key]]:[];if(!Array.isArray(values)||values.length>12)throw fail(400,'Invalid media selection.');for(const url of values){const m=db.prepare('SELECT * FROM artist_uploads WHERE id=? AND artistId=?').get(String(url).replace('/api/media/',''),a.id);if(!m||url!=='/api/media/'+m.id||(key!=='performanceMedia'&&m.kind!=='photo'))throw fail(400,'Choose your own uploaded media.');}next[key]=key==='performanceMedia'?values:(values[0]||'');}
 const visibility=body.visibility??a.visibility;if(!['public','private'].includes(visibility))throw fail(400,'Invalid visibility.');if(a.moderationHidden&&visibility==='public')throw fail(409,'An administrator must restore this moderated profile before it can be public.');
 db.prepare('UPDATE artist_profiles SET details=?,visibility=? WHERE id=?').run(JSON.stringify(next),visibility,a.id);res.json({details:next,visibility});
}));
router.delete('/uploads/:id',requireRole('artist'),safe((req,res)=>{
 const a=artist(req.user),record=db.prepare('SELECT * FROM artist_uploads WHERE id=? AND artistId=?').get(req.params.id,a.id);if(!record)throw fail(404,'Media not found.');
 const url='/api/media/'+record.id;if(a.details.includes(url)||a.media.includes(url))throw fail(409,'Remove this file from your profile and portfolio before deleting it.');
 require('node:fs').rmSync(require('node:path').join(require('./media').root,record.fileKey),{force:true});db.prepare('DELETE FROM artist_uploads WHERE id=?').run(record.id);res.json({ok:true});
}));
router.post('/packages',requireRole('artist'),safe((req,res)=>{
 const a=artist(req.user),b=req.body;
 const item={id:id('pkg_'),artistId:a.id,name:text(b.name,'Package name',2,100),description:text(b.description,'Description',5,2000),durationMinutes:b.durationMinutes,basePricePaise:amount(b.basePricePaise,'Base price',100),included:text(b.included||'','Included services',0,2000),equipment:text(b.equipment||'','Equipment',0,2000),travelPaise:amount(b.travelPaise||0),cancellationTerms:text(b.cancellationTerms,'Cancellation terms',5,2000)};
 if(!Number.isInteger(item.durationMinutes)||item.durationMinutes<15||item.durationMinutes>10080)throw fail(400,'Duration must be 15–10080 minutes.');
 if(!Array.isArray(b.extras||[])||(b.extras||[]).length>10)throw fail(400,'Use up to ten extras.');
 const extras=(b.extras||[]).map(v=>({name:text(v.name,'Extra',1,100),amountPaise:amount(v.amountPaise)}));
 db.prepare('INSERT INTO artist_packages(id,artistId,name,description,durationMinutes,basePricePaise,included,equipment,travelPaise,cancellationTerms,extras) VALUES(@id,@artistId,@name,@description,@durationMinutes,@basePricePaise,@included,@equipment,@travelPaise,@cancellationTerms,@extras)').run({...item,extras:JSON.stringify(extras)});res.status(201).json({...item,extras});
}));
router.patch('/packages/:id',requireRole('artist'),safe((req,res)=>{
 const a=artist(req.user),p=db.prepare('SELECT * FROM artist_packages WHERE id=? AND artistId=?').get(req.params.id,a.id);if(!p)throw fail(404,'Package not found.');if(req.body.active!==false)throw fail(400,'Archive this package and create its replacement. Accepted quotations preserve the original terms.');db.prepare('UPDATE artist_packages SET active=0 WHERE id=?').run(p.id);res.json({ok:true});
}));
router.post('/availability',requireRole('artist'),safe((req,res)=>{
 const a=artist(req.user),r=range(req.body.startsAt,req.body.endsAt);
 const block={id:id('av_'),artistId:a.id,...r,note:text(req.body.note||'','Note',0,300)};
 db.transaction(()=>{if(C.conflict(a.id,r.startsAt,r.endsAt))throw fail(409,'This time already contains an unavailable block, booking or reservation.');db.prepare('INSERT INTO availability_blocks(id,artistId,startsAt,endsAt,note) VALUES(@id,@artistId,@startsAt,@endsAt,@note)').run(block);}).immediate();res.status(201).json(block);
}));
router.delete('/availability/:id',requireRole('artist'),safe((req,res)=>{const result=db.prepare('DELETE FROM availability_blocks WHERE id=? AND artistId=?').run(req.params.id,artist(req.user).id);if(!result.changes)throw fail(404,'Availability block not found.');res.json({ok:true});}));
module.exports=router;
