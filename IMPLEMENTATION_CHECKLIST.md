# Implementation checklist

The inspected repository uses Express + SQLite + a static JavaScript SPA, rather than MERN. That architecture is preserved.

## Completed audit/fixes

- [x] Map all frontend API requests to backend routes; retain a centralized client, environment-delivered API base, JSON errors and explicit network failures.
- [x] Remove password-free admin login; use normal credentials and an explicit, non-destructive administrator bootstrap.
- [x] Protect individual booking reads and public event application data from unauthorized users.
- [x] Replace organizer-controlled simulated artist acceptance and simulated payment with participant-authorized booking transitions.
- [x] Validate booking dates/details and reject conflicting full-date requests; preserve historical bookings/fees.
- [x] Enforce application owner/recipient roles, deadlines, duplicates, withdrawal and terminal states.
- [x] Enforce collaboration recipient ownership, status vocabulary and terminal states; add a real proposal form.
- [x] Persist profile category/location/skills/bio/price/experience/availability, portfolio images and first-image profile photos.
- [x] Restrict upload MIME types, signatures, sizes and count; support removal of owned media.
- [x] Implement admin suspension/restoration and invalidate active tokens; retain verification badges.
- [x] Replace the fake password-reset success with configurable SMTP recovery, hashed/expiring/single-use tokens and session revocation.
- [x] Add server-side logout revocation, authentication rate limits, payload/type validation, output escaping, security headers and startup configuration checks.
- [x] Replace fabricated homepage testimonials/statistics and dashboard metrics; show actual records and honest empty states.
- [x] Add availability filtering, sorting/search, discovery pagination, persistent hash routes, page loading/error/retry states, duplicate-click guards and form validation.
- [x] Fix mobile navigation overflow, dashboard table containment, event-card contrast, keyboard controls, labels, focus and reduced-motion behavior.
- [x] Remove unfinished messaging, draft-saving, reporting and fake payment controls. Preserve existing records; migrate schema additively.
- [x] Make seed opt-in and non-destructive, label demo data, provide root setup/development/build/test scripts, lockfiles and PowerShell documentation.

## Verification (2026-10-16)

| Check | Result / scope |
| --- | --- |
| Dependency installation | PASS: backend and root dependencies installed; lockfiles saved with the project |
| Production/static build | PASS: frontend script and backend syntax validation. The original static frontend has no bundler or generated distribution step. |
| Lint | PASS: syntax checks, not an ESLint/style audit |
| API/setup automated tests | PASS: 11 groups using disposable SQLite databases; authentication, hashing, role/ownership checks, invalid inputs, bookings, applications, collaborations, media, notifications, admin, recovery tokens, logout, persistence, seed and admin bootstrap |
| Browser workflow checks | PASS: real headless Chrome; register/login/logout, profile/media editing and refresh, discovery, event publishing/applications, booking acceptance/confirmation, collaboration proposal/decline, admin verification/suspend/restore |
| Responsive checks | PASS: artist, organizer and admin views at 390/768/1440 px; horizontal page overflow assertions; mobile homepage screenshot manually inspected |
| Browser console/network | PASS: no browser errors or failed API responses during successful workflow tests |
| Local startup/database | PASS: server listens on localhost:4000; /api/health executes a real SQLite query |
| Dependency advisories | PASS: compatible dependency fixes applied; npm audit reports zero vulnerabilities at verification time |
| Live SMTP delivery | BLOCKED: no provider credentials/sender configured. Recovery logic tested with an injected test transport; no external delivery claimed. |
| Real payments | NOT CONFIGURED: no payment provider, no charge attempt. Confirmation is an agreement, never payment. |

## Remaining practical limits

- Media are stored in the configured local SQLite database, limited to six images/profile and 5 MB/image. Cloud storage/video support is not implemented. API discovery currently returns all profiles; UI pagination is local. Use object storage and server pagination before growing the dataset significantly.
- Scheduling reserves a full date rather than time intervals. Real-time messaging and report submission are not available. Email verification is now implemented; see the authentication update below. Payment collection now requires the Razorpay configuration documented in PAYMENTS.md.
- Authentication rate limits now persist in SQLite; a shared deployment architecture is needed before multiple public instances. Tokens live in localStorage, expire after seven days, and are invalidated on logout/reset/suspension. Use HTTPS in deployment.
- Artist profile verification is a badge; separate email verification and optional account approval are now implemented.
- Browser checks cover the available Chrome environment and key workflows; this is not a claim of exhaustive device, accessibility, or production load testing.
- Automated seed/demo/admin accounts exist only in temporary test databases. No demo accounts were seeded into the user's live local database.


## Portfolio presentation refinement (2026-10-17)

- [x] Introduce a shared off-white, charcoal and violet visual system with two local font families, restrained borders/shadows, consistent buttons/forms/cards and line icons.
- [x] Rebuild the homepage sequence: concise purpose, Explore Artists / Join as an Artist, locally hosted editorial image, categories, database-backed artist cards, booking process, final CTA and real navigation links.
- [x] Reuse artist cards in discovery/collaboration; show stored photos or honest initials fallbacks; remove aggregate ratings and public demo verification badges without changing records.
- [x] Add removable active filters, mobile filter expansion, readable result layouts, skeleton loading, and polished no-results/empty/error states.
- [x] Restructure profiles around identity, portfolio, about and pricing; add accessible native-dialog media previews and fix cover/avatar stacking.
- [x] Explain request versus confirmation and show the artist fee, zero platform fee and no-charge notice before submission.
- [x] Refine existing role dashboards, prioritize pending/upcoming requests, improve table scrolling, and retain all API actions and ownership rules.
- [x] Add SVG favicon, route-specific titles, skip link, focus states, reduced-motion styling, natural interface copy and responsive media sizing.
- [x] Verify mobile/tablet/desktop widths (390/768/1440), real seeded public-page screenshots, existing Chrome workflows, new interaction checks, and 11 API/setup groups. Build and lint perform static-app JavaScript syntax validation.

No production records or backend routes/business rules were modified for this presentation refinement. Sample profiles have no uploaded portraits; initials are intentional. Live SMTP delivery and real payments retain the earlier documented configuration limits.


## Razorpay integration (2026-10-17)

- [x] Inspect current Express/SQLite/JWT booking flow and consult current official Razorpay documentation.
- [x] Install the official Razorpay Node SDK; leave real credentials unset and Test Mode as the default.
- [x] Add additive integer-paise booking quote fields, distinct payment status, unique persistent order records, verified transactions, webhook deduplication records and admin review notes.
- [x] Save a final quote on artist acceptance and remove manual confirmation for new bookings. Preserve historical confirmed/completed records without claiming historical payment.
- [x] Derive order amounts exclusively from saved booking data; protect all private payment actions/receipts with booking ownership.
- [x] Integrate Standard Checkout, including its supported desktop UPI QR/mobile UPI selection. No dedicated QR Codes product or fake QR is presented as working.
- [x] Verify Checkout signatures using saved order IDs and raw-body webhook signatures; fetch provider facts; confirm only captured payments with matching amount/currency/booking.
- [x] Reuse one saved provider order on retries/concurrent requests; recover interrupted creation by receipt and block ambiguous replacement orders.
- [x] Handle failures, abandonment/session expiry, authorization, delayed capture, cancellations/refunds and exceptions without inferring artist payouts.
- [x] Add refresh/poll recovery, backend reconciliation command, history, printable actual capture receipts, admin filtering/transaction references and review notes.
- [x] Add clearly labeled MOCK payment tests and a MOCK Checkout browser stub. All tests use disposable databases; the running app has no mock fallback.
- [x] Document environment variables, Test keys/capture setup, reachable webhook URLs/events, local tunnel setup, Standard Checkout versus dedicated QR, and Live Mode steps in PAYMENTS.md.

Verification: 22 API/setup groups passed (11 explicitly MOCK payment groups); Chrome covers abandoned/failed/retry/capture/receipt/refresh with the provider stub plus original workflows and responsive checks. Build/lint are JavaScript syntax checks for this static app. Real provider Test payments/webhook deliveries remain blocked by missing credentials and a reachable configured webhook. Real UPI QR scans/expiry/mobile intent remain unverified and require eligible Live Mode/account/device. Refund initiation and artist payouts are intentionally external admin operations, not simulated actions.


## Authentication repair and email verification (2026-10-17)

- [x] Trace browser login, API, controller, database/hash and dashboard. Seeded baseline login worked. Reproduce and repair valid password symbols rejected by the global sanitizer before reaching bcrypt.
- [x] Normalize email consistently, preserve exact passwords and existing hashes, reject bcrypt byte truncation, keep generic incorrect credentials and accurate other errors.
- [x] Add additive unverified-by-default migration and normalized-email uniqueness without deleting users or automatically verifying existing accounts.
- [x] Implement cryptographic six-digit/HMAC-hashed ten-minute codes, committed five-attempt limits, atomic single-use verification, replacement invalidation, persistent endpoint quotas, 60-second cooldown and account resend quotas.
- [x] Add SMTP HTML/plain-text delivery, accurate failures/retry, backend-only configuration, explicit development-only file preview and safe optional route/status diagnostics. No code is returned or logged.
- [x] Repair registration/login, add verification/countdown/resume and approval status pages, retain refresh/logout/role navigation, enforce email and approval gates on protected backend routes.
- [x] Separate email verification, artist badge and admin approval; add protected admin approval actions.
- [x] Adapt existing API/payment/browser tests without production bypasses; add 17 dedicated auth test groups using disposable databases and MOCK mail.
- [x] Document migration policy and exact SMTP/development setup in AUTHENTICATION.md and .env.example.

Verification: 39 API/setup test groups passed (including MOCK mail and provider responses). Chrome passed the verification/cooldown/refresh flow with a password containing `<`, `>` and `&`, plus prior booking/collaboration/admin workflows and responsive checks at 390/768/1440 pixels. No real test email was sent. Live SMTP delivery remains BLOCKED by absent provider credentials and a verified sender; development preview is not a real delivery claim.

Final local startup: http://localhost:4000/api/health returned 200 and queried SQLite. Existing counts remained 12 users, 9 profiles, 7 events and 2 bookings; all 12 accounts remain unverified according to the explicit policy. Wrong password returned generic 401; correct legacy credentials returned EMAIL_UNVERIFIED/403 with no token. Development-preview file generation and code consumption passed in a disposable database; no real email was sent. Build and lint passed (syntax checks).
