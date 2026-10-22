CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL, -- artist | organizer | admin
  location TEXT,
  orgCategory TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artist_profiles (
  id TEXT PRIMARY KEY,
  userId TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 4.5,
  reviewsCount INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL DEFAULT 10000,
  exp INTEGER NOT NULL DEFAULT 1,
  bookingsCount INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]',
  availability TEXT NOT NULL DEFAULT 'Flexible',
  verified INTEGER NOT NULL DEFAULT 0,
  joined TEXT NOT NULL DEFAULT '2026',
  gradSeed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organizerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organizerName TEXT NOT NULL,
  category TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  location TEXT NOT NULL,
  venue TEXT NOT NULL,
  talent TEXT NOT NULL,
  numArtists INTEGER NOT NULL DEFAULT 1,
  budget TEXT NOT NULL,
  deadline TEXT NOT NULL,
  gradSeed INTEGER NOT NULL DEFAULT 0,
  icon TEXT NOT NULL DEFAULT 'calendar',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  artistId TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  organizerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  eventName TEXT NOT NULL,
  date TEXT NOT NULL,
  duration TEXT NOT NULL,
  location TEXT NOT NULL,
  fee INTEGER NOT NULL,
  platformFee INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  artistId TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  fee INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collaborations (
  id TEXT PRIMARY KEY,
  fromId TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  toId TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  artistId TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  rating INTEGER NOT NULL,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',
  read INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
 tokenHash TEXT PRIMARY KEY,
 userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expiresAt INTEGER NOT NULL
);
