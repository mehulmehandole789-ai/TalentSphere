'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const Database=require('better-sqlite3'),{Recruitment}=require('../src/recruitment/service');
const backend=path.resolve(__dirname,'..');
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-normalization-'));
  const filename=path.join(dir,'legacy.db');
  const result=spawnSync(process.execPath,['src/db/seed.js'],{cwd:backend,env:{...process.env,DATABASE_PATH:filename},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const db=new Database(filename);db.pragma('foreign_keys=ON');
  return {dir,filename,db};
}
const jsonColumns=new Set(['skills','details','media','extras']);
function semantic(rows){return rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,jsonColumns.has(k)?JSON.parse(v):v])));}
test('v3 decomposes actual nonempty legacy facts, preserves ordered API values, FKs and restart compatibility',async()=>{
  const {dir,filename,db}=fixture();let service;
  try{
    const profile=db.prepare('SELECT * FROM artist_profiles ORDER BY id LIMIT 1').get();
    const data={genres:['Jazz','Jazz','Fusion'],languages:[],timeZone:'Asia/Kolkata',equipment:'PA',customNull:null,customBoolean:true,customNumber:7,legacyExtension:{original:['retained']}};
    db.prepare('UPDATE artist_profiles SET skills=?,media=?,details=? WHERE id=?').run('["Guitar","Vocals","Guitar"]','["/legacy-one.jpg","/legacy-two.jpg"]',JSON.stringify(data),profile.id);
    const extras=[{name:'Extra set',amountPaise:250000},{name:'Extra set',amountPaise:500000}];
    db.prepare('INSERT INTO artist_packages(id,artistId,name,description,durationMinutes,basePricePaise,extras) VALUES(?,?,?,?,?,?,?)').run('legacy-package',profile.id,'Legacy package','Original terms',60,1000000,JSON.stringify(extras));
    const event=db.prepare('SELECT * FROM events ORDER BY id LIMIT 1').get();
    db.prepare('UPDATE users SET name=? WHERE id=?').run('New account name',event.organizerId);
    const before=Object.fromEntries(['artist_profiles','artist_packages','events','users','bookings','payment_orders'].map(t=>[t,semantic(db.prepare('SELECT * FROM '+t+' ORDER BY id').all())]));
    service=new Recruitment(db);await service.ready;
    for(const t of Object.keys(before))assert.deepEqual(semantic(db.prepare('SELECT * FROM '+t+' ORDER BY id').all()),before[t],t+' semantic values changed');
    for(const [view,core,removed] of [['artist_profiles','artist_profile_core',['skills','media','details']],['artist_packages','artist_package_core',['extras']],['events','event_core',['organizerName']]]){
      assert.equal(db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(view).type,'view');
      const columns=db.prepare('PRAGMA table_info('+core+')').all().map(c=>c.name);for(const name of removed)assert.equal(columns.includes(name),false);
    }
    assert.deepEqual(db.prepare('SELECT skill FROM artist_profile_skills WHERE artist_id=? ORDER BY position').all(profile.id).map(r=>r.skill),['Guitar','Vocals','Guitar']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM package_extras WHERE package_id=?').get('legacy-package').n,2);
    assert.equal(db.prepare('SELECT organizerName FROM events WHERE id=?').get(event.id).organizerName,event.organizerName);
    assert.ok(db.prepare('PRAGMA foreign_key_list(bookings)').all().some(r=>r.table==='artist_profile_core'));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.throws(()=>db.prepare('UPDATE legacy_normalization_archive SET original_value=?').run('tamper'),/immutable/);
    const next={...data,equipment:'Updated PA',genres:['Acoustic']};
    db.prepare('UPDATE artist_profiles SET details=? WHERE id=?').run(JSON.stringify(next),profile.id);
    assert.deepEqual(JSON.parse(db.prepare('SELECT details FROM artist_profiles WHERE id=?').get(profile.id).details),next);
    assert.throws(()=>db.prepare('UPDATE artist_profiles SET details=? WHERE id=?').run(JSON.stringify({...next,legacyExtension:{changed:true}}),profile.id),/immutable/);
    assert.throws(()=>db.prepare('UPDATE artist_packages SET extras=? WHERE id=?').run('[{"name":"Bad","amountPaise":1.5}]','legacy-package'),/Invalid/);
    assert.deepEqual(JSON.parse(db.prepare('SELECT extras FROM artist_packages WHERE id=?').get('legacy-package').extras),extras);
    service.close();service=null;db.close();
    // Exercise the unchanged legacy db initialization and optional seeder against the views.
    const restart=spawnSync(process.execPath,['src/db/seed.js'],{cwd:backend,env:{...process.env,DATABASE_PATH:filename},encoding:'utf8'});
    assert.equal(restart.status,0,restart.stderr);assert.match(restart.stdout,/skipped/);
    const reopened=new Database(filename);assert.equal(reopened.prepare('SELECT COUNT(*) n FROM users').get().n,11);assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(),[]);reopened.close();
  }finally{if(service)service.close();if(db.open)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('v3 rejects malformed historical list data before any partial normalization save',async()=>{
  const {dir,db}=fixture();let service;
  try{
    db.prepare('UPDATE artist_profiles SET skills=? WHERE id=(SELECT id FROM artist_profiles LIMIT 1)').run('[{"unexpected":"object"}]');
    service=new Recruitment(db);await assert.rejects(service.ready,/non-text skills/);
    assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name='artist_profiles'").get().type,'table');
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='artist_profile_core'").get(),undefined);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,11);
  }finally{if(service?.spill)service.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
