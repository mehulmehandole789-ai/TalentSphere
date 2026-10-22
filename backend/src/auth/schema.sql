CREATE TABLE IF NOT EXISTS email_verifications (
 userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 generationId TEXT NOT NULL,
 codeHash TEXT,
 expiresAt INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 deliveryStatus TEXT NOT NULL,
 issuedAt INTEGER NOT NULL,
 windowStartedAt INTEGER NOT NULL,
 sendCount INTEGER NOT NULL DEFAULT 1,
 consumedAt INTEGER
);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
 scope TEXT NOT NULL,
 subject TEXT NOT NULL,
 count INTEGER NOT NULL,
 resetsAt INTEGER NOT NULL,
 PRIMARY KEY(scope,subject)
);
