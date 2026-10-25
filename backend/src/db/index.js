const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(__dirname, "..", "..", "data.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// Additive migrations preserve existing records.
for (const [table, column, definition] of [["users","tokenVersion","INTEGER NOT NULL DEFAULT 0"],["bookings","notes","TEXT NOT NULL DEFAULT ''"],["events","description","TEXT NOT NULL DEFAULT ''"],["users","suspended","INTEGER NOT NULL DEFAULT 0"],["artist_profiles","media","TEXT NOT NULL DEFAULT '[]'"]]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
// Existing confirmed/completed bookings remain historical agreements, not paid transactions.
const paymentColumns = [
 ["artistFeePaise", "INTEGER"], ["platformFeePaise", "INTEGER"],
 ["finalAmountPaise", "INTEGER"], ["paymentStatus", "TEXT NOT NULL DEFAULT 'unpaid'"],
 ["paymentRequired", "INTEGER NOT NULL DEFAULT 0"]
];
for (const [column, definition] of paymentColumns) {
 if (!db.prepare("PRAGMA table_info(bookings)").all().some(c => c.name === column)) db.exec(`ALTER TABLE bookings ADD COLUMN ${column} ${definition}`);
}
db.prepare("UPDATE bookings SET artistFeePaise = CAST(ROUND(fee * 100) AS INTEGER), platformFeePaise = CAST(ROUND(platformFee * 100) AS INTEGER) WHERE artistFeePaise IS NULL").run();
db.prepare("UPDATE bookings SET finalAmountPaise = artistFeePaise + platformFeePaise, paymentRequired = CASE WHEN status IN ('Pending','Accepted') THEN 1 ELSE 0 END WHERE finalAmountPaise IS NULL").run();
db.exec(fs.readFileSync(path.join(__dirname, "../payments/schema.sql"), "utf8"));
// Explicit verification migration policy: existing accounts are NOT grandfathered as verified.
for(const [column,definition] of [["emailVerified","INTEGER NOT NULL DEFAULT 0"],["emailVerifiedAt","TEXT"],["approvalStatus","TEXT NOT NULL DEFAULT 'not_required'"]]){
 if(!db.prepare("PRAGMA table_info(users)").all().some(c=>c.name===column))db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
}
const collisions=db.prepare("SELECT COUNT(*) n FROM (SELECT LOWER(TRIM(email)) FROM users GROUP BY LOWER(TRIM(email)) HAVING COUNT(*)>1)").get().n;
if(collisions)throw new Error("Existing accounts have conflicting normalized email addresses. Resolve ownership with administrator review; no users were deleted or merged.");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized ON users(LOWER(TRIM(email)))");
db.exec(fs.readFileSync(path.join(__dirname,"../auth/schema.sql"),"utf8"));
// Connected platform migration: add fields without rewriting historical agreements.
const platformColumns = {
 artist_profiles: [["details", "TEXT NOT NULL DEFAULT '{}'"],["visibility", "TEXT NOT NULL DEFAULT 'public'"],["moderationHidden","INTEGER NOT NULL DEFAULT 0"]],
 bookings: [["workflowVersion","INTEGER NOT NULL DEFAULT 1"],["startsAt","TEXT"],["endsAt","TEXT"],["timeZone","TEXT NOT NULL DEFAULT 'Asia/Kolkata'"],["packageId","TEXT"],["acceptedQuoteId","TEXT"],["agreedSnapshot","TEXT"],["reservationExpiresAt","INTEGER"],["resolutionReason","TEXT"]],
 reviews: [["bookingId","TEXT REFERENCES bookings(id)"],["authorId","TEXT REFERENCES users(id)"],["hidden","INTEGER NOT NULL DEFAULT 0"]],
 notifications: [["bookingId","TEXT REFERENCES bookings(id)"]]
};
for(const [table,columns] of Object.entries(platformColumns))for(const [column,definition] of columns){
 if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
db.exec(fs.readFileSync(path.join(__dirname,'../platform/schema.sql'),'utf8'));
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS review_per_booking ON reviews(bookingId) WHERE bookingId IS NOT NULL');
db.pragma('busy_timeout = 5000');
module.exports = db;
