CREATE TABLE IF NOT EXISTS artist_uploads (
 id TEXT PRIMARY KEY,artistId TEXT NOT NULL REFERENCES artist_profiles(id),fileKey TEXT UNIQUE NOT NULL,mime TEXT NOT NULL,kind TEXT NOT NULL,bytes INTEGER NOT NULL,
 createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS artist_packages (
 id TEXT PRIMARY KEY, artistId TEXT NOT NULL REFERENCES artist_profiles(id), name TEXT NOT NULL, description TEXT NOT NULL,
 durationMinutes INTEGER NOT NULL, basePricePaise INTEGER NOT NULL, included TEXT NOT NULL DEFAULT '', equipment TEXT NOT NULL DEFAULT '',
 travelPaise INTEGER NOT NULL DEFAULT 0, extras TEXT NOT NULL DEFAULT '[]', cancellationTerms TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
 createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS availability_blocks (
 id TEXT PRIMARY KEY, artistId TEXT NOT NULL REFERENCES artist_profiles(id), startsAt TEXT NOT NULL, endsAt TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 createdAt TEXT NOT NULL DEFAULT (datetime('now')), CHECK(endsAt>startsAt)
);
CREATE INDEX IF NOT EXISTS availability_artist_time ON availability_blocks(artistId,startsAt,endsAt);
CREATE TABLE IF NOT EXISTS booking_quotes (
 id TEXT PRIMARY KEY, bookingId TEXT NOT NULL REFERENCES bookings(id), items TEXT NOT NULL, totalPaise INTEGER NOT NULL,
 terms TEXT NOT NULL, expiresAt TEXT NOT NULL, snapshot TEXT NOT NULL, acceptedAt TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS booking_timeline (
 id INTEGER PRIMARY KEY AUTOINCREMENT, bookingId TEXT NOT NULL REFERENCES bookings(id), status TEXT NOT NULL, actorId TEXT REFERENCES users(id),
 note TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS booking_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, bookingId TEXT NOT NULL REFERENCES bookings(id), senderId TEXT NOT NULL REFERENCES users(id),
 text TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_booking_id ON booking_messages(bookingId,id);
CREATE TABLE IF NOT EXISTS booking_reads (bookingId TEXT REFERENCES bookings(id),userId TEXT REFERENCES users(id),lastId INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(bookingId,userId));
CREATE TABLE IF NOT EXISTS saved_artists (userId TEXT REFERENCES users(id),artistId TEXT REFERENCES artist_profiles(id),PRIMARY KEY(userId,artistId));
CREATE TABLE IF NOT EXISTS notification_outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT,userId TEXT NOT NULL REFERENCES users(id),bookingId TEXT REFERENCES bookings(id),text TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,nextAttemptAt INTEGER NOT NULL DEFAULT 0,lastError TEXT,createdAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS moderation_reports (
 id TEXT PRIMARY KEY, reporterId TEXT NOT NULL REFERENCES users(id),targetType TEXT NOT NULL,targetId TEXT NOT NULL,reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',resolution TEXT NOT NULL DEFAULT '',createdAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,adminId TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,targetId TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS artist_verifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,artistId TEXT NOT NULL REFERENCES artist_profiles(id),adminId TEXT NOT NULL REFERENCES users(id),
 details TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collaboration_posts (
 id TEXT PRIMARY KEY,artistId TEXT NOT NULL REFERENCES artist_profiles(id),title TEXT NOT NULL,description TEXT NOT NULL,requiredSkill TEXT NOT NULL,
 genre TEXT NOT NULL DEFAULT '',location TEXT NOT NULL,remote INTEGER NOT NULL DEFAULT 0,deadline TEXT NOT NULL,paid INTEGER NOT NULL DEFAULT 0,
 budgetPaise INTEGER,closed INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collaboration_entries (
 id TEXT PRIMARY KEY,postId TEXT NOT NULL REFERENCES collaboration_posts(id),artistId TEXT NOT NULL REFERENCES artist_profiles(id),message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Pending',createdAt TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(postId,artistId)
);
