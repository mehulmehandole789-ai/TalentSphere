# Executed recruitment results

Baseline: 55/55 backend tests passed before implementation. Final suite: 75/75 passed, zero failures. `npm run build` passed. Recruitment Playwright browser, existing authentication/booking/payment browser, and existing connected-platform browser scripts all passed. See the raw logs linked in the compliance matrix.

Machine: win32 x64, 12th Gen Intel(R) Core(TM) i5-12450HX, 12 logical CPUs, 11.73 GiB RAM, Node v24.14.1. Synthetic data only. These are local observed runs, not controlled hardware comparisons or production guarantees.

| Records | Ingest seconds | Comparisons | Active index estimate MiB | Spilled buckets | Worker operations/sec | p50 / p95 / p99 ms | Claim conflicts | Queue peak / end | Audit valid |
|---:|---:|---:|---:|---:|---:|---|---:|---|---|
| 1000 | 2.09 | 249 | 0.72 | 0 | 819.2 | 31.52 / 48.26 / 51.33 | 750 | 1000 / 750 | true |
| 10000 | 19.21 | 28929 | 5.75 | 0 | 800.0 | 30.71 / 62.23 / 141.46 | 9000 | 1000 / 0 | true |
| 50000 | 547.35 | 744051 | 4.87 | 134032 | 1321.9 | 17.70 / 37.69 / 74.51 | 49000 | 1000 / 0 | true |

All queue runs use four actual worker threads and 1,000 preloaded application entries. An operation is an idempotent enqueue followed by a contended claim. Workers intentionally overlap application IDs. For the 1k run, 250 distinct entries are claimed and 750 remain queued; 10k/50k runs claim all 1,000 and remaining attempts conflict. Distinct thread IDs, lock contention, retries (zero; the runner does not retry), heap/process memory, exact latency measurements and audit heads are recorded in each JSON. Queue prefill time is outside measured worker throughput. End-of-run memory is a snapshot, not a sampled peak.

The 50k JSON explicitly retains its original completed ingestion observation and records a later queue replay on the same synthetic database with the final queue instrumentation and audit handling. Reproduce that replay with `node scripts/replay-recruitment-queue-stress.js 50000`; a fresh `npm run recruitment:stress -- 50000` repeats both stages. Other tests/browser checks ran on this machine during parts of these measurements, so do not infer hardware scaling from cross-run throughput variation.

The 50k spill run shows significant per-file I/O overhead. Active index estimates exclude transient records and V8 overhead: compare `identity.index.processHeapBytes` with `memory.heapUsed` / `memory.rss` in JSON. No bucket candidates were truncated. Worst-case identical-name/contact comparisons remain quadratic, as documented.

The existing database migration was executed using online backups. `migration-preservation.json` compares row hashes for every table that existed before the upgrade and reports all preserved; no row values or secrets are printed. `npm run recruitment:verify` also verified the existing database ledger.

Migration v3 follow-up: 75/75 backend tests passed after decomposing the remaining profile/package/event mutable lists behind writable views. All three browser suites passed with these views. Original table rows were preserved semantically, with exact source text archived; see LEGACY_NORMALIZATION.md and recruitment-results/migration-preservation-v3.json. These 1k/10k/50k timings predate v3 and have not been represented as new post-v3 benchmark runs. Operational limits and unchanged historical financial compatibility fields are documented.
