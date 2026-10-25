# Connected platform implementation

Preserve Express, SQLite, email-verified JWT authentication, artist/organizer/admin roles, Razorpay, hash URLs and the cinematic motion system. All schema changes are additive. Organizer is the existing client role.

- [x] Stage 1: extended profiles, local file media, packages, private/public availability; verify ownership and time validation.
- [x] Stage 2: enquiries, itemized quotations, immutable accepted snapshots, timed reservations and provider confirmation checks; verify concurrency and existing payment tests.
- [x] Stage 3: participant messages, durable transactional notification outbox, eligible reviews, saved artists and workspace dashboards; verify access and browser journeys.
- [x] Stage 4: moderation/audits, collaboration board, event matching and media kit; run all checks and document configuration/limits.

Existing legacy bookings retain their original states and prices. New enquiries use the connected workflow. No historical record is marked paid, reviewed or verified by migration.

## Verification completed

- Build and lint passed (frontend/backend syntax).
- 55 backend tests passed, including authorization, uploads/privacy, overlapping concurrent accepts/captures, quote snapshots/expiry, provider idempotency, messaging, review eligibility and moderation.
- Original browser workflow suite passed at 375/390/768/1024/1440 pixels.
- Connected browser suite passed: profile/upload/package/calendar, enquiry/message/quote/accept, explicitly mocked Razorpay capture/receipt, completion/review, saved artists, board applications and event matching. New role pages passed at 375/768/1024/1440 with no browser errors or overflow.
- Existing database backed up through SQLite backup API before startup migration. No resets or automatic demo seeding performed.
- Real SMTP inbox delivery and real Razorpay charges remain externally unverified. See CONNECTED_PLATFORM.md for exact configuration, startup and operational limitations.

- Live local server restarted on port 4000; /api/health and /api/studio/board passed. Existing row counts remained 12 users, 9 artists, 74 bookings, 7 events and 3 historical reviews after additive migration.
- Existing motion and public responsive smoke tests passed against the restarted local app.
- Current local configuration: Razorpay credentials are not configured. SMTP fields are present; actual provider inbox delivery remains unverified.
