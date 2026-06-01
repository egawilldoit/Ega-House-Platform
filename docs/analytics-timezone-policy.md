# Work Analytics Timezone Policy

## Current Behavior

All Work Analytics day/week/month bucket calculations operate in **UTC**.

- Raw timestamps (`started_at`, `ended_at`) are stored as ISO 8601 strings in UTC in the `task_sessions` table.
- Bucket boundaries (e.g., "today", "last 7 days", "current month") are computed using `Date.UTC()` or equivalent UTC-based operations.
- The `calculateWorkAnalyticsDailySeries()` function distributes session seconds across UTC calendar days. A session running from 22:00 UTC to 02:00 UTC the next day is counted as partial hours in both UTC days.
- The `calculateWorkAnalyticsMonthComparison()` function computes month boundaries using UTC: `new Date(Date.UTC(year, month, 1))`.

## Rationale

Using UTC for all server-side computations avoids timezone ambiguity in scheduled exports, cron-based reports, and multi-timezone collaboration contexts. It ensures deterministic, reproducible results regardless of where the server runs.

## Known Limitation

Mixed UTC/local behavior can make day-level and month-level totals feel wrong to users in extreme timezones (e.g., UTC+14 or UTC-12). A session that starts at 23:00 local time on Monday appears as Monday's data in UTC but may "feel" like it belongs to Monday locally. This is consistent behavior but can be surprising near midnight.

## Desired Future Behavior

User-facing day/week/month buckets should eventually use the **user's local timezone** or an **explicit report timezone** selected in settings or passed as a query parameter. This is tracked as a future enhancement and is not yet implemented.

## Export Behavior

All exports include:

- **Report timezone** — the IANA timezone identifier used for bucket computation (currently `"UTC"`).
- **Bucket start/end ISO values** — each row or section boundary includes the UTC timestamps for the bucket start and end.
- **Raw session timestamps** — individual session timestamps are always ISO strings in UTC.

This ensures that exported data can be re-aggregated into any timezone by consuming applications.

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
- Accepts date strings in `YYYY-MM-DD` format (UTC).
- Fills missing days with zero values (not sparse).
- Distributes multi-day sessions proportionally across UTC day boundaries.

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
