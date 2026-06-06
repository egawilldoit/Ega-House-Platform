# Work Analytics Command Center Audit Report

Date: 2026-06-01
Repository: `MORTAKI0/Ega-House-Platform`
Scope: Work Analytics Command Center implementation, performance, data shape, URL state, drilldowns, export, and near-term analytics direction.

## Executive Summary

The most likely source of slow switching between Work Analytics states is the combination of URL-driven navigation to a `force-dynamic` server page, repeated in-memory aggregation over the same session array, and shipping the full session payload to client components for drilldowns. The chart component itself is unlikely to be the primary bottleneck for the current 7-day and 30-day views.

SQL may become a bottleneck on production-sized accounts because the queried columns are not covered by window-oriented composite indexes, but this audit could not confirm database runtime with `EXPLAIN ANALYZE`: the local read-only attempt against the configured database failed with `read ECONNRESET`. Index work should therefore be validated with production-like `EXPLAIN (ANALYZE, BUFFERS)` before migration.

There are also correctness and UX issues that make the command center feel slower or less trustworthy: `groupBy` changes the URL but does not affect calculations, the export estimate-accuracy path still relies on task breakdown estimates that are always `null`, and task count semantics do not match their names.

Measured local baseline:

- `npm run typecheck`: pass.
- `npm run lint`: pass with 11 warnings, including 7 Work Analytics warnings.
- `npm test`: pass, 79 files, 584 tests, about 67.5s.
- `npm run build`: pass, 33/33 static pages generated.
- Production unauthenticated request to `/work-analytics`: HTTP 200, about 270ms, 9.2 KiB. This only proves the route responds; it does not measure authenticated analytics switching.
- Synthetic server calculation timing for the page's current calculation sequence:
  - 100 sessions: 6.0ms calculation, 43.3 KiB representative client payload.
  - 1,000 sessions: 60.6ms calculation, 358.6 KiB payload.
  - 5,000 sessions: 282.9ms calculation, 1.55 MiB payload.
  - 10,000 sessions: 496.0ms calculation, 3.03 MiB payload.

Official references used:

- Next.js Server and Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js `useSearchParams`: https://nextjs.org/docs/app/api-reference/functions/use-search-params
- Next.js linking, navigation, loading, and streaming: https://nextjs.org/docs/app/getting-started/linking-and-navigating
- React `useTransition`: https://react.dev/reference/react/useTransition
- React Profiler: https://react.dev/reference/react/Profiler
- PostgreSQL `EXPLAIN`: https://www.postgresql.org/docs/current/sql-explain.html
- PostgreSQL `ANALYZE`: https://www.postgresql.org/docs/current/sql-analyze.html

## Architecture Map

Route and server flow:

- `src/app/work-analytics/page.tsx` is `force-dynamic`.
- The page awaits `searchParams`, parses filters, computes a primary reporting window, fetches sessions, fetches task counts, then runs multiple analytics calculators.
- The page passes summarized data plus `allSessions={sessions}` into the client island at `InteractiveAnalytics`.

Data access:

- `src/lib/services/work-analytics-data-adapter.ts` fetches `task_sessions` with nested `tasks`, `projects`, and `goals`.
- It also fetches `tasks` rows for task counts.
- Queries are owner-scoped and window-scoped, but the schema only has owner-only indexes for `task_sessions` and no obvious composite index for the task count windows.

Aggregation:

- `src/lib/services/work-analytics-service.ts` performs in-memory calculations for core summary, daily series, insights, project breakdown, goal breakdown, task breakdown, month comparison, session quality, and estimate accuracy.
- Many calculators independently iterate over the same session list.

Client:

- `src/app/work-analytics/analytics-filters.tsx` renders Link-based filter pills.
- `src/app/work-analytics/interactive-analytics.tsx` renders charts/breakdowns and filters `allSessions` on drilldown clicks.
- `src/app/work-analytics/analytics-drilldown-context.tsx` owns drawer state.
- `src/app/work-analytics/analytics-drilldown-drawer.tsx` renders every selected session.
- `src/components/review/trend-bar-chart.tsx` renders compact bar charts.

Export:

- `src/app/work-analytics/export/route.ts` recomputes analytics for Markdown export.

## Performance Findings

### P0-1: URL filter changes trigger a full dynamic server navigation

Severity: High

Evidence:

- `src/app/work-analytics/page.tsx` uses `export const dynamic = "force-dynamic"`.
- `src/app/work-analytics/analytics-filters.tsx` builds query-string `href` values and uses links for range, group, breakdown, and open-session filters.
- No `loading.tsx` exists under `src/app/work-analytics`.
- No `useTransition` or pending state is used around filter changes.

Why it matters:

Every filter click changes the URL and asks the App Router to render a dynamic server route again. That is the right architecture for shareable state, but without a route-level loading state or optimistic pending state the UI can feel frozen while the server fetches and recalculates. The `groupBy` filter makes this worse because it currently appears to cause a server navigation without changing the analytics output.

Likely bottleneck category:

- URL transition and server render, not chart drawing.

Recommended fix:

- Keep URL-backed state, but wrap controls with a small client component using `useRouter`, `usePathname`, `useSearchParams`, and `useTransition`.
- Show pending state on the selected control and disable repeat clicks during transition.
- Add `src/app/work-analytics/loading.tsx` or Suspense boundaries around the analytics body.
- Preserve plain link semantics where possible for accessibility and copyable URLs.

Test:

- Add a narrow component test or Playwright check for pending state on filter click.
- Add a manual profile with React DevTools and browser Performance panel before and after.

Risk:

- Low to medium. The URL contract must remain unchanged.

### P0-2: Server calculations repeatedly scan the same sessions

Severity: High

Evidence:

- `src/app/work-analytics/page.tsx` calls multiple calculators sequentially after fetching the same session array.
- `calculateWorkAnalyticsCoreSummary` calls lower-level analytics multiple times.
- `calculateWorkAnalyticsMonthComparison` computes two analytics windows plus daily series.
- Daily series, insights, project breakdown, goal breakdown, task breakdown, estimate accuracy, and quality all scan sessions or extracted duration windows.
- Synthetic timing for the current page calculation shape grows from about 60.6ms at 1,000 sessions to about 496.0ms at 10,000 sessions.

Why it matters:

The route does much more CPU work than the visible page suggests. For accounts with several thousand sessions, server CPU alone can take hundreds of milliseconds before network and database time are counted. The current design also makes future analytics more expensive because every new panel tends to add another pass.

Likely bottleneck category:

- Server render and analytics data shape.

Recommended fix:

- Create a single server-side report builder, for example `buildWorkAnalyticsReport`, that normalizes sessions once and accumulates all metrics in one or two passes.
- Emit compact DTOs for cards, series, breakdowns, drilldown indexes, quality, and export.
- Keep focused unit tests around each derived metric, but test the report builder as the page-facing contract.

Test:

- Add a benchmark-style unit test or script with synthetic 1,000/5,000/10,000-session fixtures and a budget.
- Keep existing edge-case tests for zero-duration, open sessions, timezone boundaries, and estimates.

Risk:

- Medium. This touches shared analytics logic and needs snapshot-like regression coverage.

### P1-1: Full session rows are shipped to the client for drilldowns

Severity: High

Evidence:

- `src/app/work-analytics/page.tsx` passes `allSessions={sessions}` to `InteractiveAnalytics`.
- The representative payload estimate for current data shape grows to about 1.55 MiB at 5,000 sessions and about 3.03 MiB at 10,000 sessions.
- `InteractiveAnalytics` filters `allSessions` in click handlers for chart bars and breakdown rows.
- `analytics-drilldown-drawer.tsx` renders every selected session.

Why it matters:

The client receives nested task/project/goal data even though the first screen only needs summaries and small breakdown lists. Large payloads slow navigation, hydration, memory usage, and drilldown interactions. Rendering every session in a large bucket can also cause a visible stall.

Likely bottleneck category:

- Data shape, hydration, and drilldown client render.

Recommended fix:

- Replace `allSessions` with a compact drilldown index keyed by `date`, `projectId`, `goalId`, and `taskId`, or fetch drilldown details on demand from a route handler.
- Cap initial drawer rows and add "show more" pagination for large buckets.
- If keeping local drilldowns, strip each session to the exact fields the drawer needs.

Test:

- Add a payload-size assertion for representative fixture output.
- Add a drawer test for buckets larger than the display cap.

Risk:

- Medium. Drilldown behavior is user-facing and needs careful acceptance criteria.

### P1-2: Data fetches are sequential where they can be parallel

Severity: Medium

Evidence:

- `src/app/work-analytics/page.tsx` fetches sessions first and task counts second.
- The task-count query depends on the same user/window, not on session query output.

Why it matters:

Even if each query is reasonable alone, sequential fetches add latency directly to every dynamic route transition.

Recommended fix:

- Fetch sessions and task counts with `Promise.all`.
- Keep error handling behavior equivalent.

Test:

- Existing page tests should continue to pass.
- Add a service-level test only if error handling changes.

Risk:

- Low.

### P2-1: Context value and callbacks cause unnecessary client rerenders

Severity: Medium

Evidence:

- `analytics-drilldown-context.tsx` recreates the context `value` object on every provider render.
- `allSessions` is accepted by the provider but unused.
- `InteractiveAnalytics` callbacks depend on `allSessions`, and the component passes several inline objects/functions through chart and breakdown components.
- Lint warns about unused Work Analytics symbols.

Why it matters:

This is not likely the primary slowness, but it adds avoidable client churn once the payload grows.

Recommended fix:

- Remove unused props/imports.
- Memoize context value with `useMemo`.
- Memoize derived drilldown indexes, not raw session filters.
- Consider `React.memo` for stable breakdown/chart sections only after measuring with the React Profiler.

Test:

- Lint should drop the Work Analytics warnings.
- Use React Profiler to confirm fewer rerenders after interaction.

Risk:

- Low.

## SQL Findings

### S1: Session window query lacks window-oriented indexes

Severity: Medium pending `EXPLAIN`

Evidence:

- `work-analytics-data-adapter.ts` queries `task_sessions` by `owner_user_id`, `started_at < end`, and `ended_at is null OR ended_at >= start`, ordered by `started_at desc`.
- `src/db/schema.ts` defines `task_sessions_owner_user_id_idx`, but no composite index on `(owner_user_id, started_at)` and no evident index supporting `ended_at` overlap checks.

Why it matters:

Owner-only indexes can still leave the database scanning many rows for active users. The overlap predicate and sort by `started_at desc` are common places for composite indexes to help.

Recommended validation:

- Run `EXPLAIN (ANALYZE, BUFFERS)` for real high-volume users and the 7d/30d/90d/custom windows.
- Check row counts, sort method, shared buffer hits/reads, and whether the owner-only index filters too many rows.

Potential migration, if validated:

- `task_sessions(owner_user_id, started_at desc)`.
- Consider `task_sessions(owner_user_id, ended_at)` or a partial index for open sessions only if `EXPLAIN` supports it.
- Consider `task_sessions(task_id)` if joins or task-specific drilldown queries are introduced.

Risk:

- Medium. Indexes improve reads but add write cost and migration time.

### S2: Task count query has weak semantics and likely weak indexes

Severity: Medium

Evidence:

- `getWorkAnalyticsTaskCounts` selects tasks where `created_at < end` and `(completed_at is null OR completed_at >= start)`.
- The returned rows are then counted in memory as `createdCount`, `completedCount`, and `blockedCount`.
- `src/db/schema.ts` has owner indexes but no clear composite indexes on `(owner_user_id, created_at)` or `(owner_user_id, completed_at)`.

Why it matters:

The query returns old unfinished tasks and then labels the result as created tasks. It can overstate "created" volume and read more rows than needed. It also makes blocked/completed metrics depend on broad row selection instead of explicit metric windows.

Recommended fix:

- Define exact semantics:
  - created in window: `created_at >= start AND created_at < end`
  - completed in window: `completed_at >= start AND completed_at < end`
  - blocked current backlog or blocked in window: choose one explicitly
- Query aggregates directly from the database or fetch only the minimal columns needed.
- Add indexes only after checking query plans.

Test:

- Add unit tests around old open tasks, old completed tasks, current blocked tasks, and tasks created/completed across boundaries.

Risk:

- Medium because metric values may change. This should be called out in release notes if user-visible.

### S3: `EXPLAIN ANALYZE` was not completed

Severity: Medium audit limitation

Evidence:

- Read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` attempts using the configured `DATABASE_URL` failed with `read ECONNRESET`.
- No credentials were printed.

Impact:

This audit can identify index risk from query and schema shape, but cannot prove database runtime as the current bottleneck.

Recommended next step:

- Run the same plans from an environment with database network access, preferably with one small account and one high-volume account.

## Client Render Findings

### C1: Chart rendering is probably not the main bottleneck

Severity: Low

Evidence:

- `TrendBarChart` renders 7 or 30 bars for current page usage.
- It performs a couple of small reductions over the series.
- Large synthetic slowness appears before client render because server calculation and payload size grow with session count.

Recommended fix:

- Do not spend the first optimization cycle rewriting the chart.
- Profile before memoizing or replacing it.

### C2: Drilldown rendering can become expensive for large buckets

Severity: Medium

Evidence:

- Drawer maps every selected session.
- Day, project, goal, and task drilldowns can select many sessions.
- Description reduces selected sessions on every drawer render and uses `Date.now()` for open sessions.

Recommended fix:

- Limit the initial visible session list.
- Add pagination or "show more".
- Precompute drawer totals on open, or pass totals with the drilldown payload.

### C3: Work Analytics lint warnings point to cleanup debt

Severity: Low

Evidence:

- `analytics-drilldown-context.tsx`: unused `allSessions`.
- `analytics-filters.tsx`: `URLSearchParams` dependency recreated every render.
- `interactive-analytics.tsx`: unused `projectName`, `goalTitle`, `DrilldownConfig`.
- `page.tsx`: unused `_`.
- `trend-bar-chart.tsx`: unused import.

Recommended fix:

- Remove dead symbols and memoize `URLSearchParams` where needed.
- Treat this as part of the first cleanup PR, not a standalone performance project.

## UX Findings

### U1: `groupBy` is a slow no-op

Severity: High

Evidence:

- `work-analytics-filters.ts` parses `groupBy`.
- `analytics-filters.tsx` renders group controls.
- `page.tsx` does not use `filters.groupBy` in analytics calculations; only `breakdownBy` is used to switch project/goal/task breakdown output.

Why it matters:

Clicking `day`, `week`, or `month` can trigger a dynamic route transition while the displayed chart remains day-based. That creates user-visible latency with no payoff and makes the command center feel broken.

Recommended fix:

- Either implement grouped series for `week` and `month`, or remove/disable the control until it is real.
- Add an assertion that selected `groupBy` changes the chart buckets.

### U2: No visible pending state for filter transitions

Severity: Medium

Evidence:

- Filters are rendered as links with no route-level loading UI under `src/app/work-analytics`.

Recommended fix:

- Add pending state to filter controls.
- Add route loading UI that preserves the dashboard structure.

### U3: Drilldown links should be route-verified

Severity: Low

Evidence:

- Drawer links point to `/tasks/${taskId}`, `/tasks/projects/${projectId}`, and `/tasks/goals/${goalId}`.

Recommended fix:

- Verify those routes exist and are the intended destinations.
- Add a simple link contract test if routes are dynamic.

## Correctness Findings

### D1: Export estimate accuracy likely disagrees with page estimate accuracy

Severity: High

Evidence:

- `calculateEstimateAccuracy` reads `session.tasks?.estimate_minutes`.
- `calculateWorkAnalyticsTaskBreakdown` still initializes task breakdown `estimateMinutes: null` with the comment `estimates aren't in session data`.
- `export/route.ts` builds estimate accuracy from task breakdown and includes a stale comment saying session rows do not provide estimates.
- Tests still assert null estimate minutes in task breakdown fixtures.

Why it matters:

The page can compute estimate accuracy, while export may report missing estimates for the same data. That undermines the monthly report.

Recommended fix:

- Feed task estimates into `calculateWorkAnalyticsTaskBreakdown`.
- Reuse the same estimate-accuracy calculation for page and export, or have export call `calculateEstimateAccuracy` directly.
- Update tests that currently encode stale null-estimate behavior.

Risk:

- Medium. Export snapshots and analytics numbers will change.

### D2: Task count names do not match task count filters

Severity: Medium

Evidence:

- `createdCount` is calculated from rows selected by broad active/completed overlap, not `created_at` inside the window.
- `completedCount` depends on status after broad filtering, not an explicit completed window.

Recommended fix:

- Rename metrics or fix query semantics.
- Prefer fixing semantics before adding more analytics that depend on these counts.

### D3: Problem signals from PR history are not obvious in current source

Severity: Medium

Evidence:

- PR #53 was titled as adding ranked breakdowns, URL filters, and problem signals.
- Narrow source search did not find obvious `problemSignal` rendering in current Work Analytics code.

Recommended fix:

- Confirm whether problem signals were intentionally removed, renamed, or regressed.
- If still required, restore as explicit computed DTOs with tests.

## Analytics Improvements

The current command center is a good foundation, but the next layer should answer operational questions rather than adding more panels that scan the same sessions.

Recommended analytics additions:

- Focus reliability:
  - planned sessions vs completed sessions
  - open sessions older than threshold
  - interruption count if app tracking is later approved
- Estimation quality:
  - over/under estimate distribution
  - median percent error, not only averages
  - tasks with repeated large misses
- Project and goal health:
  - rolling 7-day vs previous 7-day trend
  - stale goals with no tracked work
  - concentration risk where one project dominates all tracked time
- Flow:
  - created/completed/blocked deltas with corrected task-count semantics
  - blocked time or blocked task age if timestamps exist
- Export:
  - include timezone metadata from `docs/analytics-timezone-policy.md`
  - include filter window, generation timestamp, and data completeness notes

Data model improvements to consider later:

- Materialized daily rollups per owner/project/goal/task if high-volume accounts make live scans expensive.
- Explicit task event history for created/completed/blocked transitions if analytics need historical accuracy.
- Optional manual work-source tagging, aligned with `docs/app-tracking-privacy-spike.md`.

## Recommended Fix Plan

### Issue 1: Make filter transitions visibly responsive

Scope:

- Add Work Analytics loading UI.
- Convert filter controls to transition-aware client controls while preserving URL state.
- Fix the `URLSearchParams` lint warning.

Acceptance criteria:

- Clicking range/breakdown/include-open shows a pending state immediately.
- URL state remains shareable.
- Lint no longer reports `analytics-filters.tsx` dependency warning.

Risk:

- Low.

### Issue 2: Remove or implement `groupBy`

Scope:

- Implement daily/weekly/monthly bucket generation, or remove the control.
- Update tests to prove group buckets change output.

Acceptance criteria:

- Selecting `week` or `month` changes chart labels and bucket totals, or the control is gone.
- No dynamic no-op navigation remains for `groupBy`.

Risk:

- Low if removed; medium if implemented.

### Issue 3: Build a compact analytics report DTO

Scope:

- Add a server-side report builder that scans normalized sessions once.
- Return compact DTOs to the page.
- Keep compatibility with current cards, charts, breakdowns, drilldowns, and export.

Acceptance criteria:

- Synthetic 5,000-session calculation time is materially lower than the current about 283ms baseline.
- The client payload no longer scales with full nested session rows on initial load.
- Existing analytics tests still pass with added report-builder coverage.

Risk:

- Medium.

### Issue 4: Fix task count semantics

Scope:

- Define and implement window semantics for created, completed, and blocked counts.
- Add boundary tests.

Acceptance criteria:

- Old open tasks do not count as newly created.
- Tasks completed outside the window do not count as completed in the window.
- Blocked metric name matches its semantics.

Risk:

- Medium because user-visible numbers may change.

### Issue 5: Fix export estimate accuracy

Scope:

- Populate task breakdown estimates or reuse `calculateEstimateAccuracy` in export.
- Remove stale comments.
- Update export tests.

Acceptance criteria:

- Page and export agree on estimate totals for the same fixture.
- Tasks with estimates appear as estimated in export.

Risk:

- Medium.

### Issue 6: Validate and add database indexes only if plans justify them

Scope:

- Run `EXPLAIN (ANALYZE, BUFFERS)` for session and task-count queries.
- Add migrations for proven high-value indexes.

Acceptance criteria:

- Query plans are attached to the PR or issue.
- Index migration includes before/after plan comparison.

Risk:

- Medium due to write overhead and migration impact.

## Do Not Do

- Do not rewrite the chart library first. Current charts are small and unlikely to be the primary bottleneck.
- Do not add indexes blindly without `EXPLAIN ANALYZE` from a reachable production-like database.
- Do not add more analytics panels until repeated session scans and payload shape are addressed.
- Do not move all analytics to the client. That would increase payload and hydration cost.
- Do not remove URL-backed filters. Shareable URLs are useful; the problem is the missing pending/loading experience and server work behind each transition.
- Do not commit or rely on dirty `graphify-out` files for this audit.

## Short Terminal Summary

Top 5 findings:

1. Filter changes navigate a `force-dynamic` server route with no visible pending/loading state.
2. Server analytics repeatedly scan the same sessions; synthetic 10,000-session calculation cost was about 496ms before database/network time.
3. The client receives full nested session rows for drilldowns; representative payload reached about 3.03 MiB at 10,000 sessions.
4. `groupBy` is currently a URL-changing no-op.
5. Export estimate accuracy likely disagrees with page estimate accuracy because task breakdown estimates are still forced to `null`.

Likely bottleneck:

- Server render plus data-shape/payload cost during URL transitions. SQL remains a plausible contributor but was not proven because `EXPLAIN ANALYZE` could not be completed.

Recommended first fix:

- Add transition/loading UX and fix/remove the `groupBy` no-op, then consolidate analytics into a compact server report DTO.

DB migration/index needed:

- Maybe, but not yet approved by evidence. Run `EXPLAIN (ANALYZE, BUFFERS)` first; likely candidates are composite indexes on session owner/window columns and task created/completed windows.

Report path:

- `WORK_ANALYTICS_AUDIT_REPORT.md`
