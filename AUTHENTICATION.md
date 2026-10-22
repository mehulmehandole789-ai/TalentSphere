# Authentication and email verification

## What was diagnosed

The existing seeded organizer could log in through the browser and reach its dashboard. API routing, the SQLite database and bcrypt comparison worked for that account. A separate disposable-database probe reproduced a different failure: a correctly hashed password containing `<` or `>` passed bcrypt comparison but the global request sanitizer rejected the login request with HTTP 400 before the auth controller. Password fields on authentication routes now preserve their exact characters; controllers enforce password length and bcrypt's 72-byte limit. Other input validation remains enabled. The browser preserves server error messages instead of treating every failure as incorrect credentials.

Email lookup consistently uses `LOWER(TRIM(email))`. Passwords are never trimmed or lowercased. Existing bcrypt hashes remain unchanged. Registration and login use the same configured SQLite database. The previous shared, in-memory limit for all auth POSTs has been replaced with independent persistent endpoint limits.

## Existing-account migration policy

Startup adds fields and tables without deleting users or resetting their passwords. **Existing accounts are not automatically verified.** They receive `emailVerified = false`, and must verify once before signing in or using an old token. On the login page, choose **Verify your email**, enter the existing address and request a code. Correct credentials also direct an unverified user to that page. Retrying registration resumes an existing unverified account without changing its name, role, password or profile, and without creating a duplicate.

The normalized-email unique index prevents duplicates. If an older database contains conflicting normalized addresses, startup reports the conflict for manual resolution; it does not merge or delete accounts.

Email verification, approval and the existing artist profile badge are separate. `REQUIRE_ARTIST_APPROVAL=true` makes newly registered artists pending; otherwise new accounts use `not_required`. Existing accounts default to `not_required`, preserving their earlier approval policy. Admins can approve/reject accounts in Users. Approval never verifies email, and verification never approves an account. Admin bootstrap accounts must verify their own email too.

## Real SMTP setup

Configure `backend/.env` with credentials from your email provider and a sender/domain that provider permits:

```dotenv
JWT_SECRET=your-existing-random-secret-at-least-32-characters
EMAIL_DELIVERY_MODE=smtp
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-login
SMTP_PASS=your-smtp-app-password
SMTP_FROM=TalentSphere <no-reply@your-verified-domain.example>
APP_URL=http://localhost:4000
REQUIRE_ARTIST_APPROVAL=false
AUTH_AUDIT_LOG=false
```

These are placeholders, not working credentials. For implicit TLS on port 465 use `SMTP_SECURE=true`; 587 normally uses STARTTLS. `SMTP_USER` requires `SMTP_PASS`. `SMTP_FROM` is required when SMTP is configured. `APP_URL` is required for password-reset links, and should be your HTTPS public origin when deployed. An optional random `EMAIL_VERIFICATION_SECRET` of at least 32 characters separates the code HMAC secret from `JWT_SECRET`; otherwise the JWT secret is used. Keep both stable across restarts, backend-only and out of source control.

Restart with `npm start`, open http://localhost:4000/#register, register an address you control, enter the emailed code, then log in. SMTP acceptance is reported only after the SMTP server accepts the recipient; it does not guarantee inbox placement. Check spam and provider delivery logs. No provider credentials are currently configured, so real delivery has not been verified. Missing SMTP returns an explicit 503 with the account saved; delivery failures return 502 and allow a safe retry after cooldown. Never send test messages to other people's addresses.

## Password recovery

Open `/#forgot` (or choose **Forgot password?** on the login page), enter your registered email, and select **Send reset link**. Configure `APP_URL` in `backend/.env` to the application's browser URL and restart the server after changing it. Local development uses `APP_URL=http://localhost:4000`; deployments must use their public HTTPS URL.

The email contains a link valid for 30 minutes. Open it, enter and confirm your new password, then log in. Requesting a replacement invalidates earlier links. A successful reset consumes the link and revokes existing sessions; email verification is still required for unverified accounts. Recovery feedback stays on the page, and invalid links offer a replacement. Automated API and browser tests use captured email and disposable databases; they do not confirm real inbox delivery.

## Development-only email preview

For local UI testing without an email provider, explicitly opt into a local file transport in PowerShell:

```powershell
$env:NODE_ENV = 'development'
$env:EMAIL_DELIVERY_MODE = 'preview'
npm run dev
```

This sends **no email**. The UI states that a development preview was saved. Read the newest JSON email locally in ignored `backend/.mail-preview/` and enter its code on the verification page. Files contain private codes and should remain local. Preview mode is rejected unless `NODE_ENV=development`; do not enable it on a publicly accessible deployment. After stopping, restore normal transport:

```powershell
Remove-Item Env:EMAIL_DELIVERY_MODE
Remove-Item Env:NODE_ENV
npm start
```

Fictional seeded addresses cannot receive real email. They still require verification; preview mode is the explicit local-only way to exercise those accounts. Neither seed nor admin creation bypasses verification.

## Security and limits

- Cryptographically generated six-digit codes expire in ten minutes. Only a keyed hash is saved in SQLite; codes never appear in API responses or server logs. Branded HTML and plain-text emails contain the code.
- Five incorrect attempts exhaust a challenge. A valid code is consumed atomically with email verification, so concurrent/reused submissions cannot verify twice. Verification does not issue a login token.
- Resend requires 60 seconds between attempts and at most five sends per account per hour, including the initial send and delivery failures. Replacement invalidates the previous code. Failed delivery invalidates the new code too. Limits survive restart.
- Per-IP limits: registration 10/15 minutes, verification 30/15 minutes, resend 10/hour, login 30/15 minutes; password recovery 5/hour and reset 10/15 minutes. SQLite stores hashed IP subjects. HTTP 429 includes retry information. Use an appropriate trusted-proxy/rate-limit architecture before adding multiple public instances; this app does not blindly trust forwarded IP headers.
- Invalid credentials receive the same generic message. Only after correct password validation does login reveal verification, suspension, pending or rejected status. Protected backend routes repeat those checks using current database state and enforce roles/ownership.
- Existing seven-day JWT/localStorage persistence is retained. Logout revokes all sessions through token versioning and clears browser state, including when the network is unavailable. A failed logout request cannot guarantee server revocation; the UI says so. Use HTTPS. Password reset does not implicitly verify email.
- Optional `AUTH_AUDIT_LOG=true` logs only a random request reference, endpoint action and response status. It excludes addresses, request bodies, passwords, tokens and codes. It adds `X-Request-Id` for correlating browser network responses with server logs.

## Checks

```powershell
npm ci
npm run setup
npm test
npm run test:browser
npm run build
npm run lint
```

Automated API and Chrome tests create disposable databases, never `backend/data.db`. Mail is explicitly an injected in-memory mock; no test email is delivered. Tests cover legacy-account compatibility, password symbols/whitespace, normalized email, registration, duplicate resume, correct/wrong/expired/reused codes, concurrency, cooldown/attempt/send limits, delivery failure/retry, verified/unverified login, independent approval, role enforcement and logout. Chrome covers registration/verification/countdown/refresh/login and the existing booking/collaboration/admin flows at 390/768/1440 pixels. Build/lint validate JavaScript syntax for this static frontend; there is no bundler or ESLint ruleset. Real SMTP delivery remains a separate credential-dependent check.
