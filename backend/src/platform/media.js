const express=require('express'),fs=require('node:fs'),path=require('node:path');
const {db,id,artist,visible,safe,fail}=require('./common');
const {requireRole}=require('../middleware/auth');
const {rateLimit}=require('../auth/common');
const root=path.resolve(process.env.MEDIA_DIR||path.join(__dirname,'../../uploads'));
function identify(bytes){
 if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return ['image/png','png','photo'];
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return ['image/jpeg','jpg','photo'];
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return ['image/webp','webp','photo'];
 if(bytes.toString('ascii',4,8)==='ftyp')return ['video/mp4','mp4','video'];
 if(bytes.subarray(0,4).toString('hex')==='1a45dfa3')return ['video/webm','webm','video'];
 if(bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&0xe0)===0xe0))return ['audio/mpeg','mp3','audio'];
 if(bytes.toString('ascii',0,4)==='OggS')return ['audio/ogg','ogg','audio'];
 throw fail(400,'Use a valid PNG, JPEG, WebP, MP4, WebM, MP3 or Ogg file.');
}
function store(a,bytes,expected){
 const [mime,ext,kind]=identify(bytes);
 if(expected&&mime!==expected)throw fail(400,'The file content does not match its declared type.');
 if(bytes.length>(kind==='photo'?5:25)*1024*1024)throw fail(400,kind==='photo'?'Images must be at most 5 MB.':'Audio/video must be at most 25 MB.');
 if(db.prepare('SELECT COUNT(*) n FROM artist_uploads WHERE artistId=?').get(a.id).n>=24)throw fail(400,'Maximum 24 media files. Remove an unused file first.');
 const mediaId=id('media_'),fileKey=mediaId+'.'+ext;fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,fileKey),bytes,{flag:'wx',mode:0o600});
 try{db.prepare('INSERT INTO artist_uploads(id,artistId,fileKey,mime,kind,bytes) VALUES(?,?,?,?,?,?)').run(mediaId,a.id,fileKey,mime,kind,bytes.length);}catch(e){fs.unlinkSync(path.join(root,fileKey));throw e;}
 return {id:mediaId,url:'/api/media/'+mediaId,mime,kind,bytes:bytes.length};
}
const router=express.Router();
router.get('/:id',safe((req,res)=>{
 const record=db.prepare('SELECT * FROM artist_uploads WHERE id=?').get(req.params.id);if(!record)throw fail(404,'Media not found.');visible(record.artistId,req.user);
 res.set({'Content-Type':record.mime,'Cache-Control':'private, no-cache','Content-Disposition':'inline; filename="'+record.fileKey+'"'});res.sendFile(path.join(root,record.fileKey));
}));
router.post('/',requireRole('artist'),rateLimit('media-upload',30,3600000),express.raw({type:()=>true,limit:'25mb'}),safe((req,res)=>{
 if(!Buffer.isBuffer(req.body)||!req.body.length)throw fail(400,'Choose a media file.');res.status(201).json(store(artist(req.user),req.body,req.get('Content-Type')?.split(';')[0]));
}));
module.exports={router,store,root};
