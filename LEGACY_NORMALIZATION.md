# Legacy fact normalization, migration v3

Migration v3 closes the profile/package/event list normalization work left by the initial recruitment upgrade. It uses the existing SQLite online-backup API, verifies the backup schema and `quick_check`, then performs the entire decomposition in one transaction. Original list values and publication labels are retained in an immutable archive. No users, bookings, payments, or upload files are replaced or reseeded.

| Existing interface | Physical mutable facts after migration |
|---|---|
| `artist_profiles.skills` | `artist_profile_skills(artist_id, position, skill)` |
| `artist_profiles.media` | `artist_portfolio_items(artist_id, position, url)` |
| Scalar properties in `artist_profiles.details` | `artist_detail_fields(artist_id, field, value_type, text_value, number_value)` |
| Flat arrays in profile details | `artist_detail_lists` plus `artist_detail_list_items`, with positions and typed values |
| `artist_packages.extras` | `package_extras(package_id, position, name, amount_paise)`; integer paise enforced |
| `events.talent` comma-delimited requirements | `event_talent_requirements(event_id, position, requirement_text)`; original spacing and delimiters round-trip |
| `events.organizerName` | `event_publication_labels`: the organizer label **at publication**, independent from the current account name |

The physical parent tables are `artist_profile_core`, `artist_package_core`, and `event_core`. The old table names are writable compatibility views. INSTEAD OF triggers project edits into relational facts atomically, while existing routes and serializers keep their JSON response shapes. Lists preserve order, duplicate entries and empty arrays. Null, boolean, numeric and string detail values retain their types. Views reconstruct JSON; mutable JSON copies are no longer stored in the parent tables. SQLite rewrites existing foreign-key references when the parent tables are renamed; the migration checks all foreign keys before commit. The original `artist_skill_facts` interface becomes a distinct-skill view over the ordered relation.

`legacy_normalization_archive` retains each original source value. UPDATE and DELETE triggers protect it. Arbitrary pre-existing nested profile extensions not exposed by the editor are retained separately as immutable `artist_detail_extensions`; they round-trip through the view, and changing/removing them is rejected explicitly. New unsupported nested extensions are rejected, rather than ignored or stored as mutable JSON. Malformed historical arrays, non-text skills/media, unsupported extra fields, and invalid/noninteger monetary extras stop and roll back the migration. A source record is never dropped to force a successful migration.

This is a 3NF decomposition of these mutable fact domains: ordered facts depend on their complete parent/position key; detail values depend on parent/field; scalar parent attributes remain in their owning entity. Compatibility views are intentionally denormalized projections, not additional stored mutable facts. Prose descriptions, equipment notes and included-service descriptions remain atomic free text, not parsed guesses about lists.

The duplication audit also distinguishes facts with different meanings:

- User location is the account's location; artist location is the advertised service base. They can differ, and the editor already treats them independently. They are preserved, not silently synchronized.
- Organizer labels and review author labels are historical publication/attribution values. Renaming an account must not rewrite old published attribution.
- Quotes, agreed bookings, provider orders and captured transactions retain independent historical amounts. Existing legacy float display amounts and integer payment fields are preserved for agreement/API compatibility; this migration does not rewrite the financial model or assert that every legacy compatibility column has been eliminated.
- Verification records are evidence; the profile verification flag controls publication of a badge. These are separate responsibilities.

Immutable source records, original migration values, evaluation inputs/results, accepted quote/booking snapshots, and ledger old/new values are historical snapshots. Their JSON is kept intentionally and is not treated as a mutable relational list.

## Executed verification

- Backend suite: **75 passed, zero failed** after migration v3.
- New tests in [normalization.test.js](backend/test/normalization.test.js) migrate nonempty demo data, compare old/new semantic rows, preserve list order and duplicates, check integer money, reject extension edits, verify foreign keys, and reopen through the unchanged legacy initialization/seeder.
- A malformed-data test confirms rejection before any partial normalized schema is saved.
- Recruitment, connected-platform, and authentication/booking/payment Playwright scripts passed after introducing the writable views. Their provider/email interactions use existing mocks. Logs: [recruitment](normalization-recruitment-browser.txt), [connected platform](normalization-platform-browser.txt), [legacy authentication/payment](normalization-legacy-browser.txt).
- The migration was applied to the existing database. [Preservation evidence](recruitment-results/migration-preservation-v3.json) reports all rows preserved across the 29 original tables, comparing JSON semantically when views change serialization order. Exact original text remains in the archive.
- The existing database's audit hash chain verified after the atomic `schema.normalized` entry.

Run `npm run recruitment:migrate` to apply versions 1–3. `node scripts/verify-recruitment-preservation.js` compares against the earliest pre-upgrade snapshot; an explicit backup filename can also be supplied. The verifier refuses to report success for an empty snapshot. `npm run recruitment:verify` checks the complete audit chain.

The 1k/10k/50k algorithm observations in the existing measurement report were executed before v3. They remain labeled observations of those runs; no new 50k timing is claimed for this schema-only follow-up. The matching, parser, heap and worker algorithms were unchanged by v3.
