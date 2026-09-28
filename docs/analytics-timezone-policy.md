# Work Analytics Timezone Policy

## Current Behavior

User-facing Work Analytics day/week/month bucket calculations operate in the
owner's persisted **EGA House timezone** (`user_time_context.iana_timezone`),
falling back to **UTC** when no timezone is stored or the stored value is
invalid.

- Raw timestamps (`started_at`, `ended_at`) remain ISO 8601 UTC instants in the
  `task_sessions` table; changing the account timezone never rewrites them.
- Bucket boundaries (today, rolling 7d/30d, month-to-date, previous calendar
  month, quarter-to-date) are local calendar boundaries in the account timezone,
  converted to UTC query windows via the canonical Time Context helpers
  (`getLocalDayWindow`, `getLocalMonthWindow`, `getLocalQuarterWindow`,
  `getRollingLocalWindow`).
- `calculateWorkAnalyticsDailySeries()` distributes session seconds across
  **local** calendar days using the ONE canonical `splitIntervalByLocalDay`
  primitive (`options.timezone`). A session running from 22:00 to 02:00 local
  time is counted as partial hours in both local days.
- Week/month series bucketing, streaks, active-day counts, drilldown indexes,
  and the month comparison all follow the same account-timezone local calendar.
- The analytics **export** uses the persisted account timezone for its windows
  and reports the exact timezone + window metadata (IANA name and UTC offset at
  the window start) in the markdown.

### Work Activity calendar (EGA-662)

The GitHub-style yearly Work Activity calendar uses the **account's persisted IANA timezone** via the canonical EGA-661 Time Context (`@ega/domain` `getLocalDayWindow` / `getLocalDateInTimezone`, resolved through `SupabaseTimeContextRepository`). It never uses the server process timezone and never invents a second timezone policy.

- Local day boundaries come from `getLocalDayWindow(timezone, date)`.
- Sessions are split across local days with the canonical overlap semantics (`started_at < window.end AND (ended_at IS NULL OR ended_at >= window.start)`), extracted into one shared pure helper (`session-day-aggregation.ts`) used by both the Review heatmap and the Work Activity calendar.
- Open sessions are provisional evidence for the **current local day only**, bounded by the injected query `now`. A stale multi-day open session never paints historical activity.
- Completed-Task evidence comes from the durable `task_status_events` ledger (`to_status = 'done'`), bucketed by `completed_at instant → account timezone → YYYY-MM-DD`. Reopening a Task does not erase the historical completion event.
- The rolling window is 365 local calendar days ending on the owner's current local date (366 when the span contains a leap day). Every date is present, including zero-activity days.

## Rationale

One persisted IANA timezone is the canonical clock context for the
authenticated owner, so analytics agree with Today, Tasks, Timer, reminders,
and reviews across web, mobile, and MCP — including across DST transitions
and server-timezone changes.

## Historical Bucketing Policy

For V1, historical reports/heatmaps are interpreted using the
selected/current EGA report timezone. Changing the account timezone may change
which local calendar date a historical timestamp appears under. EGA House does
not store the timezone-at-event for existing session/task timestamps; immutable
event-local-day history is a separate data-model feature.

## Durable completion evidence (EGA-662)

Task completion evidence for the Work Activity calendar comes from the append-only `task_status_events` ledger, not the mutable `tasks.completed_at`. A database trigger (migration `0063_task_status_events.sql`) owns the `completed_at` invariant for every writer (web, mobile, Today, Hono, MCP):

- transition into `done` → `completed_at` stamped at the mutation instant; one `done` event recorded.
- repeated write of `done` → no new event, `completed_at` unmoved.
- transition out of `done` → `completed_at` cleared; the historical event remains.
- unrelated edits while done → `completed_at` preserved.

The trigger is the single canonical boundary, so all transports converge. The ledger is append-only from the product perspective (owner-only SELECT RLS, no client write policies). `task_id` uses `ON DELETE SET NULL` so events survive a hard-deleted Task.

### Historical coverage limitation

The backfill creates one completion event **only** for pre-existing Tasks with a trustworthy non-null `completed_at`. Completion timestamps are never invented from `updated_at`. Tasks whose past completion evidence was already lost (e.g., reopened before this migration through a path that cleared `completed_at`) cannot be reconstructed honestly and have no historical event. The Work Activity calendar therefore represents only the completion evidence the current model can truthfully prove; it does not fabricate history.

## Desired Future Behavior

User-facing day/week/month buckets should eventually use the **user's local timezone** or an **explicit report timezone** selected in settings or passed as a query parameter. This is tracked as a future enhancement and is not yet implemented.

## Export Behavior

All exports include:

- **Report timezone** — the IANA timezone identifier used for bucket computation
  (the owner's persisted EGA House timezone, or `"UTC"` when unset/invalid).
- **Bucket start/end ISO values** — each row or section boundary includes the
  UTC timestamps for the bucket start and end.
- **Raw session timestamps** — individual session timestamps are always ISO
  strings in UTC.

This ensures that exported data can be re-aggregated into any timezone by
consuming applications.

## Open-Session Handling

Open sessions (those with `ended_at IS NULL`) have a provisional duration calculated from `started_at` to the current time (`nowIso`) at the moment of query. This time is included in bucket calculations when `includeOpenSessions` is `true` (default: `false`). When included, the duration is **provisional** — it will change if the session is still running when queried again. Exports flag open sessions with `[open]` in session metadata.

## Test Expectations

The following test files contain timezone-sensitive test assertions:

| File | What it tests |
|---|---|
| `src/lib/services/work-analytics-service.test.ts` | Midnight boundary session distribution, month-boundary session overlap |
| `src/lib/services/work-analytics-filters.test.ts` | Window computation with fixed UTC `now` dates |
| `src/lib/review-session-heatmap.test.ts` | Shared session-day aggregation (Review heatmap behavior preserved) |
| `src/lib/session-day-aggregation.test.ts` | One shared local-day splitter: DST, open-session clipping, stale open sessions |
| `src/lib/services/work-activity-service.test.ts` | Calendar pure seam: intensity thresholds, streaks, timezone boundaries, leap day |
| `src/lib/services/work-activity-grid.test.ts` | Grid geometry: weekday placement, month labels, year boundary |
| `src/lib/services/work-activity-data-adapter.test.ts` | Bounded queries: owner scoping, overlap semantics, completion window |
| `src/lib/services/work-activity-read-model.test.ts` | Read model: timezone resolution, calendar composition, failure states |
| `packages/data-access/test/task-repository.test.ts` | Trigger-owned `completed_at` invariant (repository seam never writes it) |

When writing new tests:

- Always use **fixed ISO date strings** and a `nowIso` option instead of `new Date()`.
- Always specify the `nowIso` option explicitly so tests are timezone-independent.
- For boundary tests, use `Date.UTC()` or UTC-based constructors to avoid timezone-dependent test failures.
- Never depend on `new Date()` without a fixed mock time.

## Implementation Details

### `calculateWorkAnalyticsDailySeries()`
- Accepts date strings in `YYYY-MM-DD` format (local calendar dates when
  `options.timezone` is supplied, UTC dates otherwise).
- Fills missing days with zero values (not sparse).
- Distributes multi-day sessions proportionally across local day boundaries
  via `splitIntervalByLocalDay` (the single canonical day-splitting primitive).

### `calculateWorkAnalyticsMonthComparison()`
- Computes "current month" as `Date.UTC(year, month, 1)` to now.
- Computes "previous month" as `Date.UTC(year, month-1, 1)` to `Date.UTC(year, month, 1)`.
- Sessions crossing month boundaries are counted in **both** months proportionally.

### Export Route (`/work-analytics/export`)
- Accepts `?month=YYYY-MM` to select a specific month window.
- The export Markdown includes: `Report timezone: UTC` and bucket start/end ISO timestamps.

## Related Files

- `src/lib/services/work-analytics-service.ts` — Core bucket logic (legacy charts)
- `src/lib/services/work-analytics-filters.ts` — Window computation helpers
- `src/lib/session-day-aggregation.ts` — Shared timezone-aware session-day splitter
- `src/lib/services/work-activity-service.ts` — Work Activity calendar pure seam
- `src/lib/services/work-activity-grid.ts` — Grid geometry pure helper
- `src/lib/services/work-activity-data-adapter.ts` — Bounded yearly + day-detail queries
- `src/lib/services/work-activity-read-model.ts` — Read model composition
- `src/app/work-analytics/_components/WorkActivityHeatmap.tsx` — Yearly grid UI
- `src/app/work-activity/day-details/route.ts` — Bounded day detail route
- `src/app/work-analytics/page.tsx` — Server-side UI rendering
- `src/app/work-analytics/export/route.ts` — Export route
- `drizzle/0063_task_status_events.sql` — Durable ledger + trigger migration
- `scripts/db/task-status-events-invariant-verify.mjs` — Disposable-DB invariant proof
- `docs/analytics-timezone-policy.md` — This document
