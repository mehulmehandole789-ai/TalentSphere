'use strict';

// Keep the established SQL/API interface as views; mutable list facts live only
// in child relations. Renaming parent tables updates SQLite's existing FKs.
const quote = name => '"' + name.replace(/"/g, '""') + '"';
const numericTypes = "'integer','real'";
const scalarJSON = alias => `CASE ${alias}.value_type WHEN 'text' THEN json_quote(${alias}.text_value) WHEN 'null' THEN 'null' WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(${alias}.number_value AS TEXT) END`;

function supported(db) {
  return ['artist_profiles', 'artist_packages', 'events'].every(name =>
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) &&
    db.prepare('PRAGMA table_info(artist_profiles)').all().some(c => c.name === 'userId');
}

function assertJSON(db, table, column, type) {
  const row = db.prepare(`SELECT id FROM ${quote(table)} WHERE NOT json_valid(${quote(column)}) OR CASE WHEN json_valid(${quote(column)}) THEN json_type(${quote(column)})<>? ELSE 0 END LIMIT 1`).get(type);
  if (row) throw new Error(`Normalization stopped: ${table}.${column} contains invalid ${type} JSON. No records were changed.`);
}

function archive(db, table, column) {
  db.prepare(`INSERT INTO legacy_normalization_archive(entity,entity_id,attribute,original_value) SELECT ?,id,?,${quote(column)} FROM ${quote(table)}`).run(table, column);
}

function makeView(db, name, core, computed, insertExtra = '', updateExtra = '') {
  const columns = db.prepare(`PRAGMA table_info(${quote(core)})`).all();
  const expressions = columns.map(c => 'c.' + quote(c.name));
  for (const [column, expression] of Object.entries(computed)) expressions.push(`${expression} AS ${quote(column)}`);
  db.exec(`CREATE VIEW ${quote(name)} AS SELECT ${expressions.join(',')} FROM ${quote(core)} c`);
  const insertion = columns.map(c => c.dflt_value == null ? `NEW.${quote(c.name)}` : `COALESCE(NEW.${quote(c.name)},${c.dflt_value})`);
  db.exec(`CREATE TRIGGER ${quote(name + '_compat_insert')} INSTEAD OF INSERT ON ${quote(name)} BEGIN
    INSERT INTO ${quote(core)}(${columns.map(c => quote(c.name)).join(',')}) VALUES(${insertion.join(',')});
    ${insertExtra}
  END;
  CREATE TRIGGER ${quote(name + '_compat_update')} INSTEAD OF UPDATE ON ${quote(name)} BEGIN
    SELECT CASE WHEN NEW.id<>OLD.id THEN RAISE(ABORT,'Entity IDs are immutable') END;
    UPDATE ${quote(core)} SET ${columns.filter(c => c.name !== 'id').map(c => `${quote(c.name)}=NEW.${quote(c.name)}`).join(',')} WHERE id=OLD.id;
    ${updateExtra || insertExtra}
  END;
  CREATE TRIGGER ${quote(name + '_compat_delete')} INSTEAD OF DELETE ON ${quote(name)} BEGIN
    DELETE FROM ${quote(core)} WHERE id=OLD.id;
  END;`);
}

function normalize(db) {
  if (!db.inTransaction) throw new Error('Legacy normalization requires a migration transaction');
  for (const column of ['skills', 'media']) assertJSON(db, 'artist_profiles', column, 'array');
  assertJSON(db, 'artist_profiles', 'details', 'object');
  assertJSON(db, 'artist_packages', 'extras', 'array');
  // Existing routes only support string skills/media and named numeric extras.
  // Do not silently discard a malformed historical fact during decomposition.
  for (const column of ['skills', 'media']) {
    if (db.prepare(`SELECT 1 FROM artist_profiles a,json_each(a.${column}) j WHERE j.type<>'text' LIMIT 1`).get())
      throw new Error(`Normalization stopped: non-text ${column}; original records retained.`);
  }
  if (db.prepare(`SELECT 1 FROM artist_packages p,json_each(p.extras) j WHERE j.type<>'object' OR COALESCE(json_type(j.value,'$.name'),'null')<>'text' OR COALESCE(json_type(j.value,'$.amountPaise'),'null') NOT IN (${numericTypes}) OR json_extract(j.value,'$.amountPaise')<>CAST(json_extract(j.value,'$.amountPaise') AS INTEGER) OR json_extract(j.value,'$.amountPaise')<0 OR EXISTS(SELECT 1 FROM json_each(j.value) f WHERE f.key NOT IN ('name','amountPaise')) LIMIT 1`).get())
    throw new Error('Normalization stopped: invalid package extras; original records retained.');

  db.exec(`CREATE TABLE legacy_normalization_archive(
    entity TEXT NOT NULL,entity_id TEXT NOT NULL,attribute TEXT NOT NULL,original_value TEXT NOT NULL,
    PRIMARY KEY(entity,entity_id,attribute));
    CREATE TRIGGER normalization_archive_no_update BEFORE UPDATE ON legacy_normalization_archive BEGIN SELECT RAISE(ABORT,'Normalization history is immutable'); END;
    CREATE TRIGGER normalization_archive_no_delete BEFORE DELETE ON legacy_normalization_archive BEGIN SELECT RAISE(ABORT,'Normalization history is immutable'); END;`);
  for (const column of ['skills', 'media', 'details']) archive(db, 'artist_profiles', column);
  archive(db, 'artist_packages', 'extras');
  archive(db, 'events', 'organizerName');
  archive(db, 'events', 'talent');

  db.exec(`DROP TRIGGER IF EXISTS artist_skills_insert;
    DROP TRIGGER IF EXISTS artist_skills_update;
    ALTER TABLE artist_profiles RENAME TO artist_profile_core;
    ALTER TABLE artist_packages RENAME TO artist_package_core;
    ALTER TABLE events RENAME TO event_core;
    CREATE TABLE artist_profile_skills(artist_id TEXT NOT NULL REFERENCES artist_profile_core(id) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position>=0),skill TEXT NOT NULL,PRIMARY KEY(artist_id,position));
    CREATE TABLE artist_portfolio_items(artist_id TEXT NOT NULL REFERENCES artist_profile_core(id) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position>=0),url TEXT NOT NULL,PRIMARY KEY(artist_id,position));
    CREATE TABLE artist_detail_fields(artist_id TEXT NOT NULL REFERENCES artist_profile_core(id) ON DELETE CASCADE,field TEXT NOT NULL,value_type TEXT NOT NULL CHECK(value_type IN ('text','integer','real','true','false','null')),text_value TEXT,number_value REAL,PRIMARY KEY(artist_id,field));
    CREATE TABLE artist_detail_lists(artist_id TEXT NOT NULL REFERENCES artist_profile_core(id) ON DELETE CASCADE,field TEXT NOT NULL,PRIMARY KEY(artist_id,field));
    CREATE TABLE artist_detail_list_items(artist_id TEXT NOT NULL,field TEXT NOT NULL,position INTEGER NOT NULL CHECK(position>=0),value_type TEXT NOT NULL CHECK(value_type IN ('text','integer','real','true','false','null')),text_value TEXT,number_value REAL,PRIMARY KEY(artist_id,field,position),FOREIGN KEY(artist_id,field) REFERENCES artist_detail_lists(artist_id,field) ON DELETE CASCADE);
    CREATE TABLE artist_detail_extensions(artist_id TEXT NOT NULL REFERENCES artist_profile_core(id) ON DELETE RESTRICT,field TEXT NOT NULL,historical_value TEXT NOT NULL CHECK(json_valid(historical_value)),PRIMARY KEY(artist_id,field));
    CREATE TRIGGER detail_extensions_no_update BEFORE UPDATE ON artist_detail_extensions BEGIN SELECT RAISE(ABORT,'Legacy extension is historical'); END;
    CREATE TRIGGER detail_extensions_no_delete BEFORE DELETE ON artist_detail_extensions BEGIN SELECT RAISE(ABORT,'Legacy extension is historical'); END;
    CREATE TABLE package_extras(package_id TEXT NOT NULL REFERENCES artist_package_core(id) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position>=0),name TEXT NOT NULL,amount_paise INTEGER NOT NULL CHECK(typeof(amount_paise)='integer' AND amount_paise>=0),PRIMARY KEY(package_id,position));
    CREATE TABLE event_publication_labels(event_id TEXT PRIMARY KEY REFERENCES event_core(id) ON DELETE CASCADE,organizer_name_at_publication TEXT NOT NULL);
    CREATE TABLE event_talent_requirements(event_id TEXT NOT NULL REFERENCES event_core(id) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position>=0),requirement_text TEXT NOT NULL,PRIMARY KEY(event_id,position));
    INSERT INTO artist_profile_skills SELECT a.id,CAST(j.key AS INTEGER),j.value FROM artist_profile_core a,json_each(a.skills) j;
    INSERT INTO artist_portfolio_items SELECT a.id,CAST(j.key AS INTEGER),j.value FROM artist_profile_core a,json_each(a.media) j;
    INSERT INTO artist_detail_fields SELECT a.id,j.key,j.type,CASE WHEN j.type='text' THEN j.value END,CASE WHEN j.type IN (${numericTypes}) THEN j.value END FROM artist_profile_core a,json_each(a.details) j WHERE j.type NOT IN ('array','object');
    INSERT INTO artist_detail_lists SELECT a.id,j.key FROM artist_profile_core a,json_each(a.details) j WHERE j.type='array' AND NOT EXISTS(SELECT 1 FROM json_each(j.value) item WHERE item.type IN ('array','object'));
    INSERT INTO artist_detail_list_items SELECT a.id,j.key,CAST(item.key AS INTEGER),item.type,CASE WHEN item.type='text' THEN item.value END,CASE WHEN item.type IN (${numericTypes}) THEN item.value END FROM artist_profile_core a,json_each(a.details) j JOIN artist_detail_lists l ON l.artist_id=a.id AND l.field=j.key,json_each(CASE WHEN j.type='array' THEN j.value ELSE '[]' END) item;
    INSERT INTO artist_detail_extensions SELECT a.id,j.key,j.value FROM artist_profile_core a,json_each(a.details) j WHERE j.type='object' OR (j.type='array' AND EXISTS(SELECT 1 FROM json_each(j.value) item WHERE item.type IN ('array','object')));
    INSERT INTO package_extras SELECT p.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.name'),json_extract(j.value,'$.amountPaise') FROM artist_package_core p,json_each(p.extras) j;
    INSERT INTO event_publication_labels SELECT id,organizerName FROM event_core;
    INSERT INTO event_talent_requirements SELECT e.id,CAST(j.key AS INTEGER),j.value FROM event_core e,json_each('['||replace(json_quote(e.talent),',','","')||']') j;
    DROP TABLE artist_skill_facts;
    ALTER TABLE artist_profile_core DROP COLUMN skills;
    ALTER TABLE artist_profile_core DROP COLUMN media;
    ALTER TABLE artist_profile_core DROP COLUMN details;
    ALTER TABLE artist_package_core DROP COLUMN extras;
    ALTER TABLE event_core DROP COLUMN organizerName;
    ALTER TABLE event_core DROP COLUMN talent;
    CREATE VIEW artist_skill_facts AS SELECT DISTINCT artist_id,skill FROM artist_profile_skills;`);

  const details = `(SELECT json_group_object(field,json(value_json)) FROM (
    SELECT d.field,${scalarJSON('d')} value_json FROM artist_detail_fields d WHERE d.artist_id=c.id
    UNION ALL SELECT l.field,(SELECT json_group_array(json(value_json)) FROM (SELECT ${scalarJSON('i')} value_json FROM artist_detail_list_items i WHERE i.artist_id=l.artist_id AND i.field=l.field ORDER BY i.position)) FROM artist_detail_lists l WHERE l.artist_id=c.id
    UNION ALL SELECT x.field,x.historical_value FROM artist_detail_extensions x WHERE x.artist_id=c.id))`;
  const detailWrite = `
    SELECT CASE WHEN NOT json_valid(COALESCE(NEW.details,'{}')) OR json_type(COALESCE(NEW.details,'{}'))<>'object' THEN RAISE(ABORT,'Profile details must be a JSON object') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(COALESCE(NEW.details,'{}')) j WHERE (j.type='object' OR (j.type='array' AND EXISTS(SELECT 1 FROM json_each(j.value) item WHERE item.type IN ('array','object')))) AND NOT EXISTS(SELECT 1 FROM artist_detail_extensions x WHERE x.artist_id=NEW.id AND x.field=j.key AND json(x.historical_value)=json(j.value))) THEN RAISE(ABORT,'Nested legacy extensions are immutable; use supported profile fields') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM artist_detail_extensions x WHERE x.artist_id=NEW.id AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(NEW.details,'{}')) j WHERE j.key=x.field AND j.type IN ('array','object') AND json(j.value)=json(x.historical_value))) THEN RAISE(ABORT,'Historical extensions must be retained') END;
    DELETE FROM artist_detail_fields WHERE artist_id=NEW.id;
    DELETE FROM artist_detail_lists WHERE artist_id=NEW.id;
    INSERT INTO artist_detail_fields SELECT NEW.id,j.key,j.type,CASE WHEN j.type='text' THEN j.value END,CASE WHEN j.type IN (${numericTypes}) THEN j.value END FROM json_each(COALESCE(NEW.details,'{}')) j WHERE j.type NOT IN ('array','object');
    INSERT INTO artist_detail_lists SELECT NEW.id,j.key FROM json_each(COALESCE(NEW.details,'{}')) j WHERE j.type='array' AND NOT EXISTS(SELECT 1 FROM json_each(j.value) item WHERE item.type IN ('array','object'));
    INSERT INTO artist_detail_list_items SELECT NEW.id,j.key,CAST(item.key AS INTEGER),item.type,CASE WHEN item.type='text' THEN item.value END,CASE WHEN item.type IN (${numericTypes}) THEN item.value END FROM json_each(COALESCE(NEW.details,'{}')) j JOIN artist_detail_lists l ON l.artist_id=NEW.id AND l.field=j.key,json_each(CASE WHEN j.type='array' THEN j.value ELSE '[]' END) item;
  `;
  const profileWrite = `
    SELECT CASE WHEN NOT json_valid(COALESCE(NEW.skills,'[]')) OR json_type(COALESCE(NEW.skills,'[]'))<>'array' THEN RAISE(ABORT,'Skills must be a JSON array') END;
    SELECT CASE WHEN NOT json_valid(COALESCE(NEW.media,'[]')) OR json_type(COALESCE(NEW.media,'[]'))<>'array' THEN RAISE(ABORT,'Portfolio must be a JSON array') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(COALESCE(NEW.skills,'[]')) WHERE type<>'text') OR EXISTS(SELECT 1 FROM json_each(COALESCE(NEW.media,'[]')) WHERE type<>'text') THEN RAISE(ABORT,'Skills and media must contain text') END;
    DELETE FROM artist_profile_skills WHERE artist_id=NEW.id;
    INSERT INTO artist_profile_skills SELECT NEW.id,CAST(key AS INTEGER),value FROM json_each(COALESCE(NEW.skills,'[]'));
    DELETE FROM artist_portfolio_items WHERE artist_id=NEW.id;
    INSERT INTO artist_portfolio_items SELECT NEW.id,CAST(key AS INTEGER),value FROM json_each(COALESCE(NEW.media,'[]'));
    ${detailWrite}`;
  makeView(db, 'artist_profiles', 'artist_profile_core', {
    skills: `(SELECT json_group_array(skill) FROM (SELECT skill FROM artist_profile_skills WHERE artist_id=c.id ORDER BY position))`,
    media: `(SELECT json_group_array(url) FROM (SELECT url FROM artist_portfolio_items WHERE artist_id=c.id ORDER BY position))`,
    details
  }, profileWrite);

  const extrasWrite = `
    SELECT CASE WHEN NOT json_valid(COALESCE(NEW.extras,'[]')) OR json_type(COALESCE(NEW.extras,'[]'))<>'array' THEN RAISE(ABORT,'Extras must be a JSON array') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(COALESCE(NEW.extras,'[]')) j WHERE j.type<>'object' OR COALESCE(json_type(j.value,'$.name'),'null')<>'text' OR COALESCE(json_type(j.value,'$.amountPaise'),'null') NOT IN (${numericTypes}) OR json_extract(j.value,'$.amountPaise')<>CAST(json_extract(j.value,'$.amountPaise') AS INTEGER) OR json_extract(j.value,'$.amountPaise')<0 OR EXISTS(SELECT 1 FROM json_each(j.value) f WHERE f.key NOT IN ('name','amountPaise'))) THEN RAISE(ABORT,'Invalid package extra') END;
    DELETE FROM package_extras WHERE package_id=NEW.id;
    INSERT INTO package_extras SELECT NEW.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.name'),json_extract(j.value,'$.amountPaise') FROM json_each(COALESCE(NEW.extras,'[]')) j;`;
  makeView(db, 'artist_packages', 'artist_package_core', {
    extras: `(SELECT json_group_array(json_object('name',name,'amountPaise',amount_paise)) FROM (SELECT name,amount_paise FROM package_extras WHERE package_id=c.id ORDER BY position))`
  }, extrasWrite);
  const talentWrite=`SELECT CASE WHEN NEW.talent IS NULL THEN RAISE(ABORT,'Talent requirements are required') END;
    DELETE FROM event_talent_requirements WHERE event_id=NEW.id;
    INSERT INTO event_talent_requirements SELECT NEW.id,CAST(key AS INTEGER),value FROM json_each('['||replace(json_quote(CAST(NEW.talent AS TEXT)),',','","')||']');`;
  makeView(db, 'events', 'event_core', {
    organizerName: `(SELECT organizer_name_at_publication FROM event_publication_labels WHERE event_id=c.id)`,
    talent: `(SELECT group_concat(requirement_text,',') FROM (SELECT requirement_text FROM event_talent_requirements WHERE event_id=c.id ORDER BY position))`
  }, `INSERT INTO event_publication_labels VALUES(NEW.id,NEW.organizerName);${talentWrite}`, `
    SELECT CASE WHEN NEW.organizerName IS NOT OLD.organizerName THEN RAISE(ABORT,'Publication name is historical') END;${talentWrite}`);

  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error('Normalization produced foreign-key violations; migration rolled back.');
}

module.exports = {normalize, supported};
