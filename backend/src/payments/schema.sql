CREATE TABLE IF NOT EXISTS payment_orders (
 id TEXT PRIMARY KEY,
 bookingId TEXT NOT NULL UNIQUE REFERENCES bookings(id),
 userId TEXT NOT NULL REFERENCES users(id),
 provider TEXT NOT NULL DEFAULT 'razorpay',
 flow TEXT NOT NULL DEFAULT 'standard_checkout',
 receipt TEXT NOT NULL UNIQUE,
 providerOrderId TEXT UNIQUE,
 keyId TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 amountPaise INTEGER NOT NULL CHECK(amountPaise > 0),
 currency TEXT NOT NULL DEFAULT 'INR',
 status TEXT NOT NULL DEFAULT 'creating',
 reviewReason TEXT,
 sessionState TEXT,
 sessionExpiresAt INTEGER,
 createdAt TEXT NOT NULL DEFAULT (datetime('now')),
 updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
 reconciledAt TEXT
);
CREATE TABLE IF NOT EXISTS payment_transactions (
 providerPaymentId TEXT PRIMARY KEY,
 orderId TEXT NOT NULL REFERENCES payment_orders(id),
 amountPaise INTEGER NOT NULL,
 currency TEXT NOT NULL,
 status TEXT NOT NULL,
 method TEXT,
 refundedPaise INTEGER NOT NULL DEFAULT 0,
 failureCode TEXT,
 failureMessage TEXT,
 providerCreatedAt INTEGER,
 capturedAt TEXT,
 createdAt TEXT NOT NULL DEFAULT (datetime('now')),
 updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS payment_transactions_order ON payment_transactions(orderId);
CREATE TABLE IF NOT EXISTS payment_webhook_events (
 eventId TEXT PRIMARY KEY,
 eventType TEXT NOT NULL,
 bodyHash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'processing',
 attempts INTEGER NOT NULL DEFAULT 1,
 createdAt TEXT NOT NULL DEFAULT (datetime('now')),
 processedAt TEXT
);
CREATE TABLE IF NOT EXISTS payment_review_log (
 id TEXT PRIMARY KEY,
 orderId TEXT NOT NULL REFERENCES payment_orders(id),
 adminId TEXT NOT NULL REFERENCES users(id),
 note TEXT NOT NULL,
 createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
