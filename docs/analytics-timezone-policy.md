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

- `src/lib/services/work-analytics-service.ts` — Core bucket logic
- `src/lib/services/work-analytics-filters.ts` — Window computation helpers
- `src/app/work-analytics/page.tsx` — Server-side UI rendering
- `src/app/work-analytics/export/route.ts` — Export route
- `docs/analytics-timezone-policy.md` — This document
