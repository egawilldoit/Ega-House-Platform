# Performance Baseline — EGA Command OS Wave 0

Date: 2026-08-25 · Base SHA: dca2dce · Worktree: /home/ubuntu/ui-web
Scope: `apps/web` production build + runtime navigation

## 1. Build Snapshot (dev HMR is NOT performance evidence — per mission)

Run in worktree:

```
npm run web:build
```

**Baseline attempt**: executed 2026-08-25 in worktree (see commit log). Build completed with Next 16.2.12.

- **Note**: Full `npm run web:build` on 2026-08-25 baseline (pre-refactor) succeeds but warns about `unstable_cache` usage on user data (dashboard-data.ts) — recorded as defect.
- Bundle analysis (to be updated after Wave 9 with `next build --analyze` or `bundle-analyzer` if added — not added by default per dependency policy).

**Observed metrics (baseline, no artificial claims)**:
- First build after `git worktree add`: `Compiled successfully` (transpiled 22 routes).
- No bundle size claim recorded without production trace — Wave 9 will record real `web:build` output + Lighthouse/Playwright trace after final validation.

## 2. Navigation & Shell Lifecycle (manual inspection of code — not yet live-traced)

| Transition | Expected per mission | Current behavior (code truth) | Risk |
|------------|----------------------|-------------------------------|------|
| Dashboard → Today | shell stays, content streams, no blank | `AppShell` remounts per page (no `(workspace)/layout`). `TopBar`/`Sidebar` re-render; projects/metrics re-fetched. `Today` Suspense not yet in dashboard path. | Freeze + spinner on nav |
| Today → Tasks | immediate feedback via `<Link>` | `Tasks` page not using `Suspense` boundaries (single page load). 750-line page blocks streaming. | Wait + layout shift |
| Tasks → Project detail (`/tasks/projects/[slug]`) | stable shell, project content swaps | Shell remounts; project detail does extra `tasks` query for that project. | Duplicate fetch |
| Project → Goal → Review | preserved shell, prefetch | Each uses separate `AppShell` instance; no prefetch hint beyond Next `<Link>`. | Unnecessary data waits |
| Command palette `Ctrl K` | instant, no navigation | Portal with 180ms debounce + `searchWorkspaceAction`; focus trap correct; body overflow hidden. | If debounce + server action queue, stale results without abort |
| Back navigation | cached shell | No shell cache; back triggers full RSC fetch | Stale spinner |
| Timer tick (1s) | isolated to smallest client | `ActiveTimerDisplay` is isolated client component — correct. Parent `page.tsx` stays server. | Minimal risk |

**Target after Wave 2/9**: persistent `(workspace)/layout.tsx` or request-memoized shell; per-panel Suspense where validated; `next/font` preload; `Link` for all internal nav; dynamic import for charts.

## 3. Data Fetch Audit (request waterfalls)

**Dashboard page.tsx** (current):
```
await Promise.all([
  getActiveTimer(),           // → getActiveTimerSession()
  getTodayPlanner(),          // → getDashboardTodayPlannerData() (tasks + goals)
  getTimerSummary(),          // → getTimerSummaryData() (sessions)
  getDashboardHealthData(),   // → getOpenClawHealth()
])
// then Suspense panels internally call:
getHeroPanelData() → Promise.all([getDashboardHealthData(), getTodayPlanner(), getProjectStatuses(), getTimerSummaryCached(), getWorkStatsForOwner()])
getCommandCenterPanelData() → Promise.all([getLinearProjectCached(), getActiveTimer(), health, timerSummary])
... etc.
```
- Duplication: `getActiveTimer` called both at page level AND inside `FocusAsync`/`TimerSummaryAsync`/`CommandCenterAsync`.
- `getTodayPlanner` called at page level AND `getHeroPanelData` + `getPlannerPanelData`.
- `getTimerSummaryCached` uses `unstable_cache(["dashboard-timer-summary"], 60s)` shared across users.
- `getWorkspaceShellMetrics` (in `AppShell`, executed on EVERY page) separately counts `blockedTaskCount`/`overdue`/`dueToday` — overlaps dashboard's `todayPlanner` and `workStats`.

**Recommendation**: Replace page-level prefetch duplication with `React.cache()` request-memoized primitives (`cache(() => getActiveTimerSession())`) keyed by `ownerUserId`; coalesce via single `getDashboardData({ownerUserId})` where Suspense not needed, or keep streaming but share memoized fetchers.

**Work-analytics**: `getWorkAnalyticsSessionsForWindow` + `getWorkAnalyticsTaskCounts` per filter change; filters parsed via `parseAnalyticsFilters` — no cache; chart code (`WeekBarChart`, `SessionHeatmap`) imported eagerly.

**Search**: 180ms debounce is good; missing `AbortController` on stale search (old request can overwrite new).

## 4. Bundle & Dependencies

- `next 16.2.12`, `react 19.1.0`, `motion 12.42.2`, `lucide-react ^1.8.0`, `tailwindcss ^4`, `drizzle-orm ^0.45.2`, `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `resend`, `@sentry/nextjs`, `posthog-js`.
- No `bundle-analyzer` installed — do NOT add per dependency policy unless proven need.
- `lucide-react` imports are named (`import { Clock3, Folder } from "lucide-react"`) — tree-shakeable but verify via `next build` output that icons are chunked.
- `motion` used for drawer, card hover; no global `MotionConfig`.
- No `sharp`/`image` heavy usage beyond `logo.svg`.
- **Policy**: Do NOT add GSAP/Three/Vanta; keep `motion`.

## 5. Font Loading (defect)

- `globals.css:1` — `@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans...&family=Sora...')` — blocks rendering, external waterfall, no subset, no preload, no `font-display: swap` control.
- **Fix**: `next/font/google` for `Instrument_Sans` + `Sora` (or `Geist`) with `display: swap`, `subsets: ["latin"]`, self-hosted.

## 6. Hydration & Rerenders

- `AppShell` is server; `Sidebar`/`TopBar` client — hydration boundary correct.
- `OwnerScopedRealtimeRefresh` subscribes to `task_sessions`, `tasks` per page — should be single per shell, not per page.
- `Today` summary bar uses `calculateWorkAnalytics` server-side — safe.
- `Timer`: 1s tick isolated — verified in `ActiveTimerDisplay` (uses `useEffect` + `setInterval` locally).
- Risk: `WorkspaceKeyboardShortcuts` registers global listeners per page (since `AppShell` remounts) — may duplicate if not cleaned correctly; code does cleanup.

## 7. Layout Shift & Skeleton

- Skeletons exist: `HeroSkeleton`, `PlannerSkeleton`, `FocusSkeleton`, etc. — geometry roughly matches but hero skeleton not pixel-matched to final `ega-dashboard-hero` grid.
- Dashboard hero `clamp(3rem,5.5vw,6.7rem)` title causes CLS at 390px.
- `shell-search` min-width 18rem causes overflow CLS at narrow.
- `instrument-table` hover `bg: var(--instrument-raised)` — safe, but table columns not prioritized at narrow.

## 8. Raw Navigation Checks (to be live-validated in Wave 9)

Checklist for `npm run web:build && npm run start` + Playwright/Lighthouse:

- [ ] LCP < 2.5s (dashboard hero + Today summary)
- [ ] INP < 200ms (filter pill, task complete, palette open)
- [ ] CLS < 0.1 (no hero/title shift)
- [ ] Perceived response <100ms (click feedback)
- [ ] 60fps animations (drawer, card hover, board drag)
- [ ] No blank transition Dashboard→Today→Tasks→Project→Goal→Review→Analytics→Help
- [ ] No stale spinner after back navigation
- [ ] No main-thread jank on timer tick
- [ ] Charts lazy-loaded, not blocking LCP

**Do NOT invent scores** — Wave 9 must record actual Lighthouse/Playwright trace numbers.

## 9. Performance Targets (mission)

- LCP < 2.5s
- INP < 200ms
- CLS < 0.1
- Perceived response <100ms
- 60fps animations

These are targets, not claims — to be measured after refactor.

## 10. Concrete Fixes Queued

1. Replace `@import` fonts with `next/font/google` (Wave 1).
2. Introduce `React.cache()` request memoization for `getActiveTimerSession`, `getTodayPlanner`, `getWorkspaceShellMetrics` (Wave 2/3).
3. Remove `unstable_cache` on user data or key by `ownerUserId` (Wave 3).
4. Consider `(workspace)/layout.tsx` to make shell persistent (Wave 2, with proof that URLs/auth/metadata preserved).
5. `dynamic(() => import('@/components/review/week-bar-chart'), { ssr: false })` for analytics charts (Wave 6/9).
6. Add `MotionConfig reducedMotion="user"` (Wave 8).
7. Remove dead TopBar controls to reduce JS (Wave 2).
8. Bundle: verify `lucide-react` tree-shaking via build output; no new deps.

— End baseline. Wave 9 will overwrite with measured post-refactor evidence.
