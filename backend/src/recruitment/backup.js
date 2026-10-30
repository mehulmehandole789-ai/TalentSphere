'use strict';
// Separate process lets legacy synchronous CommonJS initialization wait for online backup.
const Database=require('better-sqlite3'),fs=require('node:fs'),path=require('node:path');
const source=process.argv[2],db=new Database(source,{readonly:true});
const dir=path.join(path.dirname(source),'backups');fs.mkdirSync(dir,{recursive:true});
db.backup(path.join(dir,`before-engine-initialization-${Date.now()}.db`)).then(()=>db.close()).catch(()=>{db.close();process.exitCode=1;});
