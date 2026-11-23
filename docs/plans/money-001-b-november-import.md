# MONEY-001-B: November workbook import and adoption

Status: implementation slice for issue #433 (MONEY-13 support). This document
describes the delivered code path, not a production cutover.

## Scope

The slice imports one synthetic November workbook, reconciles it against an
owner-scoped money target, and adopts it only after an exact approval. It does
not read private owner data, run a background sync, expose a public import
endpoint, change the primary Money UI, change MCP grants, or take over MONEY-04
movement calculations.

**Real owner adoption remains blocked** until the plan's source
reconciliation and cutover conditions are satisfied and the named owner
explicitly approves the exact manifest digest. The synthetic fixture is the only
workbook exercised here.

## Architecture

```text
workbook export
  → createMoneyImportSnapshot          (domain, pure; frozen source evidence)
  → buildMoneyImportManifest           (domain, pure; exact candidates)
  → freezeNovemberImportSnapshot       (application; SHA-256 of canonical payload)
  → previewNovemberImport              (read-only target reads, zero writes)
  → applyNovemberImport                (approval → adoption receipt → writers)
      ├─ money_import_adoptions        (evidence/receipt only)
      ├─ createMoneyPeriod             (one opening, canonical period)
      ├─ createMovement                (each ledger candidate, stable key)
      └─ recordMoneyCoffeeVisit        (one visit, no second cash)
```

- `packages/domain/src/money-import.ts` owns parsing, classification, manifest
  construction, the signed cash equation and approval validation. It has no
  clock, network, database or environment access.
- `packages/application/src/money/import-ports.ts` owns owner-scoped read/write
  ports and the adoption receipt shape. `import.ts` owns the use cases.
- `packages/data-access/src/money/import-repository.ts` implements the ports
  with the request-scoped Supabase client. Every read filters
  `owner_user_id = actor.userId`, pages until exhausted, and never uses a
  service role.
- `drizzle/0109_money_11_import_adoption.sql` adds only
  `money_import_adoptions`. It stores no ledger row and has no DELETE policy or
  grant.

Money remains a non-negative integer number of MAD centimes plus `direction`.
The signed effect is derived once: `direction === "in" ? amount : -amount`.

## Approval boundary

An approval object is required. Apply recomputes the snapshot and manifest
digests and rejects any drift in:

- `manifestDigest`;
- `snapshotDigest`;
- owner id;
- target environment;
- approval status (must be `approved`);
- blocking discrepancies;
- acknowledged discrepancy ids.

The manifest also embeds a `targetBaseline` of the exact owner-scoped
movements (including classification/descriptive fields), obligations and coffee
visit records it was built from. On resume, apply re-reads target state and
rejects unapproved additions/changes as `target_drift` before any financial
write. Only exact import keys from `action:"insert"` candidates and the one
approved opening movement are allowed additions. Duplicate claims on one target
movement are blocking for both link and already-applied skip candidates.
Post-reconciliation uses the canonical whole-period ledger aggregate and
re-checks linked movement classification plus coffee date/lines, so an
unrelated or altered extra row forces `review_needed`.

Preview is non-mutating and never persists a snapshot. Apply performs the
receipt lookup before re-deriving a manifest. This ordering is required because
after a successful apply the target contains the import idempotency keys; a
fresh manifest would legitimately mark them `already_applied` and produce a
different digest. The adoption receipt is the replay/resume authority.

For the verified cutover strategy the opening amount is the verified
`cutover.reportedBalanceMinor`; the workbook opening row remains evidence and a
difference is disclosed as an acknowledged discrepancy.

| Stored state | Behaviour |
| --- | --- |
| same manifest digest, `adopted`/`review_needed` | return the stored receipt, zero writes |
| same manifest digest, `applying` | resume from the stored frozen snapshot and manifest |
| different manifest digest | conflict, zero writes |
| missing receipt | verify approval, preflight the period, then begin the receipt |

## Cutover strategy

`verified_cutover_opening` (default): the cutover balance is the opening; rows
strictly before the cutover date are skipped as `included_in_cutover_opening`
and never posted; rows on/after are replayed. Existing target movements before
the cutover block the manifest.

`full_history`: the earliest opening row is the opening; all later rows are
replayed (earlier rows are skipped as outside that opening balance); a missing
opening blocks. Both strategies require a known opening and never invent zero or
today's date.

A coffee row links to exactly one canonical coffee purchase (source ledger row
or target record) and produces one visit; the linked expense must be a valid
non-conflicting `coffee` expense. A paid bill links to a ledger payment or a paid
target obligation and posts no cash. An unpaid bill remains metadata.
Dashboard/formula/running-balance rows are `derived` and skipped. Settings rows
are metadata and skipped.

Sheet roles are an explicit case-insensitive allowlist (Ledger/Expenses/
Movements/Opening, Coffee, Bills/Subscriptions, Savings/Transfers, Dashboard/
Summary, Settings/Targets), including workbook aliases such as Fixed Bills and
Budget. Daily Tracker/Tracker is a distinct non-cash tracker role: it may hold
only derived or unresolved rows, so a cash row there is a blocking sheet
mismatch. `derived` rows may also appear on ledger/coffee/bills/savings sheets
without posting cash. Unknown sheets or a cash classification/sheet-role
mismatch block the preview, and cash ledger or coffee dates outside the snapshot
month are blocking. Pre-cutover target movements are read beyond the source-date
window so older history cannot bypass the cutover check.

The reported dashboard closing may disagree with the modeled closing. A
non-zero difference is an acknowledged discrepancy; it is never posted as
income or expense.

## Synthetic acceptance fixture

`packages/domain/test/fixtures/money-001-november.ts` contains 14 rows:
O1 opening; L1/L2 pre-cutover; L3–L7 and L9 post-cutover; C1 coffee; B1/B2
bills; D1 dashboard; S1 settings. Expected signed closing:

```text
100.00 + 1.00 - 10.00 - 20.00 - 0.25 - 5.00 - 7.00 = 58.75 MAD
```

= 5,875 centimes. One opening row, six post-cutover ledger rows, one coffee
visit, no bill cash.

## Acceptance mapping

| Test/acceptance id | Evidence |
| --- | --- |
| T21 / US-30 exact numeric and identity | `packages/domain/test/money-import.test.ts`: exact centime parsing, overprecision/display rejection, stable digest after reorder |
| T22 / US-31 classification completeness | domain and application tests: every row classified, derived/settings/coffee/bill no cash |
| T23 / US-34 safe preview | application test: two previews, identical digest, zero writes to every fake |
| T24 / US-33 target reconciliation | application tests: strong L7 link, ambiguous match block, wrong owner/environment forbidden |
| T25 / US-35 cutover opening | domain/application tests: pre-cutover absent, one opening, 5,875 closing |
| T26 / US-36 exact approval | domain approval matrix and application zero-write failures |
| T27 / US-37 interruption and replay | application test: failure after N creates, status `applying`, drift rejection, resume, exact-once rows, zero-write replay |
| T28 / US-38 workbook scope | domain/application tests: foreign workbook/month rejection, source unchanged |

## Not implemented in this slice

- Unpaid obligation persistence (the unpaid bill is metadata only; no obligation
  row is created).
- Savings/settings target writes (the settings row is metadata only).
- Budgets or allocation changes.
- Day-close statuses or close writes.
- Live source refetch or a background sync.
- A blocked-no-source state or an operator repair UI.
- Real-database application apply/readback. The append-only opt-in RLS proof
  exercises the table, not a production adoption.

## Evidence boundaries

- Unit/application tests use in-memory fakes that implement the real ports and
  call the real canonical application writers.
- `apps/web/src/lib/mcp/money-001-import.integration.test.ts` is opt-in via
  `MONEY_TEST_DATABASE_URL`, local-only by default, and runs in a rolled-back
  transaction. It proves owner isolation, no delete, and the signed adjustment
  aggregate. It is skipped when no local proof database is configured.
- No migration was applied to a remote/production database in this slice.
