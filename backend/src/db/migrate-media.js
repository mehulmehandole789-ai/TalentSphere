// Optional additive migration of legacy data URLs to the existing local file store.
require('dotenv').config({path:require('node:path').join(__dirname,'../../.env')});
const db=require('./index'),{store}=require('../platform/media');
let migrated=0;
try{
 for(const profile of db.prepare('SELECT * FROM artist_profiles').all()){
  const media=JSON.parse(profile.media||'[]'),next=[];
  for(const url of media){
   const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
   if(match){next.push(store(profile,Buffer.from(match[2],'base64'),match[1]).url);migrated++;}else next.push(url);
  }
  db.prepare('UPDATE artist_profiles SET media=? WHERE id=?').run(JSON.stringify(next),profile.id);
 }
 console.log('Moved '+migrated+' legacy images to local files. All other profile and account data was preserved.');
}finally{db.close();}
