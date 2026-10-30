'use strict';
const fs=require('node:fs'),path=require('node:path');
async function migrate(db){
 const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE name='recruitment_migrations'").get();
 const versions=new Set(exists?db.prepare('SELECT version FROM recruitment_migrations').all().map(r=>r.version):[]);
 const legacy=require('./normalize-legacy');
 if(versions.has(3)||(versions.has(2)&&!legacy.supported(db)))return;
 // backup() uses SQLite's online backup API, including committed WAL frames.
 if(db.name!==':memory:'){
  const dir=path.join(path.dirname(db.name),'backups');fs.mkdirSync(dir,{recursive:true});
  const target=path.join(dir,`before-recruitment-v${versions.has(2)?3:versions.has(1)?2:1}-${Date.now()}.db`);
  const schemaNames=db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  await db.backup(target);
  const copy=new (require('better-sqlite3'))(target,{readonly:true});
  try{if(copy.pragma('quick_check',{simple:true})!=='ok'||JSON.stringify(copy.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all())!==JSON.stringify(schemaNames))throw new Error('Online backup verification failed; migration stopped.');}finally{copy.close();}
 }
 db.transaction(()=>{if(!versions.has(1)){db.exec(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
 let cursor='';for(;;){const batch=db.prepare('SELECT id,skills FROM artist_profiles WHERE id>? ORDER BY id LIMIT 128').all(cursor);if(!batch.length)break;for(const row of batch){let skills;try{skills=JSON.parse(row.skills);}catch{continue;}if(Array.isArray(skills))for(const skill of skills)if(typeof skill==='string')db.prepare('INSERT OR IGNORE INTO artist_skill_facts VALUES(?,?)').run(row.id,skill);}cursor=batch.at(-1).id;}
 db.prepare('INSERT INTO recruitment_migrations VALUES(1,?)').run(new Date().toISOString());}
 if(!versions.has(2)){db.exec(fs.readFileSync(path.join(__dirname,'002-task-membership.sql'),'utf8'));
 db.prepare('INSERT INTO recruitment_migrations VALUES(2,?)').run(new Date().toISOString());}
 if(legacy.supported(db)){
  const before={profiles:db.prepare('SELECT COUNT(*) n FROM artist_profiles').get().n,packages:db.prepare('SELECT COUNT(*) n FROM artist_packages').get().n,events:db.prepare('SELECT COUNT(*) n FROM events').get().n};
  legacy.normalize(db);
  db.prepare('INSERT INTO recruitment_migrations VALUES(3,?)').run(new Date().toISOString());
  new(require('./audit').Audit)(db).append(null,'schema.normalized','schema',3,before,{...before,profileInterface:'writable view',mutableLists:'relational',archivedValues:db.prepare('SELECT COUNT(*) n FROM legacy_normalization_archive').get().n});
 }})();
}
module.exports={migrate};
