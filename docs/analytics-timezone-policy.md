# Work Analytics Timezone Policy

## Current Behavior

User-facing Work Analytics and Work Activity calendar calculations operate in
the owner's persisted **EGA House timezone** (`user_time_context.iana_timezone`),
falling back to **UTC** only when Time Context is unavailable or invalid.

- Raw timestamps (`started_at`, `ended_at`, completion-event `occurred_at`) remain UTC instants.
- Changing the account timezone never rewrites those stored instants.
- Today, rolling windows, calendar months, quarters, streaks, drilldowns, and
  activity-day buckets use local calendar boundaries derived from canonical EGA Time Context.
- Analytics exports report the exact IANA timezone and UTC evidence windows used.
- Historical timestamps are reinterpreted into the selected/current report timezone;
  EGA House does not claim to persist timezone-at-event for legacy timestamps.

## Canonical local-day splitting

EGA-661 owns timezone/day-boundary semantics in `@ega/domain/time-context`,
including `splitIntervalByLocalDay()`.

EGA-662's shared `session-day-aggregation.ts` reuses that canonical splitter
and adds only session-evidence policy:

- clip evidence to the requested bounded window;
- split closed sessions across the local days they overlap;
- treat an open session as provisional evidence for the **current local day only**;
- prevent a stale multi-day open session from painting historical activity;
- return every requested local date, including zero-activity dates.

The Review session heatmap and yearly Work Activity calendar both consume this
shared session aggregation; there is no second yearly timezone algorithm.

## Durable Task completion evidence (EGA-662)

The yearly Work Activity calendar uses append-only `task_status_events` for
historical Task-completion evidence rather than mutable `tasks.completed_at`.

Migration `0063_task_status_events.sql` installs the transition invariant:

- non-done → done: stamp current `completed_at` and append one completion event;
- done → done: do not append a duplicate event and do not move completion time;
- done → non-done: clear current-state `completed_at` but keep historical events;
- unrelated edits while done: preserve current completion time.

The ledger is owner-readable and product-append-only; ordinary clients do not
receive update/delete policies for historical events. Task deletion uses the
migration's declared foreign-key behavior so historical evidence follows the
schema invariant.

### Historical coverage limitation

Backfill creates historical completion evidence only where a trustworthy
pre-existing non-null `completed_at` exists. It never fabricates completion
timestamps from `updated_at`. Previously lost history cannot be reconstructed
honestly and is intentionally absent.

## Work Activity yearly window

The Work Activity calendar is a rolling local-calendar window ending on the
owner's current local date. Every local date is represented, including zero
activity. Calendar intensity is deterministic and stable; it does not rescale
relative to whichever day happens to be the maximum in the current window.

Day detail is fetched on demand for one bounded local-day window rather than
shipping all nested yearly session/task rows to the browser.

## Export Behavior

All exports include:

- report timezone (IANA identifier);
- UTC bucket/evidence boundaries;
- raw UTC session timestamps.

This preserves reproducibility while keeping local-calendar presentation correct.

## Test Expectations

Timezone-sensitive coverage includes:

| File | What it proves |
|---|---|
| `src/lib/services/work-analytics-service.test.ts` | Local day/month analytics and session distribution |
| `src/lib/services/work-analytics-filters.test.ts` | Timezone-aware report windows |
| `src/lib/review-session-heatmap.test.ts` | Review heatmap behavior after shared aggregation |
| `src/lib/session-day-aggregation.test.ts` | Shared DST/local-day/open-session policy |
| `src/lib/services/work-activity-service.test.ts` | Activity intensity, streaks, timezone boundaries, leap-day cases |
| `src/lib/services/work-activity-grid.test.ts` | Week geometry and month labels |
| `src/lib/services/work-activity-data-adapter.test.ts` | Bounded owner-scoped evidence queries |
| `src/lib/services/work-activity-read-model.test.ts` | Time Context + calendar composition/degraded states |
| `packages/data-access/test/task-repository.test.ts` | Trigger-owned completion invariant |

Tests must use fixed clocks/ISO instants for boundary behavior and must not rely
on the process timezone.

## Related Files

- `packages/domain/src/time-context.ts` — canonical Time Context/day splitter
- `apps/web/src/lib/services/work-analytics-service.ts` — Work Analytics calculations
- `apps/web/src/lib/services/work-analytics-filters.ts` — report windows
- `apps/web/src/lib/session-day-aggregation.ts` — shared session-evidence aggregation
- `apps/web/src/lib/services/work-activity-service.ts` — yearly activity pure model
- `apps/web/src/lib/services/work-activity-grid.ts` — calendar geometry
- `apps/web/src/lib/services/work-activity-data-adapter.ts` — bounded evidence reads
- `apps/web/src/lib/services/work-activity-read-model.ts` — server read-model composition
- `apps/web/src/app/work-analytics/_components/WorkActivityHeatmap.tsx` — yearly UI
- `apps/web/src/app/work-activity/day-details/route.ts` — bounded day-detail route
- `drizzle/0063_task_status_events.sql` — durable completion ledger/trigger
- `scripts/db/task-status-events-invariant-verify.mjs` — invariant proof
