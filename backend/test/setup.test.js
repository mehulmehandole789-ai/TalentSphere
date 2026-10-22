const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('fresh optional seed is labeled, repeatable and preserves all rows',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'talentsphere-seed-'));
 try{
 const env={...process.env,DATABASE_PATH:path.join(dir,'seed.db')};
 const run=()=>spawnSync(process.execPath,['src/db/seed.js'],{cwd:path.join(__dirname,'..'),env,encoding:'utf8'});
 const first=run();assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/fictional DEMO/);
 const Database=require('better-sqlite3'),db=new Database(env.DATABASE_PATH);
 const before=db.prepare('SELECT * FROM users ORDER BY id').all();assert.equal(before.length,11);assert.ok(before.every(u=>u.name.startsWith('[Demo]')));
 const second=run();assert.equal(second.status,0,second.stderr);assert.match(second.stdout,/skipped/);assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n,7);db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('admin bootstrap creates only the requested account and refuses existing email',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'talentsphere-admin-'));
 try{
 const env={...process.env,DATABASE_PATH:path.join(dir,'admin.db'),ADMIN_EMAIL:'owner@example.test',ADMIN_PASSWORD:'IsolatedAdmin123!'};
 const run=()=>spawnSync(process.execPath,['src/db/create-admin.js'],{cwd:path.join(__dirname,'..'),env,encoding:'utf8'});
 assert.equal(run().status,0);assert.equal(run().status,1);
 const db=new (require('better-sqlite3'))(env.DATABASE_PATH);const row=db.prepare('SELECT * FROM users').get();assert.equal(row.role,'admin');assert.equal(row.email,env.ADMIN_EMAIL);assert.ok(require('bcryptjs').compareSync(env.ADMIN_PASSWORD,row.passwordHash));assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
