# Talent Recruitment workspace

This extends the existing CommonJS Express / better-sqlite3 / vanilla HTML platform. Open `/recruitment.html` using the **Recruitment** navigation link. Sign in through the existing platform first. No external matching services or AI are used.

The supplied `HACKATHON PROBLEM STATEMENT.pdf` was read from Downloads. Track 5 specifies `Years_Experience`, `Mandatory_Certifications_Count`, and `Notice_Period_Days`, and requires both `Technical_Panel_Clearance` and `Background_Check` to pass before `Offer_Generation`.

## Run

From the repository root, with Node.js 24 (the tested version is 24.14.1):

```powershell
npm ci
npm run setup
# For a fresh installation only: copy backend/.env.example to backend/.env,
# set a random JWT_SECRET, then configure email/payments as described in README.md.
# Preserve an existing .env. Never commit it.
npm run recruitment:migrate
npm run create-admin
npm run recruitment:demo
npm start
```

`create-admin` uses the existing admin bootstrap and is only needed if there is no admin. Existing organizer and artist accounts continue to work. `recruitment:demo` requires an existing admin and adds 20 deterministic **SYNTHETIC_DEMO** applicants, independent applications, a sample stored rule, and one swapped-name duplicate. Repeating it is idempotent. It does not change credentials or merge users. The stress script creates an isolated database with a deliberately unusable login hash; it never loads the production `.env`.

```powershell
npm test
npm run build
npm run test:recruitment:browser
npm run test:browser
npm run test:platform:browser
npm run recruitment:verify
node scripts/verify-recruitment-preservation.js
npm run recruitment:stress -- 1000
npm run recruitment:stress -- 10000
npm run recruitment:stress -- 50000
```

Stress results go to `recruitment-results/scale-N.json`; isolated databases are ignored by Git. Set `RECRUITMENT_WORKERS` (1–16), `RECRUITMENT_WORKLOAD` (operations per worker, 1–50000), `RECRUITMENT_INDEX_MB`, and `RECRUITMENT_QUEUE_WAITERS` in the environment as needed. CLI stress defaults to four workers and approximately N total operations. Each operation includes enqueue and claim, so command throughput is approximately twice the reported operation throughput. Repeated claims deliberately produce conflicts. For 10k/50k runs, the queue workload preloads 1,000 independent applications; identity ingestion processes all N records. This distinction matters when interpreting scale results.

The browser script uses installed Chrome and Playwright. Existing browser scripts remain available; see [verification evidence](RECRUITMENT_REQUIREMENTS.md) for which checks were actually executed.

## Teacher demo (about five minutes)

1. Sign in as admin, seed with `npm run recruitment:demo`, open Recruitment. In **Duplicate review**, compare the swapped-name pair and source records; accept merge, then split/undo. Observe that the user list and logins are unchanged. Reject the match to clear identity review for the workflow demonstration.
2. In **Rules & priorities**, validate the example, inspect AST/evaluation, save and activate. Save another version with `Years_Experience >= 8`, activate it. Explain that old queue entries keep their exact evaluations; new entries use the new version. Reactivate the first version for the remaining demo.
3. In **Live priority queue**, evaluate an application, claim it. In **Stress laboratory**, run four workers with 100 operations. Inspect distinct actual thread IDs, lock contention and claim conflicts. Only one successful claimant is possible per entry. Admins can explicitly release a claim for recovery.
4. In **Workflow graph**, open an application. Claim/pass Application Submitted, Identity Resolution (after duplicate review), then Rule Evaluation (after evaluating/enqueueing). Both independent branches become ready.
5. Pass Technical Panel Clearance. Offer remains blocked by Background Check. Pass Background Check. Offer becomes ready. Claim/pass Offer Generation; one offer is persisted. Repeated completion is rejected.
6. In the template editor, append `["Offer_Generation","Rule_Evaluation"]` to edges. Saving returns a cycle path and saves nothing. Existing workflow instances keep their pinned template version.
7. Open **Audit ledger**, inspect old/new states and request IDs, verify the chain. `npm run recruitment:verify` provides the same check from the CLI.

## Intake contract

Single intake: `POST /api/recruitment/candidates` JSON with `name`, `email`, `phone`, `location`, `feed`, `external_id`, `Years_Experience`, `Notice_Period_Days`, and `certifications`. Names, feed and external ID are required. Email/phone can be absent; missing numeric fields remain null. Experience accepts 0–100; notice period accepts integer 0–3650. Certifications are normalized unique names, supplied as an array or `|` separated string. The current Track 5 prototype treats the submitted certification list as the mandatory certification set: its distinct count produces `Mandatory_Certifications_Count`. Job-specific certification catalogs are a future extension.

`POST /api/recruitment/imports?feed=FEED&format=csv` with `text/csv`, or `format=ndjson` with `application/x-ndjson`. Imports consume request chunks directly before Express's JSON middleware, with awaited row ingestion applying stream backpressure. CSV supports quotes, escaped quotes, CRLF and quoted newlines. CSV headers include `external_id` and the same applicant fields. NDJSON uses one object per line. Rows are bounded at 64 KiB, jobs at 100k rows / approximately 100 MiB decoded data. Bad data rows persist errors and processing continues. Structural CSV, stream interruption and resource-limit failures stop the job with a durable failed state; a process restart marks in-flight jobs interrupted. Query the imports list during ingestion for progress. Resubmit the same feed after interruption; accepted rows are idempotent.

Idempotency scope is `(submitting user, feed, external ID, canonical raw-content hash)`. Reordered object keys hash identically. Changed content creates immutable source history and does **not** silently overwrite canonical values. Raw records, normalized snapshots and per-field provenance remain available. A duplicate never changes `users`, JWT identity, email verification, bookings or payments. Artists can explicitly link only a candidate they themselves submitted to their own account.

Optional `date` accepts ISO `YYYY-MM-DD` and unambiguous slash dates: `24/03/2026` or `03/24/2026`. `03/04/2026` is rejected. Invalid calendar dates are rejected. No locale is guessed. Phones retain digits with a caller-supplied country code; national-country inference and email-provider-specific transformations are intentionally absent.

## Architecture and algorithms

HTTP/RBAC: `backend/src/recruitment/routes.js`; persistence orchestration: `service.js`; migrations: `migrate.js`, `schema.sql`; pure algorithms: `algorithms/`; ledger: `audit.js`; heap owner: `queue.js`; real worker runtime: `worker.js` / `stress.js`; streaming decoders: `stream.js`; frontend: `frontend/recruitment.*`.

### Identity routing

Names use Unicode NFKD, combining-mark removal, case folding, punctuation-to-spaces and whitespace collapse. Email uses trim/lowercase. Blocking keys include exact normalized email, exact phone, sorted whole-name Soundex codes, and each name token's Soundex plus normalized location. Names are token-sorted before custom two-row Levenshtein, so name-order swaps do not reduce similarity. Non-Latin names remain stored, but the phonetic implementation is English Soundex; contact blocks remain useful across scripts.

Only IDs selected by the application inverted index are fetched by primary key and compared. There are no table scans, SQL LIKE operations or SQL search indexes used to select matches. A streaming rebuild reads compact ID/name/contact/location projections at startup; full applicant records are not retained. Merged aliases stay in the routing index and resolve to their canonical candidate. Certification names are the union of active merged members; splitting recomputes that union without destructive rewrites. Raw records remain associated with the original identity and the candidate detail view includes merged members' sources.

Score = `45 * nameSimilarity + 30 * exactEmail + 20 * exactPhone + 5 * exactLocation`, rounded to 0.1; similarity = `1 - distance/maxLength`. Score >=45 creates a **review**, never an automatic merge. Exact names in the same block qualify for review; this deliberately accepts some false positives. Reviews sort by descending score then numeric candidate ID, with explanations. Reject decisions persist. Merge chooses the lower ID and records reversible membership; dependent merges must be undone first. Matching is scoped to the submitting user to prevent third-party PII disclosure.

The default active posting budget is 8 MiB. IDs, keys and a fixed bit filter are accounted in `estimatedActiveBytes`; `processHeapBytes` separately reports actual V8 heap use. The estimate is a structural accounting metric, **not** an exact V8 allocation measurement or a process RSS limit. Posting lists spill to custom hash-named files; the fixed filter avoids retaining unbounded spilled-key metadata. Filter positives are confirmed against disk, so collisions cannot drop candidates. Oversized buckets are streamed and yield every 128 comparisons, avoiding unbounded ID materialization and long synchronous comparison loops. No candidate count cap truncates a bucket. Spill files are temporary and reconstructed from durable candidates on restart. Import writes are serialized under a bounded mutex.

For N records, K blocking keys per record, maximum bucket size B, total comparisons C, and maximum compared name length L: routing is expected O(NK + C), matching O(CL²) time and O(L) scratch space. C includes repeated examination through multiple keys (reported honestly); no unbounded global visited set is kept. If B = O(log N), bounded K/L gives O(N log N). Identical-contact/name skew can make C = O(N²); spilling and yielding mitigate memory and event-loop starvation, **not** that worst-case comparison count. Name-only fuzzy records that share no block can be missed. Disk space is O(NK) postings; large spill sets can cause significant filesystem overhead. Active posting estimate is bounded by configuration; transient parser/SQLite/result objects, pending review matches and V8 overhead are outside that structural budget.

### Rules

Custom lexer → recursive-descent parser → Literal/Identifier/Unary/Binary AST classes. Precedence: comparisons > NOT > AND > OR; parentheses override it. Operators: `> >= < <= == !=`; numbers, JSON double-quoted strings and booleans; identifiers are the three teacher fields, all numeric. Comparisons require equal types; ordered comparisons require numbers; logical operands require booleans. No eval, JavaScript execution or third-party parser exists. Limits: 4,096 characters, 512 tokens, 32 nested NOT/parenthesis levels. Errors include positions.

Null/missing values propagate unknown through comparisons/NOT. AND is false if either operand is false, otherwise unknown if either is unknown; OR is true if either is true, otherwise unknown if either is unknown. Only true matches a rule. Evaluation traces explain operands/results. Compile/evaluate are O(T)/O(T) time and O(T) AST storage, with a bounded parser stack. Traces can include repeated subtree evaluations in nested expressions; under the hard expression/depth limits this is bounded, but trace generation can cost O(T²) in an unconstrained skewed AST.

Rule versions are append-only through API. Activation atomically switches the version for one named rule. Enqueue captures **all** currently active rule versions, exact input and result snapshots in one transaction. Highest matched configured numeric priority wins; no match defaults to zero. Stable tie-breaking uses immutable queue sequence, then ID. Existing entries preserve original versions even after activation. Manual admin priority override is audited and leaves evaluation snapshots intact. Creating a new application/submission key is the explicit way to evaluate anew. The generic request validator permits comparison symbols only in the `expression` property of the two POST rule-expression endpoints; all other fields/routes retain existing checks. The frontend renders expressions through `textContent`.

### Thread ownership, locking and recovery

This is a **single Node process, one SQLite writer/heap owner** architecture. Actual Node `Worker` threads execute the synthetic producer workload and send competing enqueue/claim commands. No heap object or SQLite connection is shared with workers. The owner has a custom FIFO asynchronous mutex; every post-initialization heap mutation, command and workflow-driven removal occurs under that manual lock. Message passing transports commands; the mutex provides exclusion across asynchronous owner handlers. Holding the lock over an explicit event-loop yield makes competing commands exercise the lock. Queue construction before requests is the only unlocked initialization.

The mutex rejects excess waiters with 429, times out at five seconds, removes timed-out waiters, and releases in `finally` on exceptions. Imports have a separate 32-waiter/30-second mutex. Worker producers cap outstanding operations at eight per worker. Worker errors/exits/timeouts are reported; pending durable claims remain owned until an explicit audited admin release. No automatic reassignment can accidentally create two claimants. Stable IDs and persisted status permit retrying unknown-outcome enqueue/claim commands safely.

Custom binary max-heap: enqueue/dequeue/update/remove O(log Q), peek O(1), positions map O(Q), space O(Q). Each command first commits queue state, pinned evaluations and audit atomically in SQLite; then publishes the heap mutation before releasing the lock. On publication failure, rebuild from committed state under the same lock. A crash between commit/publication is repaired by a restart rebuild. Claimed rows stay claimed; queued rows return to heap. Workflow close/rejection and queue removal share an outer SQLite transaction, followed by heap rebuild under the mutex. This recovery is O(Q) heap insertions (O(Q log Q) current construction), and workflow mutation currently rebuilds the heap, so its total cost includes O(Q log Q). Multiple HTTP servers sharing this database are **not supported**: their independent heaps/mutexes would not coordinate. Deploy one engine process.

### Workflows

Templates normalize nodes and adjacency edges and persist immutable versions. DFS coloring rejects cycles with a concrete path before any save. Kahn's algorithm builds the topological order using adjacency/indegree maps in O(V+E) time and space. Instances have independent task rows, pinned template version, and revision counters. HTTP updates require the observed version; only one competing claim succeeds. Completion requires the claimant (or admin). Readiness is recomputed from the pinned graph after each pass, using all incoming prerequisites. Current service rechecks edge lists and task arrays for each blocked node (O(VE + V²) worst case), acceptable under the 64-node/512-edge template limit; it does not claim O(V+E) transition processing.

`ready → claimed → passed/rejected/failed`; `failed → ready` is an explicit retry. Rejection ends the instance and cancels remaining tasks; cancellation does the same without a rejection. Passed tasks remain historical. Offer insertion has UNIQUE(instance_id), task OCC, prerequisite gating and transaction protection. Identity cannot pass with pending duplicate reviews. Rule Evaluation cannot pass before the application has stored queue evaluations. Status/claimant/prerequisites/blocked reasons and ledger transition history appear beside the actual branching graph.

### Audit and persistence

Every engine state mutation and its ledger row commit together; helper `Audit.append` refuses use outside a transaction. Ledger entries contain actor, UTC time, action, entity, correlation ID, old/new snapshots, global sequence, previous hash and SHA-256 hash. Deterministic serialization sorts object keys. UPDATE/DELETE triggers reject ordinary ledger edits; source-record history has similar triggers. Foreign keys use RESTRICT for recruitment identities/history rather than cascades that could erase evidence. No delete HTTP endpoints exist. The verifier streams the complete chain and checks both sequence and hash continuity. A hash chain detects tampering, and triggers protect normal SQL operations; a privileged host administrator can still rewrite a SQLite file and recompute the entire chain. There is no externally anchored immutable head.

Migrations v1–v3 use SQLite online `backup()` before its atomic schema/data transaction. A separate preflight backup process protects the existing legacy initialization before its synchronous writes on first upgrade; copying the `.db` file alone is never used. WAL is included by the backup API. Failed migrations roll back; backups remain available. Migration history is separate from legacy startup initialization. Migration v2 adds database triggers enforcing task membership in the pinned template. All versions are recorded and backed up before changes. Migration v3 decomposes profile/package/event lists into relational facts behind writable compatibility views; see LEGACY_NORMALIZATION.md. Existing tables, rows, uploads and credentials are preserved.

Recruitment mutable relational facts are separated into candidate, source identity, certification/link, import/error, rule/version, evaluation, application/queue/evaluation-link, template/version/node/edge, instance/task, offer, and ledger relations. JSON is used for immutable source/evaluation/audit snapshots and benchmark observations, not mutable certification lists or graph topology.

Migration v3 completes the profile/package/event mutable-list decomposition: ordered skills, portfolio items, typed detail fields and lists, package extras, and event talent requirements now live in child relations. Legacy table names are writable compatibility views that reconstruct JSON and retain API shapes; parent tables no longer store those mutable JSON/text lists. Original values are archived immutably. Account location and artist service base remain distinct facts; organizer publication names and review attribution remain historical labels. Financial agreement/provider snapshots and legacy money compatibility fields are preserved without rewriting payments. See [the normalization assessment](LEGACY_NORMALIZATION.md) for source/test evidence and exact boundaries.

## RBAC and operational limits

Existing admin: rules/templates/duplicate decisions/stress/audit plus all candidate/workflow data. Existing organizer is the recruiter role: their candidates, imports, applications, permitted task claims/completions, scoped queue entries. Existing artist: their own candidate intake, provenance, applications and read-only workflow. No new global role or privilege is granted. Authorization is enforced on the server. Candidates from different submitting owners are not merged. Audit access is admin-only; applicant task views return only the history of that application's workflow.

Dashboard lists bound results (typically 200, imports 50, errors 500); audit offers cursor pagination. Candidate/queue screens currently need richer pagination/filtering for large operational datasets. The UI polls queue/import views every five seconds while visible. Stream imports remain in the initiating connection; interrupted feeds must be resubmitted rather than automatically resumed. Benchmark runs are a prototype, not a guarantee of production throughput or exhaustive recall.
