EGA House — POST-DUBLIN E2E PERFORMANCE, NAVIGATION & UX IMPLEMENTATION RUNBOOK
Edition: 2026-10-30 · Document type: Executable master coding-agent prompt + exact-current-code findings + proposed patch blueprint + end-to-end acceptance plan.
Basis: Uploaded 519-line remediation runbook plus post-merge GitHub/Vercel readback and official Next.js, Vercel, Supabase and Playwright docs.
Repository: egawilldoit/Ega-House-Platform · baseline main (verified): 637cb9aad9a10c604aa1f2612c8ff04b25a79678.
Production: egawilldoit.online · ega-house-platform · Vercel deployment dpl_4Uf3haianqDpzSW2WiW1femc8bwb · READY · dub1.
Stack (verified): Next.js 16.4.3, React 19.1.0, Tailwind 4, Supabase SSR, Vercel Hobby, Playwright/Vitest.
Important: The example patches below are design blueprints derived from verified source, not already-applied diffs or verified-compiling commits. Only the region diff is actually merged. The executing agent MUST derive an exact patch against its checked-out HEAD and prove it compiles and passes tests.
A. What changed since the uploaded runbook
Original assumption	Verified updated state	Action
First move Vercel from iad1 to dub1	DONE via PR #338, merge 637cb9aa	Do not redo region work
Check whether production is READY	DONE: dpl_4Uf3haianqDpzSW2WiW1femc8bwb READY, aliases include apex and workspace subdomains	Run authenticated functional smoke only; cannot infer user UX success from READY
Have baseline before region move	No matched baseline captured	Begin a post-region baseline; note historical comparison unavailable
PR #337 may improve CPU	As of this audit still OPEN, head 125b7c2; no verified 50% saving	Coordinate changes; no blind merge or overlapping realtime edits
Shell App Router placement	Confirmed AppShell is async and currently invoked in pages; WorkspaceShell owns collapsed state; route loading.tsx recreates full chrome	Shared route layout with one client frame, page-owned headers, content-only fallbacks
Authentication may be repeatedly verified	getCurrentUser() already wraps supabase.auth.getUser() in request-scoped React.cache	Preserve; profile bypasses with injected clients before any change
Root layout performance	Root app/layout.tsx already uses local fonts, theme initialization, owner preference server read and global providers	Keep theme, fonts and provider order; investigate blocking preferences read separately
Observability	instrumentation-client.ts already initializes optional Sentry/PostHog	Reuse existing telemetry; no new paid monitoring


B. MASTER CODING-AGENT PROMPT — executable from one thread
Goal / outcome
Make authenticated EGA House navigation responsive from Morocco, now that Vercel web Functions are colocated with Supabase in Dublin. Persist navigation chrome across route changes, remove full-shell skeleton flashes, optimize measured data and render bottlenecks, fix cross-subdomain hard reloads safely, and stabilize mobile/PWA, keyboard and visual UX. All existing operations, permissions and data semantics must continue to work.  

Starting point
Repo egawilldoit/Ega-House-Platform, authoritative branch origin/main, known starting merge 637cb9aa (fetch latest HEAD before acting). Current web production region dub1, already live. Existing PR #337 is open and potentially overlaps shell/realtime files. Web uses Next.js 16.4.3, React 19.1.0, Supabase, Tailwind 4 and Vercel Hobby. Read this entire runbook before editing, especially the source map, patch blueprints, and release gates.  

Non-negotiables  
1. Never modify or merge PR #337 simply to unblock this plan. Inspect its current diff/status first. Avoid clashes or coordinate a rebase; never reimplement its verified refresh fixes.
2. No vercel.json region edits, no Vercel paid services, no DB relocation, no production migration, no apps/server/, apps/mobile/, MCP/API/security contract refactor except a narrowly proven and separately approved dependency.
3. One independently reviewable PR per outcome (see work sequence). Use a fresh worktree from current origin/main for each PR; the existing developer branch is dirty and PR #337 is ongoing. Keep main protected. Never auto-merge, promote, deploy, or bypass checks.
4. Preserve security: proxy.ts session cookie refresh, Supabase getClaims/verified-user authorization, RLS, owner scoping, route/Server Action checks, PWA and cross-origin auth. No cross-user caches.
5. Measure before editing: post-Dublin cold/warm authenticated navigation, RSC/TTFB, server fetch critical path, browser long tasks, and separately Vercel Active CPU. State unavailable evidence explicitly. No fabricated ≥50% claim.
6. Before each PR: read relevant production code, tests, current PRs and existing docs; form a concrete dependency graph; write regression tests. Minimize change: do not blanket-move every page before proving a safe pattern.
7. Preserve current shell providers (ToastProvider, WorkspaceKeyboardShortcuts, GlobalQuickActionControllers), theme/reduced-motion/provider order, sidebar state, task drawer, notifications, active timer, URLs, filters, focus, OAuth and error states.
8. No extra frameworks, state managers, analytics vendors, premium services, query rewrites, or indexes without demonstrated need.
9. Submit an evidence-rich PR with changed files, annotated diff, exact test results, baseline and candidate timings, security implications and rollback. Wait for human approval before merge.
10. Continue one PR at a time through the authorized work sequence. If a blocker requires secret credentials, production DB access, a schema migration, paid tier, deploy or merge, stop that step and provide a precise approval request. Do not pretend the step passed. Do not schedule autonomous work without specific authorization.
Acceptance for entire program  
- On same origin, Home → Today → Tasks → Goals → Timer → Review does not unmount navigation shell or reload document; nav remains clickable while content suspends.
- Sidebar collapse and keyboard shortcuts persist; topbar/theme and quick actions work; Home primary action visible before secondary analytics where feasible.
- Correct URL-driven state, timer/session, RLS/auth, notifications/favorites, task edits and mobile drawer behavior.
- Same-domain navigation has no full-shell skeleton flash; PWA/reduced motion/keyboard/390px layouts pass.
- Per-route p50/p75 latency, network waits, query counts and browser long tasks are compared under matched conditions; Active CPU tracked separately and never promised without evidence.
- Required CI green; all material reviewer feedback addressed; PR is reviewable and not merged automatically.
First checkpoint (do this before implementation)
Read main, #337, existing auth/motion/Shell Persistence docs, classify protected routes, confirm a usable test fixture, capture post-Dublin baseline, and deliver a 1-page bottleneck table. Then open the first narrowly scoped PR (instrumentation/baseline if needed). Do not jump straight to a global route move.

B1. Agent's execution loop
FOR each stage in order:
  1. git fetch origin; identify current main SHA; inspect open overlapping PRs.
  2. git worktree add -b perf/<single-outcome> ../ega-house-<single-outcome> origin/main
  3. Read exact files/tests and inspect dependency dataflow; record first checkpoint.
  4. Add a failing behavior/performance regression test if deterministic.
  5. Implement minimum patch only for that stage.
  6. Run focused tests, web typecheck/lint/build, required security/CI and a real browser smoke.
  7. Capture matching before/after measurement AND status of unavailable evidence.
  8. git diff --check; review staged diff and verify scope excludes server/mobile and secrets.
  9. Commit, push, open one PR with evidence; DO NOT AUTO-MERGE.
  10. Report completed/blocked, actual SHA, PR URL, CI, remaining risks and next stage.
END
PR-stage IDs R0–R9 in this master prompt are authoritative; the attached original runbook preserved below uses older P0–P9 numbering as supporting background.

Recommended independent outcomes: R0 post-Dublin verification/baseline → R1 persistent shell pilot on Home/Today/Tasks → R2 widen protected routes + stabilize owner-scoped shell freshness → R3 Home critical-path streaming → R4 sidebar metrics/counts only when measured → R5 page hotspot PRs (Tasks, Today, Goals/Review/Analytics, Timer separately) → R6 canonical host navigation → R7 targeted UI/a11y polish → R8 database-only if proven and approved → R9 final production-like E2E comparison.

Scope discipline: The agent does not have permission to change all 2,500+ repo files. "Fix all places" means inventory and repair all verified instances of each confirmed defect, with tests—not guessing that all files are broken.
C. Verified live production and baseline
- Confirmed Vercel web project: prj_YQBQhWZMVSXfPujnmjq4ENkBZ4Ra.
- Current deployment (as verified after merge): dpl_4Uf3haianqDpzSW2WiW1femc8bwb · READY · regions: ["dub1"] · main@637cb9aa.
- Domains: egawilldoit.online, www.egawilldoit.online, goals., tasks., timer., and review.egawilldoit.online.
- Supabase DB: eu-west-1 (dashboard evidence). No DB SQL plan has been obtained and no measured network latency difference is established.
- Current root vercel.json has "regions": ["dub1"]. Treat it as invariant.
C1. Required immediate E2E smoke after Dublin (not previously proven)
Use an authorized test account in a production-like environment or a user-supervised production smoke (read-only first):
1. https://egawilldoit.online/login → login → /home → hard reload → account/identity correct.
2. Navigate /home → /today → /tasks → /tasks/projects → /goals → /timer → /review → /work-analytics → back.
3. Verify one task detail/drawer, active timer read, favorites/notifications (avoid writing real production data without approval).
4. Test direct deep links on root and tasks subdomain, then logout; verify protected route denied, no redirect/cookie loop.
5. Test desktop and 390px mobile viewport, dark/light/reduced-motion, errors and slow network.
6. Save redacted trace/baseline, deployment ID, browser/device, sample size and known missing metrics. Never commit HAR containing cookies or personal tasks.
Status as of document authoring: Vercel READY and region confirmed; authenticated smoke NOT independently performed, and no matched pre-Dublin latency baseline exists.
Part II — Updated detailed remediation specification (adapted from supplied runbook)
Status: Post-Dublin implementation specification. Deployment region task COMPLETED; all remaining code changes are PROPOSED, not applied.
Snapshot: 2026-10-30; verified production main at 637cb9aad9a10c604aa1f2612c8ff04b25a79678 after PR #338. Re-check current HEAD before any new work.
Runtime: Next.js 16.4.3, React 19.1.0, Vercel Hobby, Supabase/Postgres.
Objective: Make switching between EGA House screens predictably responsive while cutting avoidable server queries, browser work, and Vercel CPU consumption without changing application semantics or weakening security.
Execution model: small, independent PRs; measure first; no automatic merge or production deployment; existing service/data-access boundaries preserved.

0. Decision summary
Do first NOW: record an authenticated post-Dublin route-navigation baseline. The iad1 → dub1 move is already merged and READY in production. Do not repeat it. No rigorously matched pre-migration navigation trace was recorded; do not invent a before/after region speedup.

Do second: move the authenticated application shell into a shared App Router route-group layout and make loading placeholders page-scoped. This addresses an independently confirmed UX flaw: complete sidebar/top-bar skeleton replacement and request-scoped shell fetching on route transitions. Do not create an oversized, blocking server layout; shell data freshness and authorization require explicit design.

Do third: optimize the Home and workspace query paths using measured request waterfalls; reduce repeated expensive aggregates; audit duplicate auth.getUser() and router.refresh() call sites. Then address cross-subdomain hard reloads and targeted UI responsiveness issues. Existing PR #337 covers part of the realtime/sidebar work: do not duplicate it.

A single 50% reduction target for Vercel Fluid Active CPU is not a navigation latency target. Measure CPU, function duration, I/O wait, TTFB/RSC latency and browser interaction time separately. Region alignment may improve waiting time dramatically without cutting Active CPU by the same percentage.
Known vs unproven
Item	Status	Evidence / consequence
Web production Functions in dub1 (Ireland)	Confirmed (COMPLETE)	Live deployment dpl_4Uf3haianqDpzSW2WiW1femc8bwb READY; regions: ["dub1"]
Supabase production in Ireland eu-west-1	Confirmed from user dashboard	Region displayed as West EU (Ireland); database compute Nano
Web regions override in root vercel.json	Confirmed (COMPLETE)	PR #338 added "regions": ["dub1"]; deployment gating preserved
AppShell instantiated in each authenticated route	Confirmed	apps/web/src/components/layout/app-shell.tsx and many app/*/page.tsx files
Shell query cache survives navigation	False	React.cache is request-scoped; repository itself documents this
Sidebar + top-bar replaced by skeleton	Confirmed from screenshot and source	Route loading.tsx files render WorkspaceSkeletonShell
Home dashboard runs ten reads in a parallel batch	Confirmed	getHomeDashboardData; extra page + shell reads also exist
Extra Auth and Realtime work may cost navigation time	Confirmed mechanisms, not measured contributions	proxy.ts, auth-service, OwnerScopedRealtimeRefresh
DB CPU, slow indexes, network p95, actual browser slowdown in ms	Not measured	Cannot establish from screenshots; require authenticated traces and database access
New UI motion is the principal cause	Unproven	PR #336 added animation; isolate in comparisons instead of removing wholesale
PR #337 delivers 50% CPU reduction	Not supported	PR is open and says no comparable baseline / percentage claim


1. Architecture and affected paths
Browser, Morocco
    |
    | Navigation / RSC prefetch / cookies
    v
Vercel CDN + routing proxy (global/edge placement independent of Function region)
    |
    | Auth proxy runs for selected protected routes; getClaims()
    v
Vercel Web Functions, NOW dub1 (Ireland)
    |
    +--> root layout preferences + providers
    +--> each page's AppShell: projects -> task rows; goals; shell metrics; identity; favorites
    +--> page model, e.g. Home: operator snapshot + 10 dashboard reads + activity section
    |
    +------------ many HTTPS operations -------------------->
                       Supabase Auth / PostgREST / Realtime
                       Supabase project eu-west-1 (Ireland)
The CDN may serve static assets locally. Changing Function region does not move Supabase, browser location, or middleware to Ireland. Browser-to-Supabase direct requests and realtime also have their own network path. In particular, do not assume every slow request is a Vercel Function.
Production config
- Web deployment commit: 637cb9aa (merged region PR #338 on top of merged PR #336).
- Vercel web project: ega-house-platform (production domain egawilldoit.online).
- Runtime currently Next.js 16.4.3 (apps/web/package.json). No framework upgrade is necessary to perform this plan.
- Root vercel.json: web deployment gating on main, outputDirectory: "apps/web/.next", and verified regions: ["dub1"].
- A separate apps/server/vercel.json exists. Do not apply the web region configuration to another Vercel project blindly.
- The Supabase dashboard screenshot at the time of the report showed healthy status, CPU ~3%, RAM ~59%, disk ~17%. These figures do not establish database query latency.
File ownership / change map
These are inspection and likely change points, not an instruction to modify every file mechanically.
Area	Specific files	Change needed
Region	vercel.json; Vercel web project settings	COMPLETE: dub1 verified READY; no more changes unless regression
Next config	apps/web/next.config.ts	Inspect only; retain existing Sentry/Turbopack/import settings absent evidence
Shared app chrome	apps/web/src/components/layout/app-shell.tsx, workspace-shell.tsx, sidebar.tsx, sidebar-navigation.tsx, top-bar.tsx, tasks-workspace-shell.tsx	Separate persistent frame from per-page header/data; avoid repeated full shell
Route placement	apps/web/src/app/{home,today,tasks,goals,timer,review,work-analytics,...}/page.tsx	Move eligible protected pages under (workspace) route group, preserve URL
Loading UX	apps/web/src/app/**/loading.tsx; apps/web/src/components/layout/{workspace-skeleton-shell,workspace-route-skeleton}.tsx	Make content-only fallbacks inside persistent chrome
Auth	apps/web/src/proxy.ts, lib/supabase/{server,client,cookie-options}.ts, lib/services/auth-service.ts	Measure/verify session refresh, request dedupe, protection, cookie continuity
Root theme	apps/web/src/app/layout.tsx, lib/services/user-preferences-service.ts, components/layout/workspace-preferences-provider.tsx	Keep pre-paint theme correctness; handle changes after persistent layout
Shell reads	apps/web/src/lib/workspace-shell.ts, lib/services/favorite-service.ts, components/layout/app-shell.tsx	Reduce scope and improve data freshness strategy; preserve exact semantics
Home	app/home/page.tsx, app/home/_lib/home-dashboard-data.ts, app/home/_components/*, lib/services/task-read-service.ts	Trace query graph; stream noncritical panels; aggregate only on proof
Tasks	app/tasks/page.tsx, app/tasks/_lib/tasks-page-model.ts, lib/services/task-service.ts, components/tasks/*	Avoid global rerenders on filter/drawer/board interactions; bound data
Today	app/today/page.tsx, lib/services/operator-service.ts, packages/data-access/src/today/repository.ts	Trace canonical snapshot, drawer extras and duplicate metrics
Goals	app/goals/_lib/goals-page-model.ts, packages/data-access/src/goals/repository.ts	Audit authenticated read path and model cost
Timer	app/timer/_lib/timer-page-model.ts, lib/services/timer-service.ts, packages/data-access/src/timer/repository.ts	Protect isolated 1-second tick; bound session/history payloads
Review/analytics	app/review/_lib/review-page-model.ts, app/work-analytics/_lib/work-analytics-page-model.ts, lib/services/work-analytics-*	Avoid duplicate evidence reads, defer heavyweight charts where measured
Realtime	components/realtime/owner-scoped-realtime-refresh.tsx, lib/supabase/realtime.ts, client router.refresh() callers	Rebase/merge PR #337; remove redundant refresh paths safely
URL navigation	lib/use-canonical-url.ts, components/layout/sidebar-navigation.tsx, top-bar.tsx, command-palette.tsx, workspace-keyboard-shortcuts.tsx, app/apps/apps-launcher-grid.tsx	Audit full-origin navigation, preserve deep links
Motion/UX	src/styles/motion.css, src/styles/workspace.css, src/styles/tokens.css, components/motion-provider.tsx	Prevent content-animation delay and motion-induced jank; preserve preferences
Observability	apps/web/src/instrumentation-client.ts, instrumentation.ts, existing Sentry and PostHog integration	Lightweight route metrics and bounded server timings; no new paid product
DB evidence	drizzle/ migrations, supabase/, data-access repositories	Inspect indexes and plans before a schema proposal
Prior design docs	docs/ui-web-v2/{PERFORMANCE-BASELINE,SHELL-PERSISTENCE-EVALUATION,ROUTE-MATRIX}.md	Use as historical context; much predates current Home redesign


Source boundary: This inventory reflects examined paths at the specified commit, not a complete line-by-line audit of every one of the 2,500+ repository entries. Use repository searches during each focused PR to identify additional call sites rather than asserting that uninspected code is defective.
2. Phase P0 — Establish an honest production baseline (PR 0)
Outcome: Can distinguish network/region delay, server data wait, rendering/hydration, and browser interaction delay for representative navigation paths.

Scope
1. Create docs/performance/navigation-baseline-2026-10-30.md (or dated current baseline), containing deployed commit, Vercel deployment ID, origin, browser, connection, tested account fixture and sample size (never credentials).
2. Measure logged-in transitions Home → Today → Tasks → Project detail → Goals → Timer → Review → Work Analytics → Home. Include reverse/back, repeated same route, cold first visit, warm prefetched route, mobile viewport and slow 4G simulation. Test root domain and one transition from tasks.egawilldoit.online to www.egawilldoit.online separately.
3. In DevTools Performance + Network, record document navigations, RSC requests, redirects, TTFB, response/body size, resource load, main-thread long tasks, mount/unmount, animation durations and when page becomes useful/interactive. A navigation trace must distinguish server wait from CSS skeleton display.
4. Capture timings for auth proxy, root preferences (when rendered), AppShell, Home snapshot, Home dashboard reads and slowest nested service. Add development-only, low-overhead timers using performance.now() with log gating if needed; no raw user, token, project, task or task-title values.
5. Mark 3–5 representative queries for safe SQL plan inspection with a database connection. If connected SQL stats aren't available, record unverified, not “fast”.
6. Aggregate p50/p75/p95 (for enough samples), Function duration, Function Active CPU where actually available, 4xx/5xx and query count per route. Do not substitute CPU usage graph for request latency.
Baseline data table — fill with measured values; never fabricate:
Journey	Navigation p50/p75	p75 TTFB / RSC wait	Requests / DB operations	Browser INP / long tasks	Notes
Home → Today	TBD	TBD	TBD	TBD	warm, same origin
Today → Tasks	TBD	TBD	TBD	TBD	query filters
Tasks → Project	TBD	TBD	TBD	TBD	detail/drawer
Goals → Timer	TBD	TBD	TBD	TBD	active timer
Review → Home	TBD	TBD	TBD	TBD	analytics
Tasks subdomain → Home canonical	TBD	TBD	TBD	TBD	full origin navigation


Acceptance: Baseline reproducible and reviewed; measurements identify at least the first server-side bottleneck and whether it is network time or CPU. A saved authenticated HAR must have credentials and private task data redacted and must not be committed. Avoid over-instrumenting production; use already-installed Sentry/PostHog selectively only if configured and consent/security expectations permit.

Not included: libraries, paid APM, performance rewrites, public benchmarking that exposes private data.
3. Phase P1 — Region alignment (COMPLETED, PR #338)
Do not implement again. PR #338 was merged into main as 637cb9aad9a10c604aa1f2612c8ff04b25a79678. Vercel web project ega-house-platform (prj_YQBQhWZMVSXfPujnmjq4ENkBZ4Ra) serves production deployment dpl_4Uf3haianqDpzSW2WiW1femc8bwb, READY on egawilldoit.online with regions: ["dub1"]. Database stays in Supabase AWS eu-west-1 (from user dashboard).

Effective root vercel.json (verified on main):
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "ignoreCommand": "test \"$VERCEL_GIT_COMMIT_REF\" != main",
  "outputDirectory": "apps/web/.next",
  "git": {
    "deploymentEnabled": { "*": false, "main": true }
  },
  "regions": ["dub1"]
}
Remaining post-change gate: authenticated Home/Today/Tasks/Goals/Timer/Review smoke and post-Dublin timing baselines. READY does not establish that latency improved or that every authenticated page passes. No matched pre-Dublin performance baseline is available. Keep this status not measured until a comparison can be made. Do not touch apps/server/vercel.json, DB placement, DNS or Vercel plan.
4. Phase P2 — Persistent authenticated shell + content-only loading (PR 2)
Root problem: AppShell is an async Server Component instantiated within many individual page.tsx files. WorkspaceShell is a client component with collapsed state; WorkspaceSkeletonShell builds a second, noninteractive sidebar/top bar in loading.tsx. Navigating can replace all chrome with skeletons. The repository's SHELL-PERSISTENCE-EVALUATION.md already explicitly documents nonpersistent shell and remounts.

Target architecture
app/layout.tsx                        # one global HTML, theme/provider and fonts (retain)
app/(workspace)/layout.tsx            # NEW authenticated shared shell frame
app/(workspace)/loading.tsx           # fallback ONLY for its content if needed
app/(workspace)/home/page.tsx         # route still /home
app/(workspace)/today/page.tsx        # route still /today
app/(workspace)/tasks/page.tsx        # route still /tasks
app/(workspace)/tasks/projects/...    # path structure preserved
app/(workspace)/goals/page.tsx        # route still /goals
app/(workspace)/timer/page.tsx        # route still /timer
app/(workspace)/review/page.tsx       # route still /review
app/(workspace)/...                   # other confirmed authenticated routes
app/login/page.tsx                    # PUBLIC; outside group
app/signup/page.tsx                   # PUBLIC; outside group
app/page.tsx                          # existing public entry semantics
app/auth/...                          # callbacks outside group
app/oauth/consent/...                 # evaluate independently; DO NOT relocate by default
app/api/...                           # route handlers stay outside group
Design rules
1. Keep the single WorkspaceShell instance mounted across same-origin authenticated route changes. Sidebar collapse preference, search dialog/drawer, focus, top-bar controls and navigation responsiveness should persist across changes.
2. Separate page-specific title, description, actions and breadcrumbs from static shell data. Currently WorkspaceShell takes these as props via AppShell; when moving to layout, use page-local WorkspacePageHeader (or a small, clearly owned header component) and client pathname for stable breadcrumb. Do not introduce a global mutable page-title singleton or provider that races during navigation.
3. Keep the stable chrome renderable while page content suspends. Replace HomeLoadingPage / TasksLoadingPage / etc full WorkspaceSkeletonShell with content-only skeletons. A normal route transition should never show a second sidebar or replace interactive navigation.
4. Avoid putting every shell DB query in a blocking shared layout. Layout loading.tsx sits beneath layout; it cannot cover slow layout data. Use a stable frame, Suspense for the smallest server-fetched sidebar fragment where supported, or a bounded authenticated client refresh strategy for volatile badge/count data. Measure startup trade-offs.
5. Shared layouts do not rerender on every navigation. Ensure changed project names/favorites/counts, timer state, theme and account identity can update after mutations, realtime and sign-out. Prefer a small owner-scoped refresh seam, not unconditional whole-app router refresh and not permanent stale metrics.
6. Keep secure authentication/authorization inside data-access, page and mutation boundaries, not exclusively layout or proxy. Proxy getClaims is useful for optimistic route redirects, but layouts are reused and server actions/routes are direct entry points. Preserve RLS and owner-scoped DTOs.
7. Preserve per-page metadata, searchParams, dynamic routes, query string state, error boundaries, 404, not-found, root marketing page and /dashboard compatibility redirect.
8. Confirm route moves with git mv; route-group folder names do not appear in URL. Do not create multiple root layouts: crossing root layouts causes a full reload.
9. Keep ToastProvider, keyboard shortcuts, quick-action controllers and workspace preferences in one persistent owner. Avoid duplicate event listeners, modal portals or realtime subscriptions.
10. If rollout risk is high, first migrate Home/Today/Tasks behind a shared layout in one bounded PR, prove their transitions, and migrate the remaining route group in a follow-up. Partial rollout should explicitly document that transitions outside the group still remount until migrated.
Eligible route inventory for examination before git mv: /home, /today, /tasks, /tasks/projects, /tasks/projects/new, /tasks/projects/[slug], /tasks/projects/[slug]/delete, /goals, /timer, /review, /review/[reviewId], /work-analytics, /backlog, /archive, /favorites, /notifications, /startup, /shutdown, /ideas, /friction, /apps, /apps/[workspace], /agents, /agents/[id], /help, /settings and its account/appearance/areas/preferences pages. Classify each as protected or public in current routing before moving; do not assume all are protected.

Acceptance: click Home → Today → Tasks → Goals → Timer in one origin and observe one persistent sidebar/top bar, no complete chrome skeleton, no loss of sidebar collapse, old page replaced by page-scoped fallback, correct title/actions/metadata, no duplicate keyboard shortcuts, no auth leak. Reload and sign out/in work; cookies persist; existing route URLs unchanged. Browser and Playwright tests cover rapid clicks/interrupted nav/back/forward.

Not included: site-wide UI redesign, replacing Next router, making auth client-only, prefetching all pages/data indiscriminately, new global state library, redesigning mobile app.
5. Phase P3 — Optimize shell data without stale badges (PR 3)
Observed service graph
- AppShell starts five groups concurrently: getSidebarProjects, getSidebarGoals, getWorkspaceShellMetrics, getShellIdentity, listFavorites.
- getSidebarProjects selects up to 24 projects, then up to 1,000 non-done task rows across those projects to compute counts in JavaScript. The 1,000-row limit is global, so counts can be incomplete if exceeded. Current query selects project_id, status even though status isn't used in JS; PR #337 drops it. Do not claim PR #337 removes an N+1 query; it doesn't.
- getSidebarGoals loads up to 50 goal rows; prove the quick-action launcher actually needs the entire shape on all routes.
- getWorkspaceShellMetricsResult fetches timezone/identity then timer, blocked, overdue, due-today, review and notification signals. It uses request-level React.cache only.
- Favorites read is separately owner-scoped; review request scope, data shape and error fallback.
Changes, in measured order
1. Rebase/merge PR #337 before editing the same sidebar or realtime paths; retain its tested visibility/resubscription correctness. If it is not merged, avoid overlapping edits or explicitly coordinate a stacked PR.
2. Do not fetch the entire task row payload merely to show six sidebar project counts if an exact, owner-scoped aggregate (existing service/query or verified new Postgres RPC) costs less. An aggregate must match active vs archived, status semantics, project_id, owner and RLS; refuse a silent change from exact counts to capped approximations.
3. Reduce fields/projects/goals to what the chrome actually renders. Separate on-demand quick-action data from mandatory shell work if feasible. Measure how many route transitions currently call each query.
4. Define shell state freshness contract: timer/notifications/task counts after mutations; no stale “all clear” after an unavailable metrics read; no hidden refresh burst. Use a small refresh endpoint or existing authorized data seam only when needed; avoid new paid services.
5. Reuse verified identity in one server render. Do not persist user-specific results in an unkeyed cross-user cache. Keep request-scoped memoization for shared reads.
6. Add query-count assertions and failure fallback tests. The shell must remain navigable if the metrics endpoint fails.
Acceptance: sidebar counts and favorites equal baseline for normal/archived/done/projectless records and >1,000 task fixture; RLS owner isolation; no duplicate auth round trip where the request memoization contract applies; no transient incorrect “zero” badge; query bytes and p75 server wait measured before/after.

Not included: schema migration without query-plan evidence, hidden caching of private data, abandoning realtime, changing task semantics.
6. Phase P4 — Make Home useful before secondary analytics finish (PR 4)
Observed graph (production code):
- app/home/page.tsx waits on getOperatorSnapshotData, getWorkspaceShellMetricsResult, getCurrentUser, getShellIdentity and getHomeDashboardData in one Promise.all before composing its main model. The active timer may trigger another awaited read.
- app/home/_lib/home-dashboard-data.ts calls requireAuthenticatedUser, then getWebTimeContext, then starts a group of 10 operations: project counts, open tasks, completed tasks this week, timer sessions this week, three deadline previews, upcoming, overdue and completed previews.
- Activity pulse already has its own Suspense section. Preserve that improvement.
Implementation
1. Document precise dependency edges and duration for each Home query. A parallel batch of 10 is not automatically 10 round-trip latencies; the critical path is longest chain plus fan-out overhead. Avoid inaccurate N×RTT claims.
2. Split Home into small always-useful content (greeting, active-focus state, primary action) and secondary independent panels (stats, deadline previews, activity). Place real Suspense boundaries at data dependencies; ensure the skeleton dimension matches final content.
3. Prefetch or reuse canonical reads within a request via established React.cache/service methods, preserving user scoping. Avoid adding use cache to authenticated data without a verified private-cache contract.
4. Merge the three deadline preview queries only if a single bounded fetch or SQL aggregate has better real execution time and returns the same exact window semantics. Do the same for overlapping overdue/upcoming counts, but preserve timezone and null-date handling.
5. Avoid loading a full year of work evidence on initial Home merely to display a 12-week compact pulse if the canonical read model can accept a bounded interval without breaking streak semantics; otherwise keep its independent stream and optimize the query at its owner.
6. Check whether Home OwnerScopedRealtimeRefresh and individual mutation handlers create duplicated server refreshes. Only reduce verified duplicates after PR #337 is incorporated.
7. Keep error states honest: stale/unavailable ≠ zero. Fail a secondary section without blanking the primary task selection.
Acceptance: primary Home focus content appears without waiting on the slowest analytics query, no changed Today/date or priority model, exact task counts/previews equal tests, no private-data cache leakage, no permanent layout shift. Compare p75 navigation, query count, TTFB, browser input responsiveness and Active CPU separately.
7. Phase P5 — Other screen-specific request and UI audits (PRs 5A–5D)
Tasks / Projects (PR 5A)
Files: app/tasks/page.tsx, _lib/tasks-page-model.ts, lib/services/task-service.ts, lib/services/task-read-service.ts, components/tasks/*, app/tasks/_components/*.
- getTasksPageModel awaits time context before getTasksWorkspaceData; profile whether they could overlap without losing correct local date/timezone for date-dependent filters.
- Audit list/board/calendar/timeline for payload and render cost. Keep existing page/row bounds and ensure counts stay truthful if results truncate; do not fetch every task to render a small viewport.
- Change only the view that is slow: defer heavy drawer details until selected, use per-view targeted loading; avoid mounting all inactive view trees. Use windowing/virtualization only if traces and row counts justify it; preserve keyboard, screen readers, drag-and-drop and scroll restoration.
- Audit all router.refresh() calls in board/table/timeline and drawers. Coalesce a mutation's optimistic update and server refresh rather than double refresh, with rollback on failure.
- Preserve URL-driven filters, saved views, sorting, project/goal selection, task IDs, edit permissions, comments, attachments, due windows, RLS and offline messaging.
Today (PR 5B)
Files: app/today/page.tsx, lib/services/operator-service.ts, packages/data-access/src/today/repository.ts.
- Profile getOperatorSnapshotData and drawer details; selected task triggers detail, subtasks, activity, comments, attachments and favorites reads. Verify whether they run sequentially and defer unrelated drawer tabs instead of loading all eagerly.
- Share request-memoized canonical Today and workspace metrics rather than recomputing overlapping aggregates.
- Keep timezone, start-here ranking, focus queue, active timer and status transitions unchanged. Use fine-grained loading for just the selected task panel.
Goals / Review / Analytics (PR 5C)
Files: app/goals/_lib/goals-page-model.ts, packages/data-access/src/goals/repository.ts, app/review/_lib/review-page-model.ts, app/work-analytics/_lib/work-analytics-page-model.ts, chart components.
- getGoalsPageModel calls requireAuthenticatedUser({supabase}) with an explicitly injected client; this bypasses the shared getCurrentUser() cache path. Audit for duplicate verification in the same request; refactor only if it preserves error handling and test seams.
- Review page model also calls supabase.auth.getUser() directly; inspect if it overlaps existing request-verified identity, retaining security.
- Analytics reads sessions and task counts plus a work activity model. Measure overlapping windows and duplicated evidence before consolidating.
- Defer expensive charts until the primary report context is ready if bundle/CPU traces demonstrate benefit. Maintain accessible chart titles, tables/summary fallbacks and URL filter state. Don't replace exact financial/productivity data with estimates.
Timer / Other light routes (PR 5D)
Files: app/timer/_lib/timer-page-model.ts, lib/services/timer-service.ts, packages/data-access/src/timer/repository.ts, app/{backlog,archive,favorites,notifications,ideas,startup,shutdown,settings,agents}/**.
- Timer currently obtains timezone before workspace data and renders a separate isolated live tick. Keep the 1-second timer updating its own element only. Verify open-session list bound, historical session pagination and no huge work-duration map when list needs only recent items.
- Audit the remaining routes individually by navigation trace; no blanket refactor. Fix any duplicate fetches or full-page pending states only on measured pathways.
- Keep export routes, auth checks, task/goal data ownership, notification unread state and errors intact.
Each PR 5x acceptance: targeted page-model tests, equivalent DTOs and functional routes, improvement evidenced in a before/after trace, no regression to P2 persistent chrome. Keep one self-contained screen family per PR.
8. Phase P6 — Cross-origin/subdomain navigation correctness (PR 6)
Observed: apps/web/src/lib/use-canonical-url.ts returns relative URLs when on egawilldoit.online, www.egawilldoit.online, localhost; on a workspace subdomain, links to other workspaces/global routes become https://www.egawilldoit.online/.... This crosses origin and can force a full document load; normal Next prefetch cannot remove that browser boundary.

Decision: use the root domain for in-app primary navigation (unless there is a strong product requirement for workspace subdomains). Keep existing subdomains as backward-compatible entry/deep-link points. Do not immediately remove subdomains, auth cookies or rewrite rules.

Tasks
1. Map entry host → clicked target host → final URL and HTTP redirects for every sidebar, top-bar, command palette, keyboard shortcut and app-launcher destination.
2. Confirm hostnames are not bouncing between apex and www unexpectedly; count auth refreshes on cross-origin journeys.
3. Decide canonical browser behavior once. Preferred: users who enter a workspace subdomain can reach a stable root URL safely while preserving path/query and avoiding redirect loops; internally, all workspace links are same-origin.
4. Modify use-canonical-url.ts + proxy.ts together under tests. Be cautious: Next's proxy can refresh Supabase cookies; redirects must preserve all required response cookies, session and next redirect parameters.
5. Validate direct deep links and OAuth sign-in callback across origins. Verify logout, app install/PWA scope and canonical URL handling. Do not redirect non-owned external hosts.
Acceptance: root-origin navigation is SPA-style; legacy links still reach correct target; no full-origin navigation for standard sidebar clicks once inside canonical workspace; no auth loops, lost filters, cookie regression, PWA scope regression or inaccessible back behavior.

Not included: deleting subdomains or DNS records, rewriting all link usages blindly, unsafe auth rewrites.
9. Phase P7 — UI/UX responsiveness, visual stability and accessibility (PR 7)
This phase must fix perception and interaction without hiding underlying latency. Use measured UX issues and existing components/tokens; no speculative redesign.
Navigation and skeletons
- The sidebar/top bar always remain visible and clickable while page content loads; show a small pending state in the page area or active nav item. Avoid full-screen skeleton flash on each navigation.
- Prevent repeated blank/skeleton → content → skeleton loops during a realtime refresh. Only display fallback where data is actually absent; retain safe previous data for filters where appropriate.
- Skeleton dimensions match final home stats/cards, task rows, overview and drawer panes. Use minimal layout shift; no competing nested spinners.
- Ensure first useful action is visible even when secondary analytics fails. Error/retry in a panel, not whole workspace, whenever recoverable.
Page UI priorities
- Home: one dominant “start here” action, then urgent Today/Next/Attention; keep analytics secondary and progressively delivered.
- Today: keep focus queue/start task and active timer prominent; preserve workflow state when navigating away/back; action confirmation inline.
- Tasks: responsive filters and saved views, compact hierarchy, stable selection, sensible keyboard focus on drawer open/close; no unnecessary rerender on typing or drag.
- Goals: goal progress and next action readable without extra clicks; low-noise inline editing with immediate pending/error feedback.
- Timer: timer remains smooth during data reload and tab switch; do not use aria-live for every second of elapsed time (over-announces). Announce meaningful start/stop state only.
- Review/Analytics: avoid blocking primary report with charts; label units and time ranges; text/table fallbacks for visual-only graphs.
- Mobile/PWA: nav drawer opens immediately, fixed controls remain reachable, prevent scroll trapping and accidental reinitialization when routes change.
CSS and browser work
- Review PR #336 motion in src/styles/motion.css; .motion-rise and motion-stagger on content transitions should not make ready data look delayed. Prefer subtle transform/opacity on small groups; no long stagger on primary action. Investigate with prefers-reduced-motion: reduce as diagnostic (not as the universal fix).
- Existing WorkspaceShell puts motion-rise on .app-content; verify it does not restart on routine navigation and that animation doesn't interfere with focus, scroll restoration or fixed descendants.
- Honor OS and stored reduced-motion settings. Keep keyboard focus outlines, accessible names, notification indicators and contrast in light/dark modes.
- Use browser Performance profiling before memoizing dozens of components or adding virtualization. Identify long tasks/hydration cost and only then split expensive client islands / lazy-load chart packages. Maintain Next/font self-hosted assets; avoid reintroducing remote blocking fonts.
- Check long task lists, drag layers, search/autocomplete, charts and global event listeners for actual jank. No automatic dependency addition or new animation framework.
Usability acceptance matrix
Journey	Must remain functional / usable
Rapid Home → Tasks → Today → Back	Immediate nav feedback; no lost sidebar, stale title or wrong content
Sidebar collapse + route switch	Collapse preserved; correct aria-current and focus
Open task drawer + close	Focus returned to initiating item; selection and URL state consistent
Timer active → other route → Timer	Same session identity and elapsed state; no duplicate session
Theme Light/Dark/System + route switch	No flash, no hydration mismatch, preference persisted
Reduced motion	Critical status still visible; no required animation
390px and tablet navigation	No horizontal overflow; drawer not trapping scroll/focus
Screen-reader keyboard traversal	Nav links named, active route clear, dynamic actions announced appropriately
Offline/failed data	Stable shell + actionable error; no fictitious zero/healthy badge


10. Phase P8 — Database/queries: only evidence-backed optimization (PR 8, optional)
Do not change database compute, region or indexes merely because its dashboard says Nano. The CPU screenshot is low; a 1000-row task projection can still waste latency, but the query plan must identify why.
1. Gain authorized access to the actual EGA House Supabase project, not another linked Supabase account. The current connector's visible project list did not expose this production project; do not query or migrate the wrong project.
2. Inventory current migration/index definitions, RLS, table cardinality and most-used requests (projects, tasks, goals, task_sessions, week_reviews, notifications, favorites, user_time_context, user_preferences). Check existing indexes before proposing duplicates.
3. Use Supabase Query Performance / pg_stat_statements where available and safe read-only SQL plans (EXPLAIN for representative SELECT queries). Use EXPLAIN (ANALYZE, BUFFERS) only in authorized non-production / safely bounded conditions; never accidentally execute writes or unbounded load testing.
4. Look for overfetching, many sequential REST calls, repeated exact count queries and rows returned only for JS aggregation. Compare index plans, sort, network time and PostgREST/RLS cost.
5. Only after measurements, propose one migration or optimized read method per PR, with corresponding test for owner isolation, correctness under real data distribution, rollback plan and explicit migration approval.
6. Validate client constraints and connection pools on Nano; do not bypass RLS, expose service keys to the browser, or use cross-user unstable_cache/cache keys.
Candidate query families, not already-diagnosed SQL defects: getSidebarProjects, workspace shell counts, Home deadline previews and counts, operator snapshot, analytical session aggregates and project task counts.

Acceptance: before/after query plan or timed representative query demonstrates benefit; results and privacy contract identical; migrations applied in authorized sequence; no additional writes/locks in production outside approval.
11. Auth, security and reliability gates across all PRs
- Server authority: proxy.ts uses Supabase getClaims() for request-route checks. It must set request + response refreshed cookies correctly. A persistent route group does not replace secure checks in service methods, route handlers or server actions.
- Request identity: getCurrentUser() currently memoizes a supabase.auth.getUser() server call per React render; other service callers sometimes inject clients and bypass that memoization. Audit duplicates; do not substitute unverified getSession() on the server, weaken validation or rely on UI-only route protection.
- User-specific caching: request scoped React.cache is acceptable for dedupe. Avoid shared use cache or unstable_cache for authenticated responses unless per-user scope, invalidation, RLS and version semantics are reviewed and tested. Never cache raw JWT/session in a shared store.
- RLS / privacy: every new aggregation/read path must preserve owner scope; a helper's caller-provided ownerUserId is not authority without verified actor context.
- Realtime correctness: PR #337 addresses a stale-subscription and visibility bug. Hidden tab should catch up correctly; don't “optimize” by dropping relevant updates or claiming fewer refreshes without evidence.
- Auth edge cases: sign in, sign out, expired cookie, token refresh, invalid token, rapid navigation after sign-out, multi-tab mutation and direct deep link.
- Errors: no unhandled server error, auth redirect loop, missing project/goal data, stale healthy badge or repeated client refresh storm. Check Vercel logs within Hobby retention and existing Sentry signals when available.
- Production boundaries: never expose secrets in logs, URLs, HARs or artifacts; no bypass of failed security audit; no automatic migration or deploy from an inspection request.
12. Verification and CI contract
Required automated checks
1. Exact-head tests around changed routes, auth, navigation, shell, data services, realtime and cookie/session contracts.
2. Existing repository build, typecheck, lint, formatting, security/dependency audit, and required CI statuses; document any pre-existing blocking failure honestly.
3. Playwright regression matrix for same-origin navigation, skeleton persistence, rapid/interrupted route changes, loading/error states, keyboard, mobile, theme, reduced motion, direct deep links, and logout.
4. Data/service assertions: counts and timezone windows exactly match before/after; test >1,000 rows for sidebar if changing counting; owner A cannot read owner B data; no active timer duplication; invalid user rejected.
5. Any SQL/RPC migration: apply only with approval and test RLS, index usage, read correctness, and backward compatibility.
6. Browser coverage: Chromium + one additional browser (Firefox/WebKit where available), mobile 390px and desktop; repeat in production-like build. Development HMR is not performance proof.
Performance measures and target gates
Baseline first. The following are acceptance targets, not pre-existing measurements or guaranteed improvements:
Metric	Target / rule	Why
Shell persistence	100% of same-origin authenticated transitions stay within one mounted shell	Addresses screenshot symptom
Full document reloads	0 for normal same-origin workspace navigation	No origin/layout reset
Navigation acknowledgment	Visible feedback ≤100 ms on representative input	Perceived responsiveness
Page useful state	Lower p75 than P0 on tested routes; target ≤1 s for warm common routes where achievable	Actual user experience
INP	Aim <200 ms on measured interactions	Browser responsiveness
CLS	Aim <0.1	Stable content and skeleton
Backend waits	p75 and query count not worse; measured improvement on target route	Prevent appearance-only fix
Active CPU	Non-regression per equivalent workload; separate long-term ≥50% reduction ambition tracked in #337	Cost objective independent of latency
Correctness	0 auth/RLS/redirect/timer/count/notification regressions	Hard merge gate


Do not chase an invented absolute target if workload, device or network makes it meaningless; attach p50/p75 and sample count. No merge based on “feels faster” alone, but UX acceptance is also mandatory: skeleton may look smoother while server TTFB remains bad.
Before/after report template
PR: #___  HEAD: ___  Vercel deployment: ___  Function region: ___
Environment: ___  Browser/device: ___  Network: ___
Journey: ___  Samples: ___  cold vs warm: ___
Baseline p50/p75 navigation: ___ / ___ ms
Candidate p50/p75 navigation: ___ / ___ ms
Baseline/candidate RSC waiting: ___ / ___ ms
Baseline/candidate server queries: ___ / ___
Baseline/candidate browser long tasks / INP: ___ / ___
Baseline/candidate Vercel Active CPU (comparable window): ___ / ___
Auth/RLS/correctness checks: ___
Result: PASS / FAIL / NOT MEASURED; links to sanitized evidence: ___
13. Ship One Outcome — PR sequence and dependency rules
Order	PR / bounded outcome	Entry gate	Exit gate	Avoid touching
0	NEXT: post-Dublin baseline / instrumentation	main includes #338; test fixture	Reproducible authenticated navigation + server timing evidence	DB schema, UI redesign
1	COMPLETE: PR #338 region dub1	Already merged	READY dub1 confirmed; authenticated smoke + post-move baseline still due	API project, DB, app code
2	Persistent shell + page-only loading	P0, preferably P1	Home/Today/Tasks (then all protected routes) keep chrome mounted, auth verified	Query semantics, visual redesign
3	Shell reads/counts freshness	P2 and PR #337 coordination	Correct owner-scoped counts + fewer measured waits	Schema without proof
4	Home critical-path streaming	P2 shell architecture	Primary action usable while analytics load; data parity	Today task ranking
5A	Tasks/project navigation	P2	Targeted load improvement + view/filter parity	Other screen families
5B	Today/operator workload	P2	Focus/drawer load improvement + timer parity	Timer semantic changes
5C	Goals/review/analytics	P2	No extra auth/data duplication, charts accessible	Global chart library rewrite
5D	Timer/remaining-route hotspots	P2	Measured improvement and timer isolation	Mobile app, API transport redesign
6	Canonical same-origin navigation	P2	Deep links work, no cross-origin standard internal clicks	DNS removal, auth rewrites
7	UX stabilization and motion/a11y	P2–P6 as relevant	Visual/keyboard/mobile tests + responsive UI	New design framework
8	Database evidence-backed correction, only if needed	SQL plans, owner approval	DB query improvement + RLS parity	Production migration without approval
9	Final release verification	All selected scoped PRs approved	P0 vs final report; no new regressions; known limits explicit	Unrelated features


Do not merge PR #337 solely to unblock this plan if required checks still fail; its security dependency concern must be resolved or handled under the repository's approved policy. Its realtime changes must not be re-implemented in PR 3. If #337 remains open, perform this work on non-overlapping branches and rebase/retest after resolution.
For each coding agent handoff
Use this compact, executable format (one PR at a time):
Outcome: [exact measurable result from the phase]
Starting point: origin/main @ <actual SHA>; production snapshot, relevant prior PRs
Context: read this runbook + exact affected paths + official referenced docs
Scope: named files and tests only, minimal implementation; preserve current interfaces
Not included: unrelated refactors, app features, DB/auth contract changes, dependencies
First checkpoint: read code, identify query/navigation graph, capture baseline, report risks
Implementation: write failing regression test, implement bounded fix, rerun checks
Acceptance: exact functional + performance + security criteria for this phase
Evidence: before/after timings, sanitized trace path, full tests, CI, final SHA
Release: open PR for human review; DO NOT auto-merge, deploy to production or migrate DB
Final definition of done: everyday navigation maintains a responsive persistent workspace shell, first useful content appears promptly, no unneeded cross-origin reload, page models have measured (not imagined) bottleneck corrections, security and data contracts are intact, and the deployed region is confirmed dub1. The 50% Vercel Active CPU objective remains a separate, instrumented effort unless equivalent-workload data proves it. The dub1 deployment is already confirmed live.
14. Provenance, source links, and important constraints
Repository / deployment snapshot (original code URLs are historical; always use current main)
- EGA House repository, exact original production snapshot: https://github.com/egawilldoit/Ega-House-Platform/tree/0bf3d29a9186b07df3094346e96163d7f83fcbf1
- AppShell: https://github.com/egawilldoit/Ega-House-Platform/blob/0bf3d29a9186b07df3094346e96163d7f83fcbf1/apps/web/src/components/layout/app-shell.tsx
- workspace-shell: https://github.com/egawilldoit/Ega-House-Platform/blob/0bf3d29a9186b07df3094346e96163d7f83fcbf1/apps/web/src/lib/workspace-shell.ts
- WorkspaceSkeletonShell: https://github.com/egawilldoit/Ega-House-Platform/blob/0bf3d29a9186b07df3094346e96163d7f83fcbf1/apps/web/src/components/layout/workspace-skeleton-shell.tsx
- Home route: https://github.com/egawilldoit/Ega-House-Platform/blob/0bf3d29a9186b07df3094346e96163d7f83fcbf1/apps/web/src/app/home/page.tsx
- Home data: https://github.com/egawilldoit/Ega-House-Platform/blob/0bf3d29a9186b07df3094346e96163d7f83fcbf1/apps/web/src/app/home/_lib/home-dashboard-data.ts
- Auth proxy: https://github.com/egawilldoit/Ega-House-Platform/blob/0bf3d29a9186b07df3094346e96163d7f83fcbf1/apps/web/src/proxy.ts
- Cross-origin nav: https://github.com/egawilldoit/Ega-House-Platform/blob/0bf3d29a9186b07df3094346e96163d7f83fcbf1/apps/web/src/lib/use-canonical-url.ts
- Existing shell analysis: https://github.com/egawilldoit/Ega-House-Platform/blob/0bf3d29a9186b07df3094346e96163d7f83fcbf1/docs/ui-web-v2/SHELL-PERSISTENCE-EVALUATION.md
- PR #336, recently merged UI motion: https://github.com/egawilldoit/Ega-House-Platform/pull/336
- PR #337, open realtime/CPU project: https://github.com/egawilldoit/Ega-House-Platform/pull/337
- Historical Vercel deployment (pre-PR #338): dpl_HPgWfoT7hbCnaNJiNPZTtV7wmxv2, iad1, 0bf3d29a. Current production verified: dpl_4Uf3haianqDpzSW2WiW1femc8bwb, dub1, main@637cb9aa.
Official docs checked with Context7, TinyFish and direct official search
- Vercel: region config and database colocation: https://vercel.com/docs/functions/configuring-functions/region
- Vercel: vercel.json regions and overrides: https://vercel.com/docs/project-configuration/vercel-json
- Next.js: persistent layouts, limitations and loading under layout: https://nextjs.org/docs/app/api-reference/file-conventions/layout
- Next.js: loading states, interruptible navigation and Suspense: https://nextjs.org/docs/app/api-reference/file-conventions/loading
- Next.js: authorization should be enforced near data/actions and layout auth pitfalls: https://nextjs.org/docs/app/guides/authentication
- Next.js: data fetching and React.cache request deduplication: https://nextjs.org/docs/app/getting-started/fetching-data
- Supabase: Next.js SSR proxy + claims/cookies: https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs
- Supabase: analyze slow queries/indexes, not speculative indexes: https://supabase.com/docs/guides/database/query-optimization
Known limitations
1. This is a static code and deployment configuration investigation, not a completed logged-in performance benchmark. No authenticated browser HAR/Playwright trace, exact production SQL timings or full Vercel CPU export was provided.
2. The connected Supabase account available to this investigation did not list the EGA House production project; no production DB SQL or migrations were executed.
3. PR #337 is open and may change before implementation. Re-check main, PR status, dependency audit, deployment and function region at the start of each PR.
4. Research docs sometimes contain newer canary behavior beyond the installed Next.js 16.4.3. Use only APIs and configuration actually supported by the pinned app version; do not enable new cacheComponents or caching modes merely because a documentation snippet mentions them.
5. No source is evidence that this project is already meeting INP/LCP/CLS thresholds. Targets are aspirational until P0 creates a baseline.
6. This document authorizes planning and supervised coding on isolated branches, not automatic merge, production deployment, SQL migration, infrastructure charges, or secret handling.
Part III — Source-grounded patch blueprint (PROPOSED changes, not applied)
15. Exact current code contracts that constrain the patches
These are confirmed on main@637cb9aa, not invented abstractions:
- apps/web/src/components/layout/app-shell.tsx — getSidebarProjects is a cache(async ...) read of up to 24 projects, followed by a globally capped 1000-row unfinished task query; getSidebarGoals reads up to 50 goals. AppShell() waits for projects, goals, shell metrics, identity and favorites in a Promise.all. It owns ToastProvider → WorkspaceKeyboardShortcuts → GlobalQuickActionControllers → WorkspaceShell.
- apps/web/src/components/layout/workspace-shell.tsx — client component with const [collapsed, setCollapsed] = useState(false) and usePathname(). It currently accepts title, description, actions, hideHeader, className, contentClassName from each page and renders the page header itself. Its outer selector is className="ega-app-shell app-shell", data-collapsed; content has motion-rise.
- apps/web/src/components/layout/workspace-skeleton-shell.tsx — data-free full replacement chrome including <aside> skeleton and faux topbar; comments explicitly say no interactive nav/search/logout. Used by apps/web/src/app/home/loading.tsx, apps/web/src/app/tasks/loading.tsx, and workspace-route-skeleton.tsx.
- apps/web/src/app/home/page.tsx — Promise.all(getOperatorSnapshotData, getWorkspaceShellMetricsResult, getCurrentUser, getShellIdentity, getHomeDashboardData), then conditional getActiveTimerSession; wraps model in <AppShell hideHeader> and mounts owner realtime refresh.
- apps/web/src/app/today/page.tsx — two return paths use <AppShell> (error fallback and successful view); selected task reads detail, subtasks, activity, comments, attachments and favorite status currently await in sequence. Both branches must migrate together.
- apps/web/src/lib/workspace-shell.ts — shell metrics use timezone/identity then six concurrent reads; getWorkspaceShellMetricsResult = cache(...); user verified via getCurrentUser; metrics result has { metrics, available } to distinguish fallback from success. Preserve this truthfulness.
- apps/web/src/lib/services/auth-service.ts — getCurrentUser() delegates to getRequestUser = cache(...) by default, and uses injected client separately. Do not accidentally add duplicate getUser calls to new layout.
- apps/web/src/app/layout.tsx — server root layout reads getWebUserPreferences() for HTML theme/accent/density/reduced-motion; already uses local fonts and existing WorkspacePreferencesProvider, MotionProvider, DisplayTimezoneBootstrap and a pre-paint script. Do not move or duplicate global HTML or these providers.
- apps/web/src/lib/use-canonical-url.ts — same-origin relative href on apex/www/localhost, but workspace subdomain clicks outside their prefix get absolute https://www.egawilldoit.online/.... This is an intentional browser origin switch, not a Next caching bug.
- apps/web/src/instrumentation-client.ts has optional Sentry/PostHog; apps/web/playwright.config.ts has desktop Chromium and PWA 390px/320px configurations; auth E2E suite exists. Extend, do not replace.
- PR #337 open at head 125b7c2; its changes are not part of main. Check actual state before each implementation PR.
16. File-by-file change matrix / expected artifacts
PR	Primary files (real, verified)	New/moved files (planned)	Required behavior and test
R0	apps/web/src/instrumentation.ts, instrumentation-client.ts, playwright.config.ts; docs/ui-web-v2/PERFORMANCE-BASELINE.md	docs/performance/navigation-post-dublin-baseline.md, apps/web/tests/workspace-navigation.e2e.spec.ts (if authenticated fixtures exist)	Evidence, no private logs; existing Sentry hook retained; real browser baseline
R1	components/layout/app-shell.tsx, workspace-shell.tsx, workspace-skeleton-shell.tsx, workspace-route-skeleton.tsx, app/{home,today,tasks}/page.tsx and corresponding loading.tsx; components/tasks/tasks-workspace-shell.tsx	app/(workspace)/layout.tsx, app/(workspace)/home/, today/, tasks/ (initial git mv); components/layout/workspace-page-header.tsx; components/layout/workspace-content-skeleton.tsx	One shell, page-specific header/actions, Home hide-header, Today both return paths; no full shell replacement; tests verify shell DOM identity
R2	All other classified protected app/*/{page,loading}.tsx and relevant nested routes, components/layout/workspace-shell.tsx, lib/workspace-shell.ts, components/realtime/owner-scoped-realtime-refresh.tsx only after #337 coordination	Remaining app/(workspace)/** moves; optionally one minimal owner-scoped shell refresh seam	Full-route coverage, correct realtime badge/identity state, no duplicates; no public route move
R3	app/(workspace)/home/page.tsx, _lib/home-dashboard-data.ts, _components/authenticated-home-page.tsx, lib/services/task-read-service.ts	Optional small Suspense-wrapped server panel(s)	Primary action visible before secondary read; data parity and error degradation
R4	components/layout/app-shell.tsx, lib/workspace-shell.ts, lib/services/favorite-service.ts, components/layout/sidebar.tsx	Optional owner-scoped exact aggregate/query contract only if measured	Count correctness incl >1000 rows; non-owner isolation; no stale false zero
R5A	app/(workspace)/tasks/page.tsx, _lib/tasks-page-model.ts, lib/services/task-service.ts, components/tasks/*, app/tasks/_components/*	Isolated view-specific regression tests	Change measured list/board/drawer bottleneck; keep saved views, DnD and focus
R5B	app/(workspace)/today/page.tsx, lib/services/operator-service.ts, packages/data-access/src/today/repository.ts	Targeted Today/drawer tests	Parallelize independent drawer reads after auth; defer inactive tabs; no data leakage
R5C	app/(workspace)/goals/_lib/goals-page-model.ts, packages/data-access/src/goals/repository.ts, app/(workspace)/review/_lib/review-page-model.ts, app/(workspace)/work-analytics/_lib/work-analytics-page-model.ts	Goal/report performance tests	Correct identity, exact timezone/filters, bounded evidence; lazy charts if proven
R5D	app/(workspace)/timer/_lib/timer-page-model.ts, lib/services/timer-service.ts, packages/data-access/src/timer/repository.ts; remaining light routes	Timer lifecycle tests	1 Hz clock remains isolated; no session duplication; focus/tab continuity
R6	lib/use-canonical-url.ts, proxy.ts only if redirects really needed, components/layout/{sidebar-navigation,top-bar,command-palette,workspace-keyboard-shortcuts}.tsx, app/apps/apps-launcher-grid.tsx	Host/canonical routing tests	Same-origin once on canonical host; subdomain deep links work; OAuth/PWA intact
R7	styles/motion.css, styles/workspace.css, design tokens, components/motion-provider.tsx, screen-specific components	Visual/a11y screenshots/tests if existing tooling supports	No content hide/jank, proper focus/announcement, mobile drawer, reduced motion
R8 (optional)	packages/data-access/src/{tasks,goals,timer,today}/repository.ts, drizzle/, supabase/	Only approved SQL/index/aggregate migration	EXPLAIN evidence, RLS parity, lock/rollback tests


Path rule: After route moves, the physical path changes from app/home/... to app/(workspace)/home/... but the URL remains /home. All relative imports, tests, path-based scripts, CI globs and module mocks must be searched and adjusted. Do not duplicate pages at old and new paths (Next route collision). The exact route list is in Part II, §4.
16.1 Existing tests to preserve, not merely new happy paths
- apps/web/src/components/layout/workspace-shell.test.ts
- apps/web/src/components/layout/workspace-shell-navigation.test.tsx
- apps/web/src/components/layout/workspace-skeleton-shell.test.tsx
- apps/web/src/components/layout/workspace-route-skeleton.tsx (behavioral test addition if needed)
- apps/web/src/components/layout/workspace-keyboard-shortcuts.test.ts
- apps/web/src/app/home/home-routing.test.ts
- apps/web/src/app/home/_lib/home-dashboard-data.test.ts
- apps/web/src/app/today/page.tsx and existing Today tests; search exact suites
- apps/web/src/app/tasks/_lib/tasks-page-model.test.ts
- apps/web/tests/auth-session.e2e.spec.ts
- apps/web/tests/kanban-board.e2e.spec.ts
- apps/web/tests/pwa-mobile.e2e.spec.ts
- apps/web/src/components/realtime/owner-scoped-realtime-refresh.test.tsx
17. Proposed patch catalogue (the diff blocks are blueprints, not applied changes)
PATCH 0 — Region is ALREADY merged — do not create new change
Real, already merged diff in vercel.json from #338:
@@
   "git": {
     "deploymentEnabled": {
       "*": false,
       "main": true
     }
-  }
+  },
+  "regions": [
+    "dub1"
+  ]
 }
Verification command (no deploy): vercel inspect egawilldoit.online --scope egas-projects-4fb87621 and confirm READY, commit and dub1; Vercel API currently verifies this. Do not edit config again.
PATCH 1 — Move the stable shell boundary out of every page
Dependency: complete R0; classify routes; preserve public /login, /signup, /, /auth/*, /api/* and OAuth consent behavior. First pilot is /home, /today, /tasks (including nested Tasks routes only after verifying path ownership). Cross-group navigation may remount until R2; document that interim limitation.

Required file moves (example only; agent must adjust nested imports):
mkdir -p 'apps/web/src/app/(workspace)'
git mv apps/web/src/app/home 'apps/web/src/app/(workspace)/home'
git mv apps/web/src/app/today 'apps/web/src/app/(workspace)/today'
git mv apps/web/src/app/tasks 'apps/web/src/app/(workspace)/tasks'
New apps/web/src/app/(workspace)/layout.tsx (first scaffold after page <AppShell> removals; the companion contract changes are mandatory):
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

/** Shared authenticated navigation frame. Public routes stay outside group. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  // AppShell is still an async Server Component fetching the existing owner data.
  // It must NOT be duplicated inside each migrated page.
  // The header moves into page content because a shared layout is not rerendered
  // on navigation and cannot safely receive per-page title/actions props.
  return <AppShell>{children}</AppShell>;
}
On the first cold entry into the route group, the async AppShell may still block because child loading.tsx cannot cover pending data in its parent layout. Measure this specifically and, if needed, add a separate bounded Suspense fallback around the async shell-data subtree or separate stable client geometry from async owner-scoped shell data. This must not reveal logged-out navigation or private data before auth succeeds. The shell-persistence fix alone does not guarantee faster cold TTFB.

The above requires an atomic coordinated change in AppShell and WorkspaceShell contracts; it is NOT a copy-paste patch against unchanged types. AppShell must become ({children}: {children: ReactNode}), keep existing parallel fetches and existing providers and pass children to the stable WorkspaceShell. WorkspaceShell must no longer require page title or actions props; it renders <Sidebar>, <TopBar> and a {children} content outlet. It must keep collapsed, data-collapsed, desktop/mobile nav and existing accessibility semantics.

Conceptual diff inside apps/web/src/components/layout/app-shell.tsx:
 type AppShellProps = {
   children: ReactNode;
-  title: string;
-  description?: string;
-  actions?: ReactNode;
-  className?: string;
-  contentClassName?: string;
-  hideHeader?: boolean;
 };
@@
 export async function AppShell({
   children,
-  title,
-  description,
-  actions,
-  className,
-  contentClassName,
-  hideHeader = false,
 }: AppShellProps) {
   const [projects, goals, metrics, identity, favoritesResult] = await Promise.all([
     getSidebarProjects(), getSidebarGoals(), getWorkspaceShellMetrics(),
     getShellIdentity(), listFavorites().catch(() => ({ items: [], errorMessage: null })),
   ]);
@@
       <WorkspaceShell
         favorites={favorites}
         projects={projects}
         metrics={metrics}
         identity={identity}
-        title={title}
-        description={description}
-        actions={actions}
-        className={cn(className)}
-        contentClassName={contentClassName}
-        hideHeader={hideHeader}
       >
         {children}
       </WorkspaceShell>
cn becomes unused in AppShell and must be removed if no longer used. Preserve ToastProvider, shortcuts and quick actions exactly. Tests should fail on duplicate provider mounting.

Conceptual diff inside apps/web/src/components/layout/workspace-shell.tsx:
 type WorkspaceShellProps = {
   favorites?: SidebarFavorite[];
   children: ReactNode;
   projects?: SidebarProject[];
   metrics: WorkspaceShellMetrics;
   identity: ShellIdentity;
-  title: string;
-  description?: string;
-  actions?: ReactNode;
-  className?: string;
-  contentClassName?: string;
-  hideHeader?: boolean;
 };
@@
   const [collapsed, setCollapsed] = useState(false);
   const pathname = usePathname();
@@
-  <div className={cn("ega-app-shell app-shell", className)}
+  <div data-ega-shell-root className="ega-app-shell app-shell"
@@
-      <div className="app-page ega-shell-max">
-        {!hideHeader ? <header className="app-page-header">...</header> : null}
-        <div className={cn("app-content motion-rise", contentClassName)}>{children}</div>
-      </div>
+      <div className="app-page ega-shell-max">
+        <div className="app-content">{children}</div>
+      </div>
... denotes a removed existing subtree, not literal code. The agent must remove stale title/`hideHeader` references and preserve usePathname if needed elsewhere; remove unused imports. The shell root data-ega-shell-root exists in candidate only and is the stable Playwright DOM-identity marker. Global .app-content motion is intentionally moved away from the persistent root; apply optional motion to isolated new page content only, and profile.

New page-specific header (real EGA CSS class names, minimal implementation):
// apps/web/src/components/layout/workspace-page-header.tsx
"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getShellRouteMeta } from "./shell-route-meta";

export function WorkspacePageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  const route = getShellRouteMeta(pathname);
  const breadcrumb = route.href === "/home" ? "Home" : `Home › ${route.label}`;

  return (
    <header className="app-page-header">
      <div className="app-page-heading">
        <div className="app-page-eyebrow">{breadcrumb}</div>
        <h1 tabIndex={-1} data-shell-page-title className="app-page-title focus:outline-none">
          {title}
        </h1>
        {description ? <p className="app-page-description">{description}</p> : null}
      </div>
      {actions ? <div className="app-page-actions">{actions}</div> : null}
    </header>
  );
}
Use client only because this header reads pathname; if the parent page already knows current breadcrumb, implement a server version instead. Do not create client-only authenticated data fetches to show the header. Home historically has hideHeader; preserve its custom hero by not inserting WorkspacePageHeader for Home, while Today/Tasks/Timer/Review should use the page header. Preserve page-specific header/actions props, class names, and semantic landmarks.

Page migration patterns:
 // app/(workspace)/home/page.tsx (after git mv)
-import { AppShell } from "@/components/layout/app-shell";
@@
-  return (
-    <AppShell title={...} description={...} hideHeader>
-      <OwnerScopedRealtimeRefresh ... />
-      <AuthenticatedHomePage model={model} greeting={greeting} name={identity.name} />
-    </AppShell>
-  );
+  return (
+    <>
+      <OwnerScopedRealtimeRefresh ... />
+      <AuthenticatedHomePage model={model} greeting={greeting} name={identity.name} />
+    </>
+  );
This Home diff is schematic: ... means retain identical actual prop values. Remove dead fallback header expressions only after verifying model equality. Today has two <AppShell> branches; replace both. TasksWorkspaceShell is currently a thin wrapper around AppShell: convert its role into a page-only header/content wrapper, retaining its API if tests rely on it; otherwise migrate its callers and delete only after a repository search verifies no uses.

Important security nuance: A shared layout must not be the sole authorization gate. All protected page data and Server Actions/route handlers must continue to verify the user and authorization; layout server data should never be cached globally. A shared client shell might persist briefly during sign-out: ensure it immediately clears on auth transitions and protected data never leaks across accounts. Avoid a second root layout.
PATCH 2 — Replace full-shell skeletons with content-only loading
Existing issue: WorkspaceSkeletonShell draws fake sidebar/topbar and is rendered by every route loading.tsx. With persistent group layout, this must never appear on internal workspace navigation.
// NEW apps/web/src/components/layout/workspace-content-skeleton.tsx
import type { ReactNode } from "react";

export function WorkspaceContentSkeleton({ children }: { children: ReactNode }) {
  return <div data-workspace-route-loading aria-busy="true">{children}</div>;
}
Schematic diff for migrated home/loading.tsx:
-import { WorkspaceSkeletonShell } from "@/components/layout/workspace-skeleton-shell";
+import { WorkspaceContentSkeleton } from "@/components/layout/workspace-content-skeleton";
@@
 export default function HomeLoadingPage() {
   return (
-    <WorkspaceSkeletonShell title="Home" description="What to do now, what needs attention, and what to start quickly.">
+    <WorkspaceContentSkeleton>
       <div className="flex flex-col gap-8">
         <HomeGreetingSkeleton />
         <StatsRowSkeleton />
         <NowPanelSkeleton />
         <QuickActionsSkeleton />
         {/* same panel skeleton structure */}
       </div>
-    </WorkspaceSkeletonShell>
+    </WorkspaceContentSkeleton>
   );
 }
For tasks/loading.tsx preserve its task toolbar/row skeleton and add a page header skeleton using WorkspacePageHeader or appropriate noninteractive server markup. Do not indiscriminately replace all WorkspaceSkeletonShell uses before their routes live under the shared layout. workspace-route-skeleton.tsx must be split into content-only variant for migrated routes, keeping compatibility until R2. Add a source test asserting no migrated loading.tsx imports WorkspaceSkeletonShell.
PATCH 3 — Permanent shell state vs stale server data (design + test before code)
Do NOT claim a shared layout automatically updates project/favorite/notification counts. Next layouts persist between navigations, so previously server-fetched props can become stale, despite React.cache being request-scoped. A working implementation needs one verified freshness pathway:
- Distinguish stable shell geometry/state (sidebar collapsed, drawer opening, keyboard handlers, top bar) from volatile signals (timer, unread count, task counts, favorites, project names).
- Reuse the already-existing owner-scoped realtime/refresh infrastructure once PR #337 is reconciled. Test behavior of router.refresh() with Next 16 and nested layouts; do not assume normal route navigation refreshes layout data.
- If needed, introduce one lightweight, authenticated, owner-scoped shell snapshot read seam reusing existing service methods and an explicit invalidation event. Do not invent a second database schema or global state package.
- Auth identity changes and sign-out must fully reset shell state and not reuse prior owner's projects/favorites. Unavailable metrics must be marked unknown; do not show green/zero as certified truth.
- Verify realtime event bursts, tab hidden/visible catch-up, state after task mutation, timer start/stop, notification mark-read, favorite toggle, project rename. No duplicate subscriptions or refresh storm.
Illustrative event-local design only — do not add unless tests prove it's needed:
 // Existing change handler after a successful owner-scoped write, in a targeted caller:
- router.refresh(); // existing unconditional refresh path
+ // Keep existing refresh for this PR until the new shell snapshot path
+ // has proven freshness semantics, authorization, and deduplication.
+ router.refresh();
This intentionally displays no speculative production code change: changing a line without verified event semantics would break correctness. The real PR must include the exact event and refresh diff with tests.
PATCH 4 — Home: make critical content independent of analytics
Verified existing bottleneck: home/page.tsx performs five top-level calls in Promise.all, followed by an optional active-timer read. The 10 dashboard operations are parallel after prerequisite auth/time context; only real critical-path profiling tells which belongs in primary vs streamed sections.

Recommended patch shape:
-const [snapshotResult, attentionResult, user, identity, dashboard] = await Promise.all([
-  getOperatorSnapshotData(),
-  getWorkspaceShellMetricsResult(),
-  getCurrentUser(),
-  getShellIdentity(),
-  getHomeDashboardData(),
-]);
+// Separate only the data truly required to build the primary Now state.
+// Start secondary reads early, but do not await them in the primary path.
+const dashboardPromise = getHomeDashboardData();
+const [snapshotResult, attentionResult, user, identity] = await Promise.all([
+  getOperatorSnapshotData(),
+  getWorkspaceShellMetricsResult(),
+  getCurrentUser(),
+  getShellIdentity(),
+]);
+// Pass dashboardPromise to a separate Suspense-wrapped Server Component
+// that owns secondary cards, rather than blocking primary route content.
CRITICAL: This is not mechanically runnable against current buildHomeModel because the model currently consumes dashboard. Before patching, split buildHomeModel and AuthenticatedHomePage into truly independent typed primary and secondary inputs and preserve UI order, numerical exactness, error behavior and 12-week streak semantics. Use the already-streamed Activity Pulse as the reference pattern. Avoid extra refetches or a waterfall in the new model.
- Test with an intentionally delayed dashboard query: primary Now panel should be visible without waiting for secondary data.
- Test one panel failing: preserve the rest of Home and explicitly show unavailable instead of 0.
- Measure RSC flight waiting time, layout shift and server request CPU: Suspense may improve responsiveness without lowering total CPU.
PATCH 5 — Today selected task: parallelize only independent reads after authorization
Verified source: app/today/page.tsx currently executes selected-task calls in sequence (getTaskDrawerDetail, listTaskSubtasks, getTaskActivity, getTaskCommentThread, listTaskAttachments, isFavorite). This creates a candidate waterfall for selected drawer state.

Safer patch pattern (illustrative):
-const selectedTaskSubtasks = selectedTaskId
-  ? (await listTaskSubtasks(selectedTaskId)).data ?? []
-  : [];
-const selectedTaskActivityPage = selectedTaskId
-  ? await getTaskActivity(selectedTaskId, { limit: 8 })
-  : /* existing no-selection fallback */;
-// Then several other sequential awaits...
+// FIRST: keep the existing verified task detail/auth check and error path.
+// ONLY IF getTaskDrawerDetail(...).kind === "found" (same authorized owner):
+// run subtasks, activity, comments, attachments and favorite reads in parallel.
+// Preserve each service's exact error/result default separately.
+// Defer inactive drawer-tab payloads only when there is a safe fetch path.
Do not launch independent sub-reads for an invalid/nonowned task merely to save time. Do not substitute empty results for failure. Ensure list services themselves enforce owner scope. Protect the existing TaskDrawerHost props, timeline and stable returnTo URL. Tests: authorized full drawer; foreign task; missing task; one service error; rapid selection switch; query count and duration.
PATCH 6 — Sidebar row-bound/query efficiency (conditional, coordinated with #337)
Verified main-code read:
const { data: taskRows } = await supabase
  .from("tasks")
  .select("project_id, status")
  .in("project_id", projectIds)
  .neq("status", "done")
  .limit(1000);
PR #337 already proposes the narrow change .select("project_id"); do not duplicate that change if PR #337 is still under review. The 1000 cap makes per-project counts potentially inexact, and moving it into the persistent layout only reduces repeat calls: it does not fix semantics.

Candidate future change (only if query plans and data parity show improvement): existing authorized service or exact RLS-safe group counts replaces the full row projection. No SQL is prescribed here because table indexes, owner schema and the right aggregate authorization are not confirmed. Test 1001+ relevant task records, archived vs active, null project, different owner, done tasks, pinned order, and real latency.
PATCH 7 — Canonical host: remove routine cross-origin hops without redirect loops
Verified source from use-canonical-url.ts:
// On a workspace subdomain, crossing to a different module currently returns
return `${CANONICAL_ORIGIN}${route}`; // https://www.egawilldoit.online/...
Preferred design: canonical one in-app origin for normal use; keep legacy subdomains as bookmarked/deep-link entry points. One initial cross-origin navigation from a legacy subdomain cannot be eliminated by Next client-side routing. Redirect-on-entry (if needed) must be tested with real cookies, next callback, query/hash, and the PWA scope. Do not change proxy.ts blindly. Require host-matrix tests:
Entry host	Target	Intended after design
egawilldoit.online	/home → /tasks	Same-origin client navigation
www.egawilldoit.online	/tasks → /goals	Same-origin client navigation
tasks.egawilldoit.online	direct /tasks?view=board	Still opens correct board/auth; may canonicalize once
tasks.egawilldoit.online	/tasks → /timer	End up on canonical app origin, no loop, no lost state
review.egawilldoit.online	direct /review?weekOf=...	Deep link and query preserved
unknown/unowned host	any internal route	No open redirect or unexpected host rewrite


Only then propose a concrete diff across host resolver, server routing and tests. Alternative: keep subdomain URLs intentionally and accept one full reload on cross-workspace navigation. Preserve the ability to roll back host normalization independently.
PATCH 8 — Motion, accessibility and mobile stability
Verified: workspace-shell.tsx applies "app-content motion-rise" to the whole page; PR #336 added stage motion. Moving this class to page-specific, nonpersistent content avoids restarting shell animation. Compare real traces before altering global CSS.
 // apps/web/src/components/layout/workspace-shell.tsx — after persistent frame refactor
-<div className={cn("app-content motion-rise", contentClassName)}>
+<div className="app-content">
   {children}
 </div>
Do not remove all motion. Honor prefers-reduced-motion, stored setting in root HTML, focus restoration and timer visibility. Use existing tokens and classes; no new animation library. Audit mobile nav drawer, task DnD, keyboard palette, active route selection and responsive cards (320px and 390px). Maintain a11y: aria-current, meaningful pending statuses (not per-second timer announcements), focus return to drawer trigger, keyboard escape, no horizontal overflow. Each visual change belongs to a targeted PR tied to a measured regression.
18. E2E regression specifications (must be implemented against a real authenticated fixture)
Current Playwright caveat: apps/web/playwright.config.ts uses an app server with dummy Supabase env for some suites. A dummy config cannot by itself prove authenticated navigation or production Supabase flows. Find and reuse the repo's existing auth-session.e2e.spec.ts fixture, or create an explicitly authorized test-only auth fixture and an opt-in integration config. Never store or commit real session state. Do not mark a skipped test as PASS.
Example 1 — persistent DOM identity and no full navigation
// PROPOSED: apps/web/tests/workspace-navigation.e2e.spec.ts
import { test, expect } from "@playwright/test";

// Requires an authenticated test fixture / real app+test DB configuration.
// Do not run this against live production credentials in CI.
test("authenticated routes keep one shell and do not reload the document", async ({ page }) => {
  await page.goto("/home");
  const shell = page.locator("[data-ega-shell-root]");
  await expect(shell).toHaveCount(1);

  await shell.evaluate((el) => {
    (el as HTMLElement & { __shellProof?: string }).__shellProof = "same-instance";
  });

  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.resourceType() === "document") {
      documentRequests.push(request.url());
    }
  });

  for (const route of ["/today", "/tasks", "/goals", "/timer", "/review", "/home"]) {
    // Prefer actual visible nav links in a real test; raw URL navigation via
    // page.goto would INCORRECTLY force document reloads.
    const navigationLink = page.locator(`a[href="${route}"]`).first();
    await navigationLink.click();
    await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}(?:[?#]|$)`));
    await expect(shell).toHaveCount(1);
    const proof = await shell.evaluate(
      (el) => (el as HTMLElement & { __shellProof?: string }).__shellProof,
    );
    expect(proof).toBe("same-instance");
  }

  expect(documentRequests).toEqual([]);
});
Agent must adapt: Link markup may use absolute canonical URLs or trailing query parameters, so find the actual user-visible accessible nav controls and use robust locators. The new RegExp() pattern here is illustrative; prefer verifying new URL(page.url()).pathname === route for exact paths in the real test. If route group rollout covers only pilot routes, test only pilot first and extend in R2; do not label unfinished routes passing.
Example 2 — detect complete shell-skeleton regression
// After R2, within authenticated same-origin route transitions:
await expect(page.locator("[data-ega-shell-root]")).toHaveCount(1);
await expect(page.locator("[data-workspace-route-loading]")).toHaveCount(0); // AFTER settled
await expect(page.locator(".workspace-sidebar")).toBeVisible();
// Ensure full-shell fallback cannot mount during navigation:
await expect(page.locator("[aria-hidden='true'].ega-sidebar:has(.sidebar-brand-logo)")).toHaveCount(0);
For a slow-route test, intentionally delay the route's server-backed data in a controlled harness to prove the real sidebar remains clickable and a content-scoped pending state appears. A fast route with no fallback does not test the key behavior. Confirm pending state clears on success/error, no flicker on websocket refresh.
Example 3 — auth, permissions and data-isolation matrix
Scenario	Expected
Anonymous loads /home, /today, /tasks	Existing redirect/login contract; no private content flash
Valid owner on root, hard refresh	Session and owner scoped data intact
Owner signs out during delayed navigation	All private data inaccessible, shell reset; no stale owner identity
Expired cookie and token renewal	Request/response cookies refresh with no loop
Owner A attempts owner B task deep link	Denial with no subtitle/metadata leak
User changes theme Light/Dark/System	Pre-paint correctness on initial request; immediate client state after navigation
Timer starts/stops while tab is hidden/visible	Accurate session state, no duplicate timer, owner-scoped catch-up
Task changes while shell stays mounted	Count/favorite/notification state updates via documented freshness route
Direct legacy subdomain, mobile PWA	Deep link and auth stable, no origin loop or lost install scope
Data service failure	Stable chrome; error not confused with true zero/healthy


Example 4 — keyboard/mobile/UX and motion checks
- Screen widths 320, 390, 768, 1280; no unintended horizontal overflow.
- Sidebar collapse persists across pilot and later all workspace routes; mobile drawer can open immediately and closes/retains focus appropriately.
- Keyboard: Tab navigation, Enter/Space on buttons, Escape on drawer/command dialog, focused heading after shortcut, focus returns to task trigger.
- Read-only and writable task operations unchanged; saved view URL filters, board DnD and active timer work.
- prefers-reduced-motion OS override and persistent preference both respected; no required meaning conveyed by animations.
- Screenshot diff if a stable existing browser harness supports it; otherwise attach sanitized manual before/after screenshots.
19. Measurement methodology and gate for every PR
Measure after Dublin. The region has already moved; absent earlier trace, label pre-region result NOT CAPTURED. Do not compare a US-region screenshot to Dublin RSC timings and claim a causal effect without equivalent workloads.
- Same browser/device, test account, user timezone, query fixture, same origin, same cache state, same network and sample count before/after each PR; run cold and warm independently.
- Capture user-visible navigation acknowledgement, route-useful p50/p75, RSC request wait/TTFB, document navigation count, the longest server query chain, shell remount count, and browser long tasks/INP where supported.
- If Vercel Hobby only offers aggregate Active CPU, record its limits; never attribute a global change to this PR without equivalent traffic. Distinguish wall duration from CPU.
- Authenticated traces may include private task content and cookies: redact and keep outside Git, upload only summary/timing CSV free of user IDs/titles/session data.
- Sentry/PostHog instrumentation exists; do not accidentally disable or reinitialize it while adding new timings. Do not add third-party browser monitoring if its purpose is satisfied by Playwright+DevTools.
PR: #__
Main baseline SHA: __
Candidate SHA: __
Web deployment ID / region: __ / dub1
Journey + test identity class (no personal ID): __
Samples / device / network / cold-warm: __
Baseline vs candidate p50 / p75 useful-navigation ms: __ / __
Baseline vs candidate RSC wait ms: __ / __
Backend path / query counts / response bytes: __ / __
Full document navigations and shell remounts: __ / __
Browser long tasks / INP / CLS: __ / __
Vercel Active CPU comparable? YES/NO, numbers or reason: __
Functional + auth/RLS + accessibility PASS/FAIL/NOT RUN: __
CI jobs green/failed/skipped with links: __
Review threads unresolved: __
Risk + rollback: __
Recommendation: MERGE / DO NOT MERGE / BLOCKED pending approval
20. Safe commands and release process
Worktree; never touch the current dirty perf branch
git fetch origin main
git worktree add -b perf/workspace-shell-pilot ../ega-house-workspace-shell-pilot origin/main
cd ../ega-house-workspace-shell-pilot
git status --short --branch
git rev-parse HEAD
# Note: the existing ~/ega-house may be on PR #337 with temp file changes;
# never reset/clean that worktree as part of this runbook.
Search changed call sites and route tree before any move
rg -n '<AppShell|TasksWorkspaceShell|WorkspaceSkeletonShell|WorkspaceRouteSkeleton' apps/web/src
rg -n 'router\.refresh\(|getCurrentUser\(|auth\.getUser\(' apps/web/src
rg -n 'useCanonicalUrl|CANONICAL_ORIGIN|routeBelongsToWorkspace' apps/web/src
find apps/web/src/app -name page.tsx -o -name loading.tsx -o -name layout.tsx
Focused verification (commands depend on current root package scripts)
# From repo root; use existing package manager and lockfile; inspect package.json first.
pnpm --filter @ega/web test  # apps/web already defines `vitest run`
pnpm --filter @ega/web typecheck
pnpm --filter @ega/web lint
pnpm --filter @ega/web build
# Existing Playwright E2E: requires a built app, browsers, and authorized fixture.
pnpm --filter @ega/web exec playwright test tests/workspace-navigation.e2e.spec.ts

git diff --check
git diff --name-only origin/main...HEAD
Execution note: Repo may actually use a different package-manager invocation; prefer corepack pnpm ... or the root scripts verified on HEAD. The verified apps/web/package.json defines test as vitest run; the command uses that script. Check the repo root for the actual package-manager lockfile and workspace configuration before executing. On failing checks, fix the code or describe pre-existing failure. Never mark a skipped E2E suite as PASS.
Merge policy
- Agent opens PR, requests review, verifies code review comments, security audit and every required CI status.
- A change that affects auth/proxy or RLS requires explicit security review and human approval.
- No autonomous merge or production deployment under this brief.
- After an approved merge, Vercel main-only deployment is expected; validate ready revision, region dub1, smoke the route families and compare measured regression.
- Roll back only the offending PR, not PR #338, unless evidence establishes the region itself is the cause.
21. Release-wide E2E Definition of Done
- [ ] Post-`dub1` login and route-navigation smoke recorded (currently unverified).
- [ ] Reproducible post-Dublin performance baseline with actual p50/p75 and sample counts.
- [ ] One authenticated shared shell persists for the approved complete protected-route set; no duplicate providers/subscriptions.
- [ ] Loading fallbacks are scoped to changing content; normal link clicks do not rebuild faux sidebar/topbar.
- [ ] Dynamic page headers/actions and Home custom header, route metadata, searchParams, nested project routes preserved.
- [ ] Shell project/goal/favorite/task/timer/notification data stays correct after authorized mutations, including hidden-tab catch-up.
- [ ] Home primary useful content not blocked by independent analytics where refactored, with no data semantics regressions.
- [ ] Verified measured hotspots improved per route; no speculative SQL, caching, paid or framework migrations.
- [ ] Canonical host policy deliberately chosen and verified; old workspace subdomain deep links preserved.
- [ ] Desktop, mobile/PWA, keyboard, focus, reduced-motion, light/dark and screen reader checks meet agreed criteria.
- [ ] Auth renewal, sign-out, direct access, RLS/owner separation, multi-tab and failure semantics pass.
- [ ] Existing PR #337 accounted for and never silently overwritten.
- [ ] All selected PRs pass required CI and receive explicit human merge approval; rollout smoke is linked.
- [ ] Final report compares matched workloads and clearly distinguishes navigation speed from Vercel Active CPU; target ≥50% CPU is not claimed without evidence.
22. Primary sources / evidence (read before coding)
Original supplied specification: Pasted markdown(20261030-195037).md attached in this conversation and preserved/adapted in Part II above.
Current implementation: main@637cb9aa; region PR #338; overlapping PR #337.
Vercel: Function regions, Regions and compute proximity, vercel.json.
Next.js: Shared layouts and persistence, loading.tsx/Suspense, Authentication, data fetching/cache.
Supabase: Next.js SSR Auth and proxy, SQL/query optimization.
Playwright: Authenticated browser test storage and security.

Evidence limits: Only GitHub source/PR metadata and production Vercel status/region are independently verified here. No real authenticated browser navigation, SQL query plan, or post-region speedup percentage has been demonstrated. Proposed diffs must be generated, reviewed, tested and adapted by the coding agent before they become implementation evidence.