# MONEY-001-A F04 — Period continuity design

Status: implemented in the working patch on `feat/money-001-core-ux`
(migration `0110_money_001_a_period_continuity`). No production migration or
deployment is part of this patch. The disposable continuity, optional-close and
MONEY-10 rollover proofs pass against the disposable PostgreSQL cluster; see
`money-10-rollover.md` for the verification record.

## Product behavior to satisfy

Starting a new financial period and finalizing/reconciling the previous period
are separate operations (MONEY-001 ID-07, ID-09; #432 FR-001/FR-003; #435
US-24/US-25/US-27/US-28/US-29). On December 1, an owner must be able to record a
December expense while November is still unreconciled, has missing (unverified)
days and has no invented opening. November must not be auto-approved. When
November is later reconciled, the existing December records stay unchanged, the
December opening is established once through the canonical opening workflow, and
cash/allowance recalculate.

## Current constraint

- `money_periods` allows at most one `tracking` period per owner; routine writes
  target that period and reject any date outside it.
- `enforce_money_period_close_transition` permits `tracking -> ended` only with
  an internal `finalization_reference` or a durable final-day close. Both mean
  "finalization evidence", not "the calendar moved on".
- `money_rollover_period` creates the successor, opening movement, copied policy
  and regenerated occurrences in one transaction, then sets
  `tracking/ended -> rolled_over` and links `successor_period_id`.
- Existing reads (`getMoneyState`, reserves, daily guidance) already tolerate an
  unknown opening: cash and allowance are reported unavailable, never zero.

Reusing `ended` for calendar continuation would misrepresent evidence, because
the close/finalization guards intentionally treat `ended` as an approved end.
Reusing `finalization_reference` for auto-continuation would forge finalization
evidence. A small lifecycle extension is therefore justified.

## Lifecycle

Add one lifecycle value: `superseded`.

```text
tracking --(routine entry needs a later date)--> superseded
superseded --(explicit finalization/rollover)--> rolled_over
tracking|ended|superseded --(explicit rollover)--> rolled_over
```

- `superseded` means: the routine window closed because a later tracking period
  began. It is **not** a reconciliation approval and carries no finalization
  reference, close row or opening movement.
- `superseded` remains a legal rollover source. Finalization still requires the
  existing explicit review, acceptance notes, close comparison and atomic
  receipt.
- The partial unique index / single-tracking invariant is unchanged.

This is additive: extend the lifecycle check constraint, the domain/contracts
lifecycle arrays, and the transition guard. No existing row, close, bridge or
receipt is rewritten.

## Automatic continuation (controlled write only)

New SECURITY DEFINER RPC `money_continue_period(p_booking_date date)`, called by
the application guard only when an authenticated routine **write** needs a date
after the current tracking window. The RPC derives `createdFrom` (`web`/`mcp`)
from the verified JWT client convention, so no caller-supplied surface is
trusted:

1. `auth.uid()` owner; MCP `personal_ops.write` grant; no service-role path.
2. Lock the owner's periods and current tracking period.
3. If a tracking period covers the booking date, return it (idempotent no-op).
4. If the date is before the current tracking period and inside a non-finalized
   `superseded` period, accept it for that period's own range (a superseded
   window is not finalization approval). Any date before the window that is not
   in a non-finalized superseded period is rejected as a historical correction.
5. Compute the smallest successor range that starts at `tracking.end_date + 1`
   and ends at the last day of the booking date's calendar month (capped at 366
   days). Reject a gap larger than 366 days with an explicit period-setup
   requirement instead of creating a chain of empty periods.
6. Mark the previous tracking period `superseded` (no `finalization_reference`,
   no close, no successor link yet). Do **not** set `successor_period_id`; that
   column keeps its finalization meaning.
7. Insert exactly one `tracking` successor with:
   - `initialization = 'uninitialized'`, `opening_movement_id = null`;
   - `active_date = booking date` (or the successor start when the booking date
     is later; the date is still inside the new range);
   - copied effective policy settings from the previous period, with no opening;
   - `provenance = { opening: null, createdFrom: <surface>, continuedFrom:
     <previous period id> }` (provenance is JSONB; no new column);
   - an unavailable day-start baseline (`initial_setup_incomplete`) through the
     existing create path.
8. Unique/race behavior: the transaction lock plus the one-tracking invariant
   makes concurrent first expenses converge on one successor. A stable
   continuation identity (`continuedFrom` + range) makes a retry return the same
   period.
9. Reads never call this RPC. No close, opening, receipt or financial row is
   created by a GET.

The continuation is never committed on its own. `money_record_routine_movement`
resolves the same period target and inserts the financial row in the same
database transaction, so a validation, idempotency or RLS failure rolls the
supersession back. The application `resolveRoutineEntry` rule only prepares the
target/message and delegates the atomic write; `createMovement` and
`createExpense` share it. Web, HTTP and MCP therefore keep one rule, and MCP
write grants and idempotency stay at the same boundary. A booking-date edit that
would leave the row's current period is refused instead of advancing the
calendar, so an update can never keep a stale `period_id`.

## Opening initialization and later reconciliation

- The new period starts with unknown cash. Recorded cash and safe/daily
  projections stay **unavailable** (already implemented) until the owner
  establishes the opening through the canonical period/rollover workflow.
- A predecessor left `superseded` by automatic continuation may have no opening.
  Because finalization cannot review cash without it, the non-finalized
  `superseded` range accepts exactly one narrow update: initialize the missing
  opening through `money_update_period`. Active dates, settings and later
  opening corrections stay closed until the explicit rollover review. A
  finalized (`rolled_over`) range still uses the historical correction path.
- When the previous period is explicitly finalized, the rollover RPC must
  **adopt** an existing continuation successor instead of creating a duplicate:
  - identify the immediate next period by the real date chain
    (`start_date = source.end_date + 1`), not by provenance JSON;
  - validate the requested successor range equals that period exactly;
  - if its opening is uninitialized, insert exactly one opening movement with
    the approved carry-forward or verified amount and mark initialization;
  - if it already has an opening, keep it. A differing approved amount returns a
    conflict, never an overwrite;
  - link `successor_period_id`, set `rolled_over_at`, `finalization_reference`
    and `lifecycle = rolled_over` on the predecessor in the same transaction;
  - never rewrite movements already recorded in the successor. Their cash
    simply becomes explainable once the opening is known.
- A continued successor cannot be finalized before its immediate predecessor.
  `getSourceContext` exposes the unfinalized predecessor and the preview returns
  a blocker; the RPC repeats the check so a direct call cannot skip it. This
  removes the orphaned-predecessor dead end instead of failing later as an
  overlap.
- Carry-forward or verified finalization of a tracking or superseded source
  that still owns today (including its exact end date) is blocked by the same
  preview/RPC pair: the current local day would stop belonging to any writable
  period. An already-ended source is exempt because its retained final-day close
  is the explicit decision.
- A concurrent continuation can supersede the row the routine RPC is waiting
  on. `money_record_routine_movement` retries the tracking read in a fresh
  statement before concluding that no tracking period exists, so two concurrent
  first writes converge on the same successor.
- If no continuation successor exists, the current rollover behavior is
  unchanged.
- A direct lifecycle/`finalization_reference` write remains impossible for
  authenticated callers; the existing guards stay authoritative.

## Impact on linked work

- **#433 November importer:** the importer must treat an auto-continued period
  as an existing period. Its cutover opening must target that period through the
  canonical opening/adoption path; it must not create a second period or a
  duplicate opening. Existing-record comparison must include continuation-created
  periods. No import is authorized by this design.
- **#434 MCP:** continuation is part of the same routine write use case and write
  grant, not MCP-specific logic. Read tools never create a period. Tool
  descriptions should state that the first write in a new month may establish a
  tracking period with an unknown opening.
- **Corrections/rollover bridges:** a correction to a superseded period continues
  to use the existing verified-opening cutoff and bridge semantics; the
  `superseded -> rolled_over` transition preserves the same evidence.

## Required migration and surfaces

- Additive check-constraint extension for `superseded`; no data rewrite.
- New continuation RPC plus grant/revoke; extend the rollover RPC to adopt an
  existing continuation successor.
- `src/db/schema.ts`, `@ega/domain` lifecycle arrays, `@ega/contracts` lifecycle
  unions and the period panel lifecycle text (raw lifecycle values remain
  rendered; no claim of friendlier labels).
- No new table, balance owner or parallel period subsystem.

## Acceptance tests to add with the implementation

1. Nov 1–30 tracking, several unclosed days, Dec 1 expense → one December
   expense, one December tracking period, November `superseded`, no close rows,
   no opening, cash/allowance unavailable-but-explicit.
2. Reconcile November later → adopted December opening (one row), December
   expense preserved, cash/allowance recalculated, no duplicate successor.
3. Multiple skipped months → one successor range containing the booking date, or
   an explicit setup requirement beyond 366 days; no empty period chain.
4. Concurrent first expenses in the new month → one successor only.
5. Existing initialized successor → opening not overwritten; conflicting
   verified amount surfaces a variance/conflict.
6. Historical correction after continuation → existing bridge/variance behavior.
7. Cross-owner, read-only MCP grant and unauthenticated calls → denied; zero
   writes.
8. Reads (`/money`, MCP reads) never call the continuation RPC.

## Implementation notes

- **Range rule.** The successor starts at `tracking.end_date + 1` and ends at
  the last day of the booking date's calendar month, capped at 366 days. This is
  one contiguous range even after skipped months, so no chain of empty periods
  is created. A gap larger than 366 days is refused with an explicit
  period-setup requirement.
- **One write path.** `resolveRoutineEntry` (application) owns the target/message
  rule; the database function owns the atomic continue+insert. `createMovement`
  (Money quick entry, HTTP, MCP) and `createExpense` (Today quick expense,
  `/api/expenses`, MCP) both delegate to it, so the policy cannot drift between
  surfaces. `GET` reads never call it; a focused application test injects a
  throwing overlapping-period read into a state read.
- **Period/date coherence.** `enforce_personal_expense_period_date` rejects any
  inserted or updated row whose booking date is outside the period it names.
  The application refuses cross-window date edits before writing; the trigger is
  the database backstop against a direct client leaving a stale `period_id`.
- **Non-finalized superseded dates stay routine.** A date inside a `superseded`
  period that has not been rolled over is accepted for that period's own range.
  This is the recovery path for a forgotten pre-continuation expense and does not
  finalize or reopen the period. Finalized (`ended`/`rolled_over`) ranges remain
  historical corrections.
- **Adoption identity.** Rollover finds the immediate next period
  (`start_date = source.end_date + 1`, tracking, ended or already superseded by a
  later continuation) under lock and requires the requested range to match
  exactly. Provenance JSON is deliberately not used as identity: the database
  proof forges `continuedFrom` and adoption still follows the real date chain. A
  mismatch is a conflict, never a duplicate or a silent retarget.
- **Opening provenance and initialization.** A continuation successor starts
  `uninitialized` with `opening_movement_id = NULL`, `day_start_setup_completed
  = false` and `provenance = { opening: null, createdFrom, continuedFrom }`.
  Rollover adoption inserts exactly one canonical opening movement when none
  exists, merges the approved opening provenance, and upgrades initialization.
  If the successor already has an opening, the approved amount must match
  exactly; a different amount is a conflict, never an overwrite. An already
  reconciled opening cannot be downgraded.
- **Lifecycle guard.** `superseded` is excluded from the approved `ended`
  meaning. The update guard allows only `tracking -> superseded` and
  `superseded -> rolled_over`; the close transition guard refuses
  `superseded -> ended`, a superseded row with finalization evidence, and any
  active-date move while superseding. The authenticated `UPDATE(lifecycle)`
  grant is revoked, so the definer close/continuation/rollover functions are the
  only writers.
- **Date authority.** The Money period timezone is the single authority for
  Money write dates. A wall time after the current window is still interpreted
  in the existing period timezone (continuation copies that timezone) instead
  of switching to the owner preference timezone; the owner time context is only
  a fallback before any period exists. The server action derives `bookingDate`
  from a supplied instant in that zone and rejects a divergent explicit date.
  Reads keep the owner time context (`timezone`, `localToday`) and the period
  timezone separately and expose `periodTimezone`, so a divergence is visible
  rather than silently merged; the current projection cutoff remains
  owner-local today clamped to the period.

## Explicit non-goals

No automatic reconciliation approval, no automatic close rows, no invented
opening/cash, no deletion of November evidence, no second active period, no new
finance engine, and no production migration/deployment as part of this design.
