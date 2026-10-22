# TalentSphere Razorpay integration

## Scope and current verification

The app retains Express, SQLite, JWT authentication and its existing frontend. The official `razorpay` Node SDK is used on the backend; Standard Checkout is loaded from Razorpay only when a customer starts payment.

New booking flow: request -> artist saves final INR quote and accepts -> booking owner opens Pay Now -> server verifies provider capture -> booking confirms. Booking and payment statuses are independent. Historical confirmed/completed records are retained as historical agreements and are never marked paid just because their booking status was confirmed.

**Real provider testing is blocked:** this workspace has no Razorpay keys/webhook secret. No real API order, payment, webhook delivery, UPI app launch or QR scan is claimed as verified. Automated tests use an in-process mock SDK and browser Checkout stub, labeled MOCK, in disposable databases. The running app never falls back to these mocks.

## Run locally (PowerShell, project root)

```powershell
npm ci
npm run setup
# Keep your existing backend/.env and database.
npm run dev
```

Open http://localhost:4000. Add the following to `backend/.env` to enable Test Mode, using your actual dashboard values:

```dotenv
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

All three secrets/settings must be configured together. Leave all three blank to keep payments explicitly disabled. Generate a separate webhook secret, for example:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Do not reuse JWT_SECRET or the Razorpay API secret as your webhook secret. Save the same webhook secret in your Razorpay Dashboard. No secret belongs in frontend files, public configuration, screenshots or source control. The public key ID is returned by the authenticated create-order response, matching the existing centralized API convention; no key secret or webhook secret is returned.

### Get Test Mode keys and configure capture

1. Sign into your own Razorpay Dashboard, select **Test Mode**, and generate API keys from Account & Settings / API Keys. Keep the secret safely when generated.
2. Set the matching `rzp_test_...` key ID and secret in `backend/.env`; keep `RAZORPAY_MODE=test`.
3. Configure **automatic payment capture** in the Dashboard. The application intentionally does not treat `authorized` as successful. If capture has not occurred, the booking remains Accepted and shows Awaiting capture; it does not offer another payment while authorization is pending.
4. Restart the backend after environment changes. If needed, create an organizer and artist through registration, or use the existing optional demo seed in an empty database. Do not reset your database to test payments.

## UPI QR and mobile payment behavior

This implementation uses **UPI inside Standard Checkout**. On desktop, choose UPI and use the provider-generated scan-to-pay QR when offered. On mobile, select a supported UPI app through Razorpay's device-aware Checkout. The app does not collect a VPA, user transaction ID, screenshot or QR image as proof of payment.

Razorpay documents real UPI Intent and QR use in **Live Mode**; Test Mode simulates transactions and is not a live UPI rail. Do not scan a test QR using a real payment app or imply that test success moved money. Follow the current official test instructions for payment methods offered by your account. Account onboarding, enabled methods, browser/device, and merchant eligibility determine the actual options shown by Checkout. These cannot be verified without account access.

There is **no dedicated QR Code API page** and no locally generated or simulated working QR. Standard Checkout's UPI transactions stay mapped to the saved Razorpay `order_id`. The separate QR Codes product requires account activation via Razorpay support/POC or the Dashboard; dedicated `qr_...` identifiers and payments must not be confused with Standard Checkout orders. If you later add that product, enable it for the account first and implement a separate fixed-amount/single-use QR mapping and lifecycle. This integration deliberately does not pretend that feature is enabled.

The UI displays the local Checkout session expiry (15 minutes), explicitly distinguished from Razorpay's own QR/session expiry. Razorpay controls any QR countdown shown inside Checkout. A locally expired/closed session does **not** invalidate an existing Razorpay order or prove that funds were not captured. Refresh rechecks the provider before retrying the same order. Hosted QR expiry/real scans remain unverified until Live Mode/account eligibility testing.

## Webhooks and local development

Configure this exact webhook URL in the appropriate Dashboard mode:

```text
https://YOUR-REACHABLE-HOST/api/payments/webhook
```

For local development, run the app and expose port 4000 through a development tunnel you control, for example (after installing/signing into ngrok):

```powershell
ngrok http 4000
```

Use its public HTTPS forwarding origin plus `/api/payments/webhook`. `localhost` is not reachable by Razorpay. Keep the tunnel running, update the Dashboard URL if it changes, and treat the tunnel as public access to your local app. No tunnel was started or account connected as part of implementation.

Subscribe to:

- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `order.paid`
- `refund.processed`
- `refund.failed`

Set the same independently generated webhook secret in the Dashboard and backend environment. Webhooks do not require a login token: authenticity is enforced through HMAC-SHA256 over the **unaltered raw request bytes**, before JSON parsing. Event IDs and body hashes are persisted for duplicate detection. A provider/API outage returns a non-success response so delivery can retry. Unknown/unrelated account events never confirm bookings.

Use the Dashboard event delivery logs and supported test/replay functions to check delivery through your tunnel. Validate a full capture workflow, not only a synthetic webhook payload: the backend fetches the actual order/payment from Razorpay. A random dashboard sample ID that does not exist in your account cannot fabricate a paid booking. Subscribe and test separately in Test and Live modes; never share environment secrets between modes.

## Persistence and payment safety

- `bookings.artistFeePaise`, `platformFeePaise`, `finalAmountPaise` hold integer-paise quote snapshots; `paymentStatus` is independent of the existing booking `status`. Existing rupee columns are retained for compatibility, not trusted for charging.
- The accepting artist may supply `finalPricePaise` through the protected booking-status action. Only the owning artist can accept once; the final quote cannot be edited after acceptance through that route. The browser fee field is converted to paise and validated on the server.
- Only the booking owner can initiate/read/verify/reconcile a private payment or retrieve its receipt. Admin payment operations are separate, role-protected endpoints. Artists see the booking payment status but no private provider details.
- `payment_orders` has one durable row/order per booking, unique receipt and provider order ID, saved mode/public key ID, amount/currency and session state. Concurrent clicks cannot create multiple local orders. All retries reuse the same Razorpay order; Razorpay stops accepting further payments once the order is paid.
- An interrupted order-creation response is recovered through the saved receipt. If creation is ambiguous or unresolved, new orders are blocked and admin review is required. No automatic remint of an uncertain order occurs.
- `payment_transactions` stores provider payment IDs, current verified status, integer amount/refund amounts, method, timestamps and safe failure information. No card details, VPA, raw provider error text, credentials or raw webhook bodies are stored.
- Checkout signatures use the **saved** order ID. The server then fetches the provider payment and order and checks amount, INR currency, receipt, order notes/booking association and captured state. A callback alone, or an `authorized` payment, cannot mark the booking paid.
- Captured/refunded observations cannot be overwritten by stale authorized/failed events. Replaying events cannot duplicate confirmation notifications. Booking confirmation and payment state changes use a short SQLite transaction.
- Cancelling a paid/authorized booking or receiving capture after cancellation flags `review_required`; it does not reopen a cancelled booking. Multiple captures, mismatches and observed refunds also require review. Captured transaction facts and receipts remain available.
- Refund initiation and artist payouts are **not** implemented. An administrator reviews/refunds in the Razorpay Dashboard, reconciles provider state and records a review note in TalentSphere. Notes cannot invent a refund, clear a safety exception or mark money paid. A platform receipt is never described as a payout to the artist.

## Recovery, history and administration

The owner payment page rechecks provider state on load and every 15 seconds while visible and outside Checkout. Refresh remains accurate after closing the browser or missing a callback. Transient failures show the saved status and a warning; the UI does not silently assume failure or suggest another charge.

Organizers have **Payments** history and print/save capture receipts. Receipts include actual saved provider IDs, amount, INR currency, mode, transaction/refund status and first capture verification time; test receipts are labeled and are not tax invoices.

Admins have **Payments** with status/mode/reference filtering, pagination, verified transaction references, reconciliation and review notes. Backend reconciliation is also available without the browser:

```powershell
npm run payments:reconcile
```

This checks up to 100 oldest last-reconciled orders in the configured mode and initiates **no charges**. Run it periodically through your scheduler if unattended recovery is needed; a scheduler is not installed automatically. A nonzero exit signals incomplete reconciliation. Keep the original key/account/mode available for unsettled orders; switching keys cannot silently create a replacement order for the same booking.

Main endpoints:

```text
GET  /api/payments/configuration             authenticated availability/mode
POST /api/payments/bookings/:id/order        owner; empty JSON body, no amounts
GET  /api/payments/bookings/:id              owner; recheck and saved snapshot
POST /api/payments/bookings/:id/verify       owner; Checkout signature + provider fetch
POST /api/payments/bookings/:id/reconcile    owner; provider reconciliation
POST /api/payments/bookings/:id/session      owner; dismissed/timeout UI marker only
GET  /api/payments/history                   owner history
GET  /api/payments/receipts/:paymentId        owning user; captured records only
POST /api/payments/webhook                   raw signed Razorpay delivery
GET  /api/payments/admin/orders              admin status/mode/q/page filters
POST /api/payments/admin/bookings/:id/reconcile
POST /api/payments/admin/bookings/:id/review-note
```

## Verification and remaining provider checks

```powershell
npm test
npm run test:browser
npm run build
npm run lint
```

- Automated API/setup: **22 passing groups**, including **11 MOCK payment groups** for saved final quote, integer paise, amount tampering, unauthorized access, invalid signatures, captured versus authorized, failed/abandoned/expired sessions, retry/concurrency, duplicate and out-of-order raw webhooks, delayed recovery, provider outages, uncertain creation, mode/key mismatch, cancellation/late capture, multiple captures, refunds, admin filters and receipts.
- Browser: **MOCK SDK and Checkout stub**; artist changes final quote, organizer abandons/fails/retries the same order, capture verification confirms booking, receipt/history survive refresh, original authentication/collaboration/admin actions remain connected. Payment/admin/history/receipt and existing views are checked for overflow at 390/768/1440 px.
- Build/lint: JavaScript syntax validation for the existing static frontend and backend; no bundler is introduced.
- Real Test Mode orders/captures/failures/webhook delivery: **BLOCKED by missing keys and a reachable configured webhook**.
- Live UPI QR scanning, expiry, mobile app intent and feature eligibility: **NOT VERIFIED**; require eligible Live Mode account/device. No dedicated QR API feature is implemented or claimed enabled.

Before Live Mode, complete Razorpay onboarding/KYC and account/payment-method activation; deploy HTTPS; configure automatic capture; verify Test Mode capture/failure/abandonment/replay/reconciliation with your own account; generate separate Live keys and webhook secret; deliberately set `RAZORPAY_MODE=live`; configure the Live webhook URL/events; restart; and verify a controlled real payment/refund on supported devices. Keep Test and Live data/credentials distinguishable and reconcile unsettled Test orders with their original keys. Never switch an existing saved Test order to Live, reset the database, or relabel Test receipts as real transactions.

## Official references used

- [Standard Checkout integration and signature verification](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
- [UPI methods and current Collect deprecation guidance](https://razorpay.com/docs/payments/payment-methods/upi/)
- [UPI Test Mode versus Live Intent/QR guidance](https://github.com/razorpay/markdown-docs/blob/master/payments/payment-gateway/web-integration/hosted/integration-steps.md)
- [Webhook raw-body validation, duplicates and ordering](https://razorpay.com/docs/webhooks/validate-test/)
- [Separate QR Codes product and activation prerequisite](https://razorpay.com/docs/payments/qr-codes/)
- [Order fetch and receipt filtering](https://razorpay.com/docs/api/orders/fetch-all/)
- [Official Node SDK](https://github.com/razorpay/razorpay-node)

Account prerequisite: all accounts now require email verification before login/payment access. Existing demo inboxes need explicitly enabled development-only email preview; real users need SMTP. See [AUTHENTICATION.md](AUTHENTICATION.md). Payment tests use injected MOCK mail and disposable accounts.
