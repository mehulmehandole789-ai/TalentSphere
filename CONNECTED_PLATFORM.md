# Connected TalentSphere

## Local startup

Use Node 22 or 24. From the repository root:

    npm ci
    npm run setup

Only if backend/.env is missing, copy backend/.env.example to backend/.env. Set JWT_SECRET to a random secret of at least 32 characters. Keep an existing secret and database. Then:

    npm start

Open http://localhost:4000. Express serves the frontend, API and protected local media. SQLite runs in-process; no separate database server is needed.

Configure SMTP for actual verification and transactional email. For local verification without email delivery, explicitly set both NODE_ENV=development and EMAIL_DELIVERY_MODE=preview. Emails then appear in backend/.mail-preview/; no real email is sent. Existing unverified accounts still require verification.

## Connected journey

The existing organizer role is the client role.

1. An artist opens Profile & packages (#studio-profile) to edit biography, category, city, skills, genres, languages, service areas, travel, equipment and venue requirements, social links, photos, cover and performance samples. Packages include duration, base/travel prices, extras and cancellation terms. Archive and replace a package to revise it.
2. Availability (#availability) provides a month calendar, unavailable time blocks and confirmed booking details visible to the artist. IANA zones convert wall-clock input to UTC. API writes require explicit offsets.
3. Clients discover an artist and use Request a booking to reach #enquire/ARTIST_ID. Select a package or request a custom quotation. Pending enquiries do not block dates.
4. The artist sends itemized quotations from #booking/BOOKING_ID. Quantities and amounts use integer paise; expiry must precede the event and be within 30 days. A replacement quotation supersedes earlier versions.
5. The client accepts the latest valid quotation. An immediate SQLite transaction rechecks availability and saves an immutable agreement snapshot. A reservation lasts up to 15 minutes or the event start, whichever comes first.
6. Existing Razorpay Checkout uses the accepted amount. Only verified provider capture confirms a booking. Signatures, raw authenticated webhooks, duplicate event protection, refund observations and reconciliation are retained.
7. Participants view progress, timestamps, agreement, messages, payment status and downloadable text receipts in the booking workspace. After the event ends, the client can complete the event and submit one review.

New states: Requested → Quoted → Accepted → Payment Pending → Confirmed → Completed. Declined, Cancelled and Expired are terminal paths. Only authorized participants may make the appropriate transition. Administrators can inspect bookings and cancel with a timeline record, but cannot read private conversations or fabricate payment success.

Legacy #book, booking tables and API URLs still work with their original accepted-price controls. New primary booking actions use the connected journey. Historical bookings retain their original states, prices and payment facts.

## Storage and migrations

Schema changes run additively on application startup. They add profile details/visibility/moderation fields; timed booking/snapshot/reservation fields; eligible-review references; packages, availability, quotations, timeline, messages/reads, saved artists, notification outbox, reports/audits/verification and collaboration-board tables. Existing accounts, bookings and seed reviews are preserved. Legacy reviews without a completed-booking reference are excluded from public ratings and verified review displays.

New photos and performance samples are local files in backend/uploads/ (or absolute MEDIA_DIR). SQLite stores metadata and references only. Existing data-URL portfolio records remain readable. To move older images into files as well, back up the database/media and run:

    npm run migrate:media

New media allows PNG/JPEG/WebP up to 5 MB and MP4/WebM/MP3/Ogg up to 25 MB, with declared type/signature checks, owner authentication, limits and progress/error feedback. The library permits 24 files per artist. Images and video/audio are not transcoded; browser codec support applies. Back up the media directory with SQLite and keep both on persistent storage.

Profile visibility and moderation also gate public media access. Private owner previews use authenticated fetches without credentials in URLs. Media kits (#media-kit/ARTIST_ID) show introduction, portfolio, packages and booking CTA, excluding account email and private booking details.

## Payments and email

Use existing RAZORPAY_MODE=test, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET environment settings. See PAYMENTS.md for provider setup and webhook configuration. Only the provider public key reaches the browser.

Late capture after expiry, mismatched provider data, availability conflicts, cancellations after capture and refunds enter review_required. Inspect Admin → Payments and reconcile with Razorpay. No escrow, automated payouts or automatic refunds are introduced. Ledgers separate test/live captures, refunds and pending orders. A capture receipt is not proof of an artist payout. Real transactions and real inbox delivery have not been verified.

In-app notifications commit with booking transactions. A durable email outbox retries failures every 30 seconds in the normal npm start process, with backoff; in-app updates remain available if SMTP fails. This worker also expires quotations/reservations. Delivery is at-least-once: a crash around SMTP acknowledgement may produce a duplicate email. Deployments importing the Express app instead of starting src/index.js must explicitly start the outbox worker.

## Conversations, reviews and moderation

Only the client and artist can access booking messages. Conversations have timestamps, 30-message cursor pages, unread tracking, persistent per-user rate limits and 15-second polling. Polling preserves message drafts, handles errors and refreshes booking progress; no WebSocket dependency is added.

Public ratings/counts use stored, non-hidden reviews tied to completed bookings. Clients have one review per eligible booking, rated 1–5 with a comment. Reports target profiles or reviews. Admin tools include report status filters, paginated artist search/approval filters, verification records/revocation, restoration, payment oversight and audit records. Verification text states what the administrator reviewed; historical flags without records do not create public verification claims.

## Additional features

- Collaboration board (#collaboration-board): artists publish paid/unpaid opportunities, roles/skills, genre, local/remote location, budget and deadline; artists apply once; owners accept/decline applications or close a post.
- Build your event (#build-event): event type, city, date/time, zone, budget and preferred categories. Ordinary filtering uses saved artist data and current availability, not AI or a booking guarantee.
- Saved artists and participant payment history are in #workspace.

## Checks

    npm run build
    npm run lint
    npm test
    npm run test:browser
    npm run test:platform:browser

Browser suites use installed Chrome by default; set BROWSER_CHANNEL=msedge for Edge. Tests use isolated temporary databases/media and explicitly mocked Razorpay, never real charges. New browser tests cover the connected artist/client journey and role pages at 375/768/1024/1440 pixels. Screenshots are saved in ignored test-results/.
