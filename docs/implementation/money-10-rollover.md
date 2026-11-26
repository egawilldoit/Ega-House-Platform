# MONEY-10 rollover slice and integration dependencies

Status: implementation candidate on `feat/money-001-core-ux`, rebased onto
`main` with MONEY-09 (durable day close) and the MONEY-001-A continuity slice
integrated.

## What this branch delivers

- `packages/domain/src/money-rollover.ts`: pure rollover rules — finished-source
  precondition, close-evidence completeness, successor date defaults and gap
  policy, explicit unpaid-item treatment, opening provenance, closing
  reconciliation assessment, and derived week windows. The canonical correction
  bridge and its identity live in the database trigger.
- `packages/application/src/money/rollover.ts` + `rollover-ports.ts`: preview and
  write use cases. The successor occurrence plan is composed from the existing
  MONEY-06 recurrence rules, never re-implemented.
- `packages/data-access/src/money/rollover-repository.ts`: request-scoped
  Supabase reads, the close-snapshot comparison RPC and the atomic rollover RPC.
- `drizzle/0107_money_10_period_rollover.sql`: successor link, rollover receipt,
  bridge/variance rows, the single-transaction rollover function,
  `money_rollover_close_snapshot_summary`, and the ledger correction trigger.
  Journal position `0107` follows MONEY-09's `0104`–`0106` migrations.
- `drizzle/0111_money_11_optional_close_rollover.sql`: optional close, reviewed
  finalization with retained unverified-day evidence, and the finalization
  variant of the atomic rollover RPC.
- `drizzle/0112_money_001_a_period_continuity.sql`: the `superseded` lifecycle,
  the controlled `money_continue_period` RPC, the atomic
  `money_record_routine_movement` continue-and-insert path, the guard/transition
  extensions, rollover adoption of an already-continued successor, and the
  predecessor/early-finalization blockers. The routine RPC is the only writer
  that can start a later tracking window from a routine write; reads never call
  it. When no period is tracking, the latest period ended by its final-day close
  can continue the same calendar while staying `ended` with unchanged close
  evidence, and finalization later adopts that successor by its exact date-chain
  range. A non-finalized superseded period still accepts its own routine dates.
  Every routine write with a resolved period uses that RPC so a rollover that
  commits between application resolution and insert cannot be bypassed by a
  direct stale insert. The routine write, continuation and rollover adoption
  share one owner-scoped ascending period lock, which also removes the
  continuation/adoption deadlock. Rollover stores opening evidence built from
  the validated cutoff and the database clock, preserves an adopted opening's
  correction history, records an explicit `evidenceUpgrade` when an initialized
  opening becomes reconciled, and refuses a cutoff conflict.
- Wire contracts (`packages/contracts/src/money-rollover.ts`), Hono routes
  (`GET /api/money/periods/:id/rollover/preview`,
  `POST /api/money/periods/:id/rollover`), typed api-client methods, a web
  server action and a rollover panel, and the MCP tools
  `ega_money_rollover_preview` and `ega_money_rollover_variances` (read) and
  `ega_money_rollover_period` (write).
- Proofs: `packages/domain/test/money-rollover.test.ts`,
  `packages/application/test/money-rollover.test.ts` and
  `scripts/db/money-10-rollover-verify.mjs`.

## MONEY-09 integration (implemented here)

1. **Finished source state.** MONEY-001-A supersedes the original
   `lifecycle = 'ended'` / `active_date = end_date` precondition. A still-tracking
   period is a legal finalization source: the explicit rollover reviews every
   inclusive date, lists retained closes and every unverified/unclosed date
   (including leading dates), and requires a retained acknowledgment note with
   the exact reviewed count. No close row is fabricated. A fully closed source
   keeps the original behavior. A rolled-over period remains ineligible. The
   atomic write repeats the review and count check so a stale preview cannot
   bypass the acknowledgment.
2. **Close snapshots.** `MoneyRolloverSourceContext.closeSnapshots` is read from
   `money_day_closes` by `money_rollover_close_snapshot_summary`. Every retained
   close is compared with the same canonical aggregates used by the MONEY-09
   restated read. A changed snapshot requires `acceptClosingDifferenceNote`;
   missing or incomparable evidence blocks rollover instead of passing silently.
   The atomic rollover repeats this check, so a stale preview cannot bypass it.
3. **Correction path.** `personal_expenses_rollover_bridge` is an
   `AFTER INSERT OR UPDATE` trigger on the canonical ledger. Every correction
   path — web, HTTP, MCP, a direct versioned PostgREST update or a backdated
   insert, including legacy rows with no `period_id` — resolves the affected
   rolled-over source by booking date and calls
   `money_apply_rollover_bridge(...)` inside the same transaction. It measures
   the old and new signed cash effect against each source window, is idempotent on
   `bridge:<source>:<movement>:<correctionVersion>:<direction>:<destination>`,
   posts only the incremental delta, and stops at a verified opening with a
   variance row. A movement moved between rolled-over windows bridges both
   sources; nested bridge postings are not re-bridged. A failed bridge aborts the
   correction, so successor cash cannot commit inconsistent. Post-cutoff
   corrections are not bridged. The bridge RPC is not granted to clients; only
   the definer trigger invokes it. Ledger writes lock affected periods to
   serialize with rollover. Concurrent obligation writes can deadlock; the
   database aborts one transaction and the affected operation can be retried.
4. **Preview surface.** `money-day-close-panel.tsx` and
   `money-rollover-panel.tsx` remain separate secondary components; the Money
   page renders close evidence for the selected period and rollover for a
   tracking, superseded or ended source. MONEY-001-A added the retained
   unverified-days acknowledgment and moved both tools below the primary
   summary / quick entry / unified history.
   The successor copies the source's latest effective `money_policy_versions`
   settings (never the mutable `money_periods.settings` copy) and layers explicit
   overrides. Unpaid occurrences are read through bounded pages with an explicit
   truncation blocker. A `money-rollover-variance-panel` on the destination
   period and `priorCorrectionBridges` in the preview/MCP response disclose
   corrections that stopped at a verified opening. The same variance history is
   reachable over MCP for a tracking successor through
   `ega_money_rollover_variances`; its bounded read reports `complete=false` and
   `truncated=true` instead of presenting a shortened list as the full history.

## Deliberate limits

- The web panel confirms the documented default successor range. A full
  calendar-month source keeps its month span (January 1–31 → February 1–28/29);
  a partial source keeps its inclusive length. Custom dates and
  `settingsOverrides` are available through MCP/HTTP; the panel does not edit
  dates.
- `carry_forward` for unpaid items applies only to one-off occurrences
  (`template_id IS NULL`). Template-backed occurrences are regenerated by their
  template for the new period; carrying them too would duplicate the obligation.
- Daily-allowance carryover stays off by construction: each period's day-start
  baseline is computed independently and the rollover never adds unused
  allowance to the successor opening.
- Unknown closing cash is never carried as zero. A verified opening needs an
  amount, a cutoff date and retained evidence.
- An explicit null savings or emergency target clears that target. The successor baseline remains unavailable until both targets are set.
- The successor day-start baseline starts as MONEY-08 `initial_setup_incomplete`
  because a historical rollover cannot prove its initial obligation/funding
  history from current state. The Money period panel offers the existing explicit
  rebase/complete-setup action before the first successor day is closed; the
  current MONEY-08 rebase accepts a past active date in a tracking period, so a
  late rollover can still complete setup without moving the date to today.
- `p_provenance` may carry descriptive surface/correction JSON, but retained
  opening evidence is not trusted from it: the RPC builds `opening.source`,
  `cutoffDate` and `recordedAt` from the validated mode/cutoff and the database
  clock, and refuses a provenance cutoff that disagrees with the validated
  cutoff. A `carry_forward` opening must use exactly the source period end as
  its scalar cutoff, so a carried balance cannot be stored beside a different
  retained close date. Continuation/adoption identity is never read from this
  JSON: it comes from the real adjacent date chain and the exact requested
  range. Other cash, policy and close/reconciliation inputs are validated as
  before.
- An adopted opening with an equal amount keeps its correction history and
  verified evidence. Upgrading an initialized opening to reconciled records an
  `evidenceUpgrade` with the previous and new evidence instead of replacing the
  provenance; a retained verified cutoff that differs from the approved cutoff
  is a conflict. A later normal opening correction preserves that recorded
  upgrade history instead of dropping it with the replaced active fields.
- A retained available day-start baseline remains authoritative when the
  current budget plan is missing; the plan is required only for the derived
  start-of-day path. New MCP close receipts bind the effective `countsInDaily`
  classification. Receipts written before the explicit-null change still replay
  when that field is omitted, while a changed receipt shape (including explicit
  `true` against a legacy omitted flag) conflicts.
- A continued successor that already has an opening is never overwritten by
  finalization. The approved amount must match exactly; a differing amount is a
  conflict, and a reconciled opening cannot be downgraded.
- The variance read is bounded at 500 rows. It reports truncation rather than
  silently shortening the history; it does not paginate beyond that bound.

## Verification run on this branch

- MONEY-001-A F04 focused checks in the current patch: `npm run domain:test`,
  `npm run application:test`, `npm run contracts:test` and
  `npm run data-access:test` pass; `domain`, `application`, `contracts`,
  `data-access`, `api-client`, `web` and `server` typechecks pass. The
  application suite covers the setup-gated daily reference, the shared
  createExpense/continuation guard, atomic delegation, superseded-range
  backfill, cross-window update refusal, predecessor/early-finalization
  blockers, adoption range validation and the superseded lifecycle vocabulary.
  The data-access suite proves every routine write with a resolved period uses
  the atomic RPC (not a direct insert) and receives the guard-resolved booking
  day. The receipt test proves a pre-change close receipt with an omitted
  `countsInDaily` still replays, while an explicit `false` or another changed
  field conflicts.
- MONEY-001-A F04 focused checks in this fix pass: `npm run application:test`
  (807 passed) and the money-focused web Vitest suite (85 passed) pass;
  `application` and `web` typechecks pass; ESLint on every changed TS/TSX file
  passes. The application suite covers the missing-opening initialization on a
  non-finalized superseded period, tracking/superseded same-day finalization
  refusal in both opening modes, predecessor/early-finalization blockers, and
  adoption range validation.
- The prior MONEY-001-A F04 review-fix round passed `npm run
  application:test` (878 passed), `npm run data-access:test` (285 passed) and
  the money-focused web Vitest suite (233 passed, 3 skipped); `application`,
  `data-access` and `web` typechecks and changed-file ESLint passed. The
  application and web tests cover the retained day-start baseline with a
  missing current plan, the tracking-period quick entry default across a
  divergent owner/period midnight, and the legacy omitted-`countsInDaily`
  receipt replay.
- The Sol medium review-fix round passes `npm run application:test` (879
  passed), `npm run data-access:test` (285 passed) and 185 money-focused web
  Vitest tests (3 skipped); `application`, `data-access` and `web` typechecks,
  changed-file ESLint and `check:architecture` pass. New coverage proves a
  timestamped backfill into a superseded period uses that period's timezone, a
  normal opening correction preserves the adoption `evidenceUpgrade`, new MCP
  close receipts bind the effective `countsInDaily` while legacy omitted-flag
  receipts replay and explicit `true` conflicts, and an out-of-cutoff
  carry-forward is refused before any receipt.
- The disposable PostgreSQL proofs pass against `pg17dev` (all 105 migrations
  through `0112_money_001_a_period_continuity`):
  `money-001-a-period-continuity-verify.mjs` (continuation through the atomic
  routine RPC, future-date refusal, direct continuation-grant denial, routine
  backfill, concurrent routine writes converging on one successor,
  unknown-opening initialization with retained `continuedFrom` provenance then
  adoption, out-of-period preflight/correction/soft-delete, superseded/tracking
  same-day refusal, adoption conflicts and forged provenance, a paused routine
  resolution that is refused after rollover with no movement/receipt,
  equal-amount adoption that preserves corrections and records the evidence
  upgrade, a normal opening correction that preserves the recorded upgrade, a
  provenance/retained-cutoff conflict that leaves no mutation, a carried
  opening cutoff that differs from the source end and leaves no receipt, and a
  synchronized routine/rollover adoption with no deadlock),
  `money-001-a-optional-close-rollover-verify.mjs` (database-clock-anchored
  optional close and reviewed finalization), and
  `money-10-rollover-verify.mjs` (rollover, verified opening, early
  finalization refusal and post-close success).
- Not run in this fix pass: the browser `money-001-core.e2e.spec.ts` journeys.
  The continuity journey now starts from the default unknown opening,
  initializes the superseded opening through the owner form, then adopts the
  continued successor; it is registered in `scripts/e2e/assert-disposable-report.mjs`
  but remains unproven here. Run the Money E2E project before merge.

### Earlier MONEY-09/MONEY-10 proof runs (before the continuity slice was added)
- Full migration journal applied cleanly to a disposable PostgreSQL cluster
  (all entries through `0111_money_11_optional_close_rollover`), including the
  MONEY-001-A finalization rules and the `money-001-a-optional-close-rollover-verify.mjs`
  proof.
- `scripts/db/money-10-rollover-verify.mjs` passed against that cluster. It
  finishes the source and middle periods through real `money_close_day` calls,
  asserts two retained close snapshots compare cleanly with restated totals, then
  proves one atomic successor + opening, effective-policy copy from an empty
  period-settings copy followed by an available explicit setup baseline, replay
  without duplicates, unpaid one-off carry with reason history, the ledger
  trigger's incremental bridge, bridge replay idempotency, a verified-opening stop
  with variance disclosure, read-grant denial plus the positive writer-grant
  precondition, a default midmonth source that rolls over from its first tracked
  day, an interior tracked-range gap that is detected and blocks rollover, paid-
  obligation and counted-visit mismatches that each gate the note independently
  of restated closes, a source soft delete that restores successor cash and keeps
  the frozen source snapshot, backdated/legacy and cross-window bridging, and
  owner-scoped receipts.
- `npm run domain:test`, `npm run application:test`, `npm run data-access:test`
  and `npm run contracts:test` passed. The data-access suite covers the bounded
  pending-occurrence pagination, effective-policy read/fallback, bridge
  truncation disclosure and the stricter close-summary validation.
- `npm run domain:typecheck`, `npm run application:typecheck`,
  `npm run data-access:typecheck`, `npm run contracts:typecheck`,
  `npm run api-client:typecheck`, `npm run web:typecheck` and
  `npm run server:typecheck` passed after the review fixes.
- Focused rollover panel/variance tests, MCP read-handler tests, the Money page
  test, the server Money route test and the disposable rollover proof passed.
- The disposable proof is wired into the `db-invariants` job beside MONEY-09.
