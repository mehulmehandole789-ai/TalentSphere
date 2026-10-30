# TalentSphere

Connected profiles, packages, availability, quotations, booking conversations, verified reviews and marketplace tools are documented in [CONNECTED_PLATFORM.md](CONNECTED_PLATFORM.md). New primary booking actions use the connected enquiry-to-payment journey; historical URLs remain supported.

Artist discovery, event applications, private bookings and creative collaborations.
The existing stack is preserved: **Node.js / Express, SQLite (better-sqlite3), and a vanilla JavaScript single-page frontend**. There is no React build, MongoDB service or separate frontend server to configure. Express serves the frontend and API together.

## Quick start (Windows PowerShell)

Requires Node.js 22 or 24, npm, and a writable local directory. Validated here with Node 24.14.1 and npm 11.12.1.

From the project root:

```powershell
npm ci
npm run setup
# Only if backend/.env does not already exist:
Copy-Item backend/.env.example backend/.env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put the generated value in `JWT_SECRET` in `backend/.env`. Keep an existing `.env` and database; do not replace them as part of an upgrade.

```powershell
npm run dev
```

Open **http://localhost:4000**. This one command runs both the frontend and backend. Use `npm start` for ordinary non-watch execution. Stop with Ctrl+C.

The API creates the SQLite schema and performs additive migrations on startup. Existing users, profiles, events, bookings and other records are preserved. It does not seed automatically, wipe data, or connect to MongoDB.

## Commands

| Command (project root) | Purpose |
| --- | --- |
| `npm ci` | Install optional browser QA tooling from the root lockfile |
| `npm run setup` | Install backend dependencies from its lockfile |
| `npm run dev` | Serve frontend/API with Node watch mode |
| `npm start` | Serve frontend/API without watch mode |
| `npm run build` | Validate frontend/backend JavaScript syntax; static frontend needs no bundler |
| `npm run lint` | Same syntax checks; this repository has no ESLint ruleset |
| `npm test` | API/setup integration tests, including explicitly mocked payment tests in a separate temporary database |
| `npm run test:browser` | Headless Chrome workflow and responsive tests in a separate temporary database |
| `npm run seed` | Optional fictional demo dataset, only when the database has no accounts |
| `npm run payments:reconcile` | Recheck up to 100 oldest saved orders against Razorpay, without initiating charges |
| `npm run create-admin` | Create an admin from explicit environment values, without modifying existing accounts |

Backend-only setup is also supported: `npm --prefix backend ci` then `npm start`. Root tooling is only required for browser tests; runtime does not require Playwright.

Browser tests use installed Google Chrome. For Edge, set `$env:BROWSER_CHANNEL = 'msedge'` first. Alternatively install Playwright Chromium with `npx playwright install chromium` and set `$env:BROWSER_CHANNEL = 'chromium'`. Tests check API failures, browser errors, refresh persistence and layouts at 390, 768 and 1440 pixels. Screenshots appear in ignored `test-results/`. Automated tests never use `backend/data.db`.

## Configuration

All server variables are read from `backend/.env`, regardless of the launch directory. See `backend/.env.example`.

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Required random secret, at least 32 characters. Shared across server restarts to preserve sessions. Never commit it. |
| `PORT` | Server port; defaults to 4000, valid range 1-65535 |
| `DATABASE_PATH` | Optional absolute SQLite filename. Default `backend/data.db`. Its parent directory must exist and be writable. |
| `CORS_ORIGIN` | Optional exact allowed frontend origins, comma separated. Cross-origin access is disabled by default; normal same-origin use requires no setting. |
| `PUBLIC_API_BASE` | Browser API base exposed via `/config.js`; defaults to `/api`. For split hosting use an HTTPS API URL ending in `/api` and set CORS appropriately. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Optional SMTP server; port defaults to 587, secure defaults to false (STARTTLS). Use secure true for implicit TLS on 465. |
| `SMTP_USER`, `SMTP_PASS` | Optional SMTP authentication. A supplied SMTP user requires its password. |
| `SMTP_FROM` | Required sender when configuring SMTP; verify the sender/domain with your provider. |
| `APP_URL` | Public frontend origin required for password-reset links. Use your HTTPS origin in deployment. |
| `EMAIL_DELIVERY_MODE` | `smtp` by default; explicit `preview` requires `NODE_ENV=development` and sends no email. |
| `EMAIL_VERIFICATION_SECRET` | Optional separate 32+ character code HMAC secret; otherwise JWT_SECRET is used. |
| `REQUIRE_ARTIST_APPROVAL` | `true` makes newly registered artists pending; default false. Independent of email verification. |
| `AUTH_AUDIT_LOG` | Optional route/status/request-reference diagnostics, without bodies or credentials. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | One-time admin creation values. Password must be 12-72 bytes. Remove ADMIN_PASSWORD after creation. |

Discovery requires no external credentials. Registration and sign-in now require email verification: configure SMTP, or explicitly use development-only local email preview as described in [AUTHENTICATION.md](AUTHENTICATION.md). Paying accepted bookings requires Razorpay credentials. SQLite and portfolio media live locally. Password recovery requires your SMTP credentials and verified sender; real email delivery has not been verified. Without SMTP, recovery returns an explicit unavailable error. Tests use an injected mail transport, not a real provider.

For separate frontend hosting, serve a `/config.js` assigning `window.TALENTSPHERE_API_BASE` on the frontend host (the same-origin Express deployment already provides it). Do not expose server secrets in browser configuration.

## Accounts and authorization

Register as an **artist** or **organizer**, verify the emailed six-digit code, then sign in. Existing accounts also require verification; none are automatically marked verified. Choose Verify your email on the login page to resume. Artist profile badges remain independent of email verification and account approval. Set `REQUIRE_ARTIST_APPROVAL=true` to require admin approval for newly registered artists. See [AUTHENTICATION.md](AUTHENTICATION.md) for the migration policy, limits and delivery setup.

An administrator uses the same email/password login page. There is no password-free demo login or public admin registration. On an existing database without an admin, set the `ADMIN_*` values in `backend/.env`, run `npm run create-admin`, then remove the bootstrap password. Existing email addresses are rejected rather than promoted or overwritten.

Passwords are hashed with bcrypt. JWTs expire after seven days. Logout, suspension and password reset revoke existing tokens through a database token version. Logout signs out all sessions for that account. The browser stores its token in localStorage; use HTTPS and maintain the output escaping/input validation protections if extending the frontend. Authentication endpoints have independent per-IP limits persisted in SQLite; verification also enforces account-level attempt and resend limits. See the authentication guide for exact limits.

Password recovery issues a hashed, single-use token valid for 30 minutes. SMTP errors are reported without claiming delivery. Configure your provider and validate actual inbox delivery before relying on it.

## Workflows

- **Artists:** edit category, location, bio, skills, experience, price and availability; upload/remove portfolio images; respond to bookings; apply to events; send project proposals and respond to received collaboration requests.
- **Organizers:** search/filter/sort artists; request bookings with event details and notes; pay accepted final quotes through Razorpay; cancel active requests; mark confirmed bookings complete on/after the event date; publish described events with application deadlines; accept/reject event applications.
- **Admins:** inspect database-backed users/events/bookings, manage account approval, verify artist profile badges, suspend/restore non-admin accounts. Suspension invalidates active tokens; restoring does not revive them.
- **Notifications:** persisted activity with ownership-protected mark-read actions.

Booking transitions:

```text
Pending -> Accepted with a saved final quote, or Declined (the booked artist)
Accepted -> Confirmed (server verifies a captured Razorpay payment)
Pending / Accepted / Confirmed -> Cancelled (the requesting organizer)
Confirmed -> Completed (the organizer, on/after the event date)
```

New enquiries use UTC time ranges with an explicit IANA display time zone. Pending enquiries do not reserve dates. Accepting a quotation reserves the time for up to 15 minutes; server confirmation rechecks conflicts. Legacy confirmed bookings without time ranges reserve their recorded date. See CONNECTED_PLATFORM.md. Applications can only be accepted/rejected by the event owner; the applying artist may withdraw a pending application. Only a collaboration recipient may accept/decline a pending proposal.

**Payments:** Razorpay Standard Checkout integration is implemented, with Test Mode as the default. Provide your own keys/webhook secret to enable it. Only verified provider capture confirms a new booking; manual confirmation is disabled. New bookings have zero platform fee, separate payment status and integer-paise amounts. Historical confirmed/completed bookings remain historical agreements, with no invented payment. See [PAYMENTS.md](PAYMENTS.md) for account setup, UPI QR limitations, webhooks, reconciliation and Live Mode steps.

## Portfolio storage and backups

Uploads accept PNG, JPEG or WebP only, verify file signatures, limit each image to 5 MB and each profile to six images. New images are stored as protected local files; SQLite holds references and metadata. Existing data URLs remain readable and can be migrated with npm run migrate:media. Extended profiles support a dedicated profile photo, cover and performance samples. Back up backend/uploads (or MEDIA_DIR) with the database. This is a local storage solution with no cloud credentials. Public profiles intentionally expose these images. Keep uploads small: for a larger deployment, migrate media to object storage and paginate API results; current discovery pagination happens in the browser.

Back up the SQLite database using SQLite's backup API, or stop the app and copy the database safely. Do not copy just the database file while writes are occurring in WAL mode. No data deletion or reset command is part of setup.

## Optional demo seed

For a populated local dashboard after creating the fictional seed accounts, run `npm run seed:activity`. It adds past and upcoming bookings, applications, collaboration requests and notifications only for the existing sample accounts. Repeating it does not duplicate records. It refuses production mode and does not create payment transactions. Sign in as `priya@talentsphere.io`, `meera@talentsphere.io` or `alex@talentsphere.io` to explore the activity. The dashboard numbers come from these stored records.

`npm run seed` only populates a database with **zero accounts**. Repeating it leaves populated databases untouched. Demo artist/event names are prefixed `[Demo]`; biographies, reviews and counts in this opt-in dataset are fictional. Event dates are generated relative to the seed date. No demo accounts are created by normal startup or registration.

If you explicitly seed a fresh database, the script prints its created account details. These are demo credentials only: artist `meera@talentsphere.io`, organizer `alex@talentsphere.io`, admin `admin@talentsphere.io`, password `password123`. These accounts require email verification too; fictional inboxes need the explicitly enabled development-only preview transport. Do not seed a public production database.

## Troubleshooting

- **Startup secret error:** set a random JWT_SECRET of at least 32 characters in `backend/.env`. Changing it signs users out.
- **EADDRINUSE:** stop the other process or change PORT and open that port in your browser.
- **SQLite cannot open file:** check DATABASE_PATH, ensure its parent directory exists, and verify write permissions. No database service needs to be started.
- **Native SQLite install fails:** use Node 22/24 with matching architecture, run `npm --prefix backend ci`, and allow npm access to download its binary. A compiler/Python may be needed if no matching prebuilt binary exists.
- **API unavailable:** access the app through `http://localhost:4000`, not by opening the HTML file directly. Check `/api/health` and the server terminal. Failures never fall back to mock data.
- **429 authentication response:** respect the response retry time. Resends have a 60-second cooldown and account/hour limits; endpoint limits differ. Use isolated tests rather than repeatedly registering against the live database.
- **Mail unavailable:** supply SMTP settings and APP_URL; verify provider credentials, sender, TLS/port and network access. Accounts remain saved and unverified on delivery failure. Request a fresh code after cooldown. See AUTHENTICATION.md for an explicit development-only preview option.
- **Chrome not found:** install Chrome, use Edge, or install Playwright Chromium as described above.

See `IMPLEMENTATION_CHECKLIST.md` for the audit, verification evidence and remaining limits.


## Interface design

The shared presentation layer is in `frontend/design.css`; page and card renderers remain in `frontend/index.html`. The interface uses Georgia and system sans-serif, warm off-white/charcoal, and violet. No web fonts or new runtime packages are required. Artist card and profile imagery always comes from saved media; profiles without a photo use initials. The homepage editorial photograph is served locally (about 176 KB); its source is recorded in `frontend/assets/README.md`.

Discovery includes mobile filter controls, removable active filters and result counts. Portfolio images open in a native dialog with keyboard/Escape support. Booking forms show artist pricing, zero platform fee and the distinction between a request and a confirmation; nothing is charged when the booking request is submitted. Imported sample names display without seed prefixes; their stored records are unchanged. Sample profiles do not display verification badges, aggregate ratings, or seeded reviews. Shared typography, navigation, cards, forms and dashboard tables use a consistent responsive visual system.

The browser suite checks the original workflows plus gallery keyboard interaction, mobile filtering/reset, booking summaries, favicon, titles and public/error-page layouts at 390/768/1440 pixels. Screenshots from visual review are saved in ignored `test-results/`.

Payment implementation and verification details: [PAYMENTS.md](PAYMENTS.md). Provider automated tests and the browser Checkout stub are explicitly mocked; no real provider payment or QR scan has been verified.
# Talent Recruitment upgrade

The existing artist platform now includes **Recruitment** at `/recruitment.html`. See [setup, architecture, algorithms and teacher demo](RECRUITMENT.md), [requirements and verification](RECRUITMENT_REQUIREMENTS.md), and [ER diagram](RECRUITMENT_ER.md). Run `npm run recruitment:migrate` before starting an existing installation; it creates WAL-aware SQLite backups and preserves existing records.
