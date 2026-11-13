# MONEY-10 rollover slice and integration dependencies

Status: implementation candidate on `t3/money-10-mcp-delivery`, rebased onto
`origin/main` at `0e684ae4` with MONEY-09 (durable day close) integrated.

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

1. **Finished source state.** Rollover requires
   `money_periods.lifecycle = 'ended'` and `active_date = end_date`. Close
   evidence is complete when every day from the first retained close (the
   inferred tracking start) through the source end has exactly one close. A period
   created on a month boundary but tracked from a later active date therefore
   rolls over normally: its untracked leading calendar days are not evidence
   gaps. An actual missing day inside the tracked range blocks the preview and
   the atomic write, and the blocker names the first missing date. Because the
   first retained close is the only tracking-start evidence used here, loss of
   that first close cannot be distinguished from an intentional later start.
   Repair of missing retained evidence requires an operational recovery; the
   product has no backfill action. The durable
   day close is the only normal producer of the finished state; a tracking
   source fails the preview before the panel is rendered.
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
   the definer trigger invokes it.
4. **Preview surface.** `money-day-close-panel.tsx` and
   `money-rollover-panel.tsx` remain separate components; the Money page renders
   close evidence for the selected period and rollover only for an ended source.
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
- `p_provenance` is composed by the application and is not independently
  revalidated by the rollover RPC; a direct SQL caller can pass arbitrary JSON,
  as with the other Money RPCs. The RPC does validate every input that changes
  cash, policy, or the close/reconciliation gate.
- The variance read is bounded at 500 rows. It reports truncation rather than
  silently shortening the history; it does not paginate beyond that bound.

## Verification run on this branch

- Full migration journal applied cleanly to a disposable PostgreSQL 17 cluster
  (all entries through `0107_money_10_period_rollover`).
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
