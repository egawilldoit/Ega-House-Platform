# Vercel Fluid Active CPU: context and delivery plan

Snapshot: 2026-10-30. This document separates implemented changes, observed
source behavior, proposed work, and missing runtime evidence.

## 1. What we want to achieve

Reduce EGA House web production Active CPU consumption for equivalent useful
traffic, while preserving task counts, timer calculations, owner isolation,
authentication, and realtime freshness. The working ambition is at least 50%;
it is a target, not an achieved or currently defensible forecast.

Success means less CPU for the same user journeys and data, without hiding
updates, removing useful behavior, or moving correctness defects elsewhere.
Latency, database load, browser CPU, memory billing, and Active CPU are separate
measurements; report improvements in each using the appropriate evidence.

Vercel bills Active CPU during code execution and excludes waiting on external
I/O. Therefore fewer database requests or faster responses alone do not prove
an equivalent Active CPU reduction. See [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing).

## 2. Repository and PR snapshot

- Repository: `egawilldoit/Ega-House-Platform`.
- Existing [PR #337](https://github.com/egawilldoit/Ega-House-Platform/pull/337).
- Remote branch: `perf/vercel-fluid-cpu-50`.
- Base/main observed: `1bd39c3be574c95ca120bf27a64deb200738e39f`.
- Remote PR-branch head observed: `613bc5d1312e7f0ee9814759c53d05a021f68f82`.
- Web versions recorded in the tracking document: Next.js 16.4.3, React 19.1.0.
- Existing tracking document: [fluid-cpu-50.md](fluid-cpu-50.md).
- This context document originated in the parent's docs worktree
  (`docs/fluid-cpu-context-20261030`), based on that PR head. It is now included
  in PR #337 as `docs/performance/fluid-cpu-context.md`; no separate PR.

The older tracking document records approximately 114 minutes for this project
and 180 minutes for the team over 30 days. Those are historical notes, not a
fresh billing export, a controlled baseline, or proof of the current deployment.
The current Vercel connection did not return live usage during the research.

## 3. What PR #337 already contains

### Realtime catch-up and lifecycle handling

Owner: [owner-scoped-realtime-refresh.tsx](../../apps/web/src/components/realtime/owner-scoped-realtime-refresh.tsx).

- Records pending events received while the document is hidden.
- Requests a catch-up refresh when visibility returns, coalescing queued work.
- Resets the mounted ref when the subscription effect starts again.
- Retains debounce, payload timestamp handling, filtering, and cleanup logic.

Hidden-tab suppression and the default 1000 ms debounce already existed on the
base. They must not be counted as new CPU savings introduced by this PR.
Catch-up repairs missed updates; it can increase refreshes relative to a broken
baseline that simply discarded those updates.

### Sidebar query payload reduction

Owner: [app-shell.tsx](../../apps/web/src/components/layout/app-shell.tsx).

The base already used one query for non-done tasks in the selected projects and
counted rows in JavaScript. The final change selects only `project_id` instead
of `project_id, status` and skips null project IDs while counting.

An intermediate commit tried per-project head counts. That approach is absent
from the final diff. This PR does not deliver an N-to-one request reduction,
database aggregation, RPC, migration, or persistent shell cache.

The existing limit remains 1000 task rows total across all selected projects.
Counts can undercount when that combined result exceeds the cap. This is an
existing correctness limitation, not proof of exact counts at arbitrary scale.

### Tests and documentation

The PR contains realtime tests and revised performance notes. Earlier work
reported 19 realtime tests and 13 shell tests passing. Those are prior results,
not a fresh run on this document's snapshot. The tracking document also retains
an older 18-test entry; reconcile test evidence with the final tested SHA.

The additional test described as dependency-change coverage near the end of
the realtime test file creates two different React roots. That does not prove
effect cleanup/setup on the same mounted component instance. A regression for
mounted-ref reset should rerender the same root with changed dependencies and
fail when the reset is removed.

No production CPU reduction or authenticated production acceptance is proven.
Current CI, review-thread resolution, protection, and mergeability were not
rechecked while writing this document. The previously reported security-audit
blocker must be checked live; its historical report is not a current verdict.

## 4. What the web app does today

The authenticated [Home page](../../apps/web/src/app/home/page.tsx) composes the
operator snapshot, workspace attention metrics, identity, and Home dashboard.
It subscribes to owner-scoped changes in tasks, task sessions, and week reviews.

The [Home dashboard loader](../../apps/web/src/app/home/_lib/home-dashboard-data.ts)
starts ten read helpers for project/task summaries, week sessions, deadlines,
and task previews. Helper count is not necessarily database request count.
It calculates work analytics from session rows to obtain tracked minutes.

The [analytics adapter](../../apps/web/src/lib/services/work-analytics-data-adapter.ts)
loads nested task, project, area, and goal data. This supports the general
analytics view, but Home's tracked-minutes statistic does not display all those
details. Source inspection identifies potential excess work; production
profiling is still needed to establish its cost.

`AppShell` is composed within individual pages. It loads sidebar projects/task
counts, goals, metrics, identity, and favorites. Request memoization is already
present for several reads. It does not by itself reuse results across requests.
The earlier [shell evaluation](../ui-web-v2/SHELL-PERSISTENCE-EVALUATION.md)
deferred a persistent layout. Its old route/auth assumptions need revalidation;
for example, current `/home` is an authenticated surface.

Browser-only timer ticks inspected during research update local state. They
are not evidence of one server invocation per second. Root `vercel.json` does
not declare a cron schedule; existing cron endpoints do not establish how often
an external scheduler calls them.

## 5. Work to do next

### A. Close the queued-refresh visibility gap

Observed source behavior: a visible event schedules a timeout, but the timeout
does not check visibility again before `router.refresh()`. If the tab becomes
hidden during the debounce window, the queued refresh can still execute.
The catch-up timeout has the same missing execution-time visibility check.

Smallest correction: when a queued callback runs, clear its timeout reference,
recheck visibility, and retain pending catch-up if hidden. Preserve one refresh
on return to visibility and unmount safety. Avoid redesigning subscriptions.

Proof: fake timers reproduce visible event -> hide before timeout -> no hidden
refresh -> visible -> exactly one catch-up. Cover a return-to-hidden transition
before the catch-up callback and cleanup before either callback executes.
This is a bounded correctness/performance fix; its total CPU benefit is unknown.

### B. Measure and remove redundant refreshes

Record refresh causes and server requests during task edits, timer start/stop,
review writes, navigation, event bursts, and background/foreground transitions.
Check for overlapping mutation-triggered and realtime-triggered refreshes.
Do not assume every matching owner event changes the current page, or remove
events without tracing affected displayed values and recovery requirements.

Next.js documents that [router.refresh()](https://nextjs.org/docs/app/api-reference/functions/use-router)
makes a server request and rerenders Server Components. It does not invalidate
server caches. Reducing unnecessary refreshes may avoid repeated composition;
each removed request must still leave the UI correct and fresh.

### C. Narrow Home's analytics data and computation

Profile session payload size, parse time, and analytics computation for Home.
If material, introduce the smallest summary read through the existing canonical
analytics/application owner, with an adapter implementation at the appropriate
persistence boundary. Do not duplicate timer business rules inside the page.

Prove equivalence for owner-local windows, timezone/DST boundaries, sessions
crossing a window, open-session handling, missing optional schema relationships,
and read errors. Preserve unavailable states rather than substituting zero.
Any database aggregation must retain verified identity and request-scoped RLS;
applying a hosted migration requires separate authorization.

### D. Reconsider shell persistence only after measuring it

Measure shell CPU and repeated reads across representative navigations. If
material, design a separate authenticated shared-layout change. Next.js
[reuses layouts during navigation](https://nextjs.org/docs/app/api-reference/file-conventions/layout),
but this does not promise zero shell work on explicit refreshes or fresh visits.

Define how projects, counts, favorites, identity, and per-page title/actions
stay current. Keep page/search-parameter behavior and session renewal correct.
Avoid turning the stale August evaluation into current architectural authority.

### E. Evaluate prefetching and caching selectively

Inspect production request traces for unused prefetches before changing links.
Next.js prefetch behavior varies with route type and loading boundaries;
blanket disabling can degrade navigation. Consider hover intent only for
measured waste. See [prefetching guidance](https://nextjs.org/docs/app/guides/prefetching).

`cacheComponents` is not enabled in the inspected Next configuration. Adopting
it is a separate design change, not a configuration-only CPU fix. For any
cross-request data cache, define verified-owner/authorization partitioning,
freshness, invalidation, logout/account-switch behavior, and failure semantics.
Never place an authenticated response in an unpartitioned shared cache. Next.js
requires request APIs to be handled outside ordinary cached scopes; see
[use cache](https://nextjs.org/docs/app/api-reference/directives/use-cache).

## 6. Baseline and estimation method

Before promising savings, collect an exact deployment SHA and a comparable
observation window. Use Vercel's available Function Invocations metrics for
Active CPU Time and invocation count, grouped by route where supported. Include
middleware CPU separately and filter environment, deployment, and time window.
Availability depends on the team's metrics access. See the
[Vercel query reference](https://vercel.com/docs/query/reference).

For each candidate, record:

- Total Active CPU, invocation count, and average CPU per invocation.
- Completed user journeys and refresh requests per journey.
- Route mix, data volume, cold/warm conditions, errors, and latency.
- Relevant payload size and database request count as supporting measurements.

Use repeated equivalent journeys with the same owner/data and realistic event
bursts. Report both total CPU per journey and per-request CPU: lowering one can
hide an increase in the other. Separate a controlled experiment from an
observational production comparison and disclose changes in traffic or data.

Estimated total saving equals the measured CPU share affected multiplied by
the measured fraction of that work eliminated. Do not add overlapping estimates
for refresh suppression, shell reuse, and smaller payloads. The present evidence
supports no numeric savings forecast for PR #337 or the proposed follow-ups.

## 7. Delivery sequence and acceptance

1. Finish the small realtime visibility and test-sensitivity fixes on #337.
   Keep its description honest about the final query delta and unmeasured CPU.
2. Establish the baseline and identify the dominant actual CPU contributors.
3. Implement one measured candidate at a time, starting with redundant refreshes
   or Home's analytics work if the measurements justify them.
4. Consider shell persistence or broader caching in separate scoped changes.
5. After explicitly authorized deployment, verify the exact revision and compare
   equivalent traffic. Publish achieved savings with the raw measurement scope.

Each behavioral change needs a regression that fails before the fix, the
narrowest affected checks, and relevant authenticated browser journeys.
Verify owner isolation, session renewal, task counts, timer totals, realtime
catch-up, navigation, and failure states where affected. Local tests, current
CI, review, merge, deployment, and production acceptance are separate claims.

This context document authorizes no merge, deployment, hosted schema change,
security exception, auth-policy change, or weakening of CI/protection. Preserve
unrelated work, including the existing `supabase/.temp/cli-latest` modification.

## 8. Assessment of both proposed optimization plans

All source statements below refer to the PR head in section 2. A source-level
candidate is not a measured billing contributor. In particular, neither
"Home is the hot path" nor "RSC refreshes dominate CPU" has been established
by route usage. Refresh work is a plausible candidate, not a proven ranking.

### Billing, traffic, and measurement

1. **Active CPU versus database wait: keep the distinction.** Parsing results,
   transforming data, rendering, and serialization can consume CPU. Reducing
   SQL wait alone primarily changes latency and potentially memory occupancy.
   Track Active CPU, Provisioned Memory, invocations, database work, and latency
   independently. Historical 114/180-minute figures are not an experiment.
   Subtracting them gives approximately 66 minutes only if both observations
   share the same meter, window, and project/team scope.
2. **Usage export and route attribution: first measurement task.** Capture the
   deployment SHA, environment, window, invocation counts, CPU totals, route
   mix, and successful journeys. Include Proxy and API traffic rather than
   assuming UI renders explain all usage. Seven-day before/after windows can
   help, but equal duration does not ensure equivalent traffic; use controlled
   journeys as well. Do not infer a production result from a local benchmark.
3. **Instrumentation: useful with attribution limits.** Count refresh causes,
   table/event categories, coalesced events, hidden catch-ups, mutation
   refreshes, and actual server requests. Use sampled diagnostics without
   tokens, task contents, or raw realtime payloads. Loader elapsed time is wall
   time, not Active CPU. Process CPU deltas can include concurrent requests and
   should not be presented as per-request billing. Prefer Vercel's CPU meter
   for the savings claim; instrumentation itself must remain inexpensive.
4. **Savings percentages: withdraw unsupported forecasts.** Neither a 50%
   outcome for #337 nor a 30–60% realtime saving is supported yet. A useful
   estimate needs measured affected CPU share and measured work avoided.
   Compare CPU per useful journey as well as CPU per invocation; removing cheap
   requests can increase the latter while reducing total consumption.

### Realtime and refresh frequency

5. **Full refresh: confirmed mechanism, unmeasured contribution.** The component
   calls `router.refresh()`, which requests and rerenders Server Components;
   this does not mean every client component remounts or every data read must
   miss a cache. Existing 1000 ms coalescing means a burst need not generate one
   request per event. Start by tracing duplicate work between mutation results,
   redirects/revalidation, and subsequent realtime events. See
   [router.refresh semantics](https://nextjs.org/docs/app/api-reference/functions/use-router).
6. **Visibility policy: keep catch-up and fix the queued callback race.** Section
   5A describes the concrete remaining gap. Blur and typing suppression are
   separate product freshness choices; they should not silently freeze an
   apparently live timer or task list. No event may disappear permanently.
7. **Longer or adaptive debounce: conditional experiment.** Do not immediately
   replace 1000 ms with 3–5 seconds. Measure event bursts and establish an
   acceptable visible-update delay first. Prove eventual reconciliation and
   acceptable timer start/stop behavior. A longer delay may save nothing when
   events are already spaced apart.
8. **Timer heartbeat filtering: premise not found.** The browser's
   [live duration](../../apps/web/src/components/timer/live-duration.tsx) interval
   updates local state. The inspected timer service has start/stop/edit writes,
   not a demonstrated one-second database heartbeat. Do not drop UPDATE events:
   stopping or correcting a session is an UPDATE users need to see. External
   writers and their frequencies remain a runtime evidence gap.
9. **Page-specific subscriptions: already partly implemented.** Home listens to
   `tasks`, `task_sessions`, and `week_reviews`; Today listens to tasks and
   sessions; [TimerPageView](../../apps/web/src/app/timer/_components/TimerPageView.tsx)
   listens only to sessions. Only these three consumers of this component were
   found. There is no demonstrated need for a new shared realtime bus. Narrow
   further only after mapping events to every affected badge, list, and timer.
10. **Partial client updates: possible, larger change.** First use existing
    mutation/state patterns. If measurements justify it, prototype one bounded
    slice with authoritative reconciliation, out-of-order/duplicate/deleted
    events, reconnect recovery, cross-device writes, and owner switching.
    A new SWR/React Query dependency or second store is not automatically needed.
    A smaller fetch can still add invocations; compare the whole journey.
11. **Tagged invalidation is not partial rendering.** `revalidateTag` invalidates
    previously tagged server-cache entries; it does not directly patch a browser
    section or make `router.refresh()` partial. The recommended `max` profile
    permits stale data while revalidating. It requires a caching and freshness
    design, including writes from mobile/agents that bypass web Server Actions.
    See [revalidateTag](https://nextjs.org/docs/app/api-reference/functions/revalidateTag).

### Shell, aggregation, Home, and authentication

12. **Sidebar counts: fix the cap as correctness work.** The final PR retains
    one row-fetch query, the JS loop, and a combined 1000-row cap. Prefer a
    bounded grouped result if the existing database capability permits it;
    otherwise design a small request-scoped RLS-preserving aggregate through
    the canonical data-access boundary. Preserve predicates, zero-count projects,
    and null handling. The existing task-count read also ignores its query error
    and can turn a failed read into zero counts; define and render an unavailable
    state instead of carrying that behavior into the replacement. Prove totals above 1000 rows,
    multiple projects, and cross-owner isolation. Do not assume reducing
    returned rows reduces the database's counting work.
13. **One grouped head-count request: correct the proposed API.**
    `count: "exact", head: true` returns an overall count without a row body;
    it cannot return `{ project_id, count }` rows for every project. Choices are
    a grouped response/RPC/view or separate filtered count requests. Benchmark
    fan-out before adopting it. PostgREST supports aggregation, but its documented
    default is disabled; do not assume the hosted configuration supports it or
    enable it as part of this audit. Views/functions need explicit permissions
    and RLS review, including invoker/definer behavior. See
    [Supabase count](https://supabase.com/docs/reference/javascript/select) and
    [PostgREST grouping](https://docs.postgrest.org/en/v12/references/api/aggregate_functions.html).
14. **Request memoization: present, not universal.** Sidebar projects/goals and
    shell metrics use React `cache()`. `getSessionUser` is cached, while
    `getShellIdentity` derives from it. `listFavorites` is not memoized and can
    read favorites plus referenced tasks/projects. The statement that every
    shell read is memoized is inaccurate. A call appearing twice also does not
    prove two requests: inspect cache hits and arguments before changing it.
15. **Sticky shell versus cross-request cache: evaluate separately.** Moving
    page-composed AppShell into a shared layout could avoid some navigation work;
    a short-TTL cache could reuse reads across requests. Neither is a trivial
    replacement for the other, and cross-host navigation can lose client layout
    reuse. Define freshness for counts, identity, favorites, and project lists.
    Verify session renewal and page-specific titles/actions before restructuring.
16. **Per-owner TTL/tag caching: conditional, not inherently low risk.** Verify
    identity and current authorization before cache access; partition by owner
    and every relevant input, including timezone and time window. Owner ID alone
    is not an authorization check. Keep cookie-bearing clients out of shared
    state. Account for task status changes, timer stop, favorites, timezone edits,
    midnight/week rollover, logout, revocation, and external writers. A 15–60 s
    stale result needs an explicit product contract; timer state may need a
    different policy. `cacheComponents` is currently absent from Next config.
17. **Deduplicate Home/shell metrics: inspect semantic overlap.** Home already
    shares the request-cached workspace metrics result. Its other ten helpers
    are not automatically ten redundant queries. Combine only equivalent owner,
    timezone, status, archive, and deadline rules through their canonical owner;
    similarly named counts may represent different requirements.
18. **Home session analytics: concrete payload candidate.** Home computes
    `totalWorkedMinutes` using the general analytics session adapter, including
    nested information not displayed by that statistic. Profile payload and
    calculation, then narrow the read/calculation while proving the equivalence
    cases in section 5C. A database SUM is not automatically equivalent to session
    clipping, rounding, timezone, or exclusion rules.
19. **Suspense and client fetching: latency tools, not automatic CPU savings.**
    Home already streams its Activity section, but dashboard tracked-minutes
    analytics runs before the dashboard result returns. Wrapping more work in
    Suspense changes when it arrives; it does not remove that work. Fetching a
    section later saves server CPU only if work is avoided, reused, or made
    cheaper; otherwise it can add a second request.
20. **Select narrowing and synchronous transforms: retain as measured hygiene.**
    #337 removes one unused column. Investigate large nested session payloads
    before tiny maps, provider code, or speculative date-library replacements.
    Keyboard shortcuts, toast providers, and local timer ticks are primarily
    browser work unless they trigger server calls; browser savings must not be
    reported as Vercel Active CPU savings.
21. **Auth/client duplication: there is a specific audit target.**
    [auth-service](../../apps/web/src/lib/services/auth-service.ts) already shares
    default `getCurrentUser()` through request-scoped `getRequestUser`. Explicit
    client calls bypass that sharing. Favorites uses
    `getAuthenticatedUserId(client)`, which calls `auth.getUser()` directly.
    Trace and count actual verifications before consolidating through the
    existing verified-identity seam. Time Context already has a request-memoized
    repository. Never optimize by trusting `getSession()` alone, skipping
    verification, or reusing a cookie-bearing Supabase client globally.

### Navigation, Proxy, public routes, and platform settings

22. **Prefetch: candidate, not a blanket switch.** Sidebar links use Next Link
    defaults, and Home/Tasks/Timer and many other routes have loading boundaries.
    Next documents that dynamic routes without Cache Components are skipped
    unless a loading boundary permits prefetching. Inspect actual prefetched
    segments and unused requests; test selective disabling or hover intent only
    where waste exists. The canonical URL resolver also creates cross-origin
    links from workspace subdomains, which need separate navigation traces.
    See [prefetch behavior](https://nextjs.org/docs/app/guides/prefetching).
23. **Proxy asset exclusions: already implemented.**
    [proxy.ts](../../apps/web/src/proxy.ts) excludes `api`, `_next/`, favicon,
    and paths containing a dot. Root public paths return before auth verification;
    protected paths/hosts run `getClaims()` and preserve session cookies. Do not
    widen exclusions to save CPU without testing protection, subdomain routing,
    and refresh-cookie persistence. No loose-asset-matcher defect was found.
24. **Static public home/login: behavior change required.**
    [root page](../../apps/web/src/app/page.tsx) reads user/preferences to redirect
    signed-in users. [Login](../../apps/web/src/app/login/page.tsx) creates an auth
    client and checks the user before rendering. They are not currently pure
    static marketing pages. A separate public static surface is possible, but
    preserve authenticated redirects deliberately. Authenticated dynamic pages
    cannot safely be put in a shared CDN cache merely to avoid execution.
25. **Bots and Firewall rules: evidence first.** Establish which routes consume
    CPU and whether traffic is abusive. Broad `/api` or auth blocks can break
    legitimate agents, mobile, OAuth callbacks, integrations, and schedulers.
    Public-route CPU and bot volume are unmeasured; this audit changes no hosted
    security policy. Prefer existing protections and narrowly justified rules.
26. **Previews: configured restriction, not proof of zero traffic.** Root
    [vercel.json](../../vercel.json) disables automatic Git deployments outside
    main and ignores non-main builds. This does not prove no existing/manual
    preview is invoked. Filter usage by environment. A preview experiment needs
    a deployment path consistent with that policy, not an assumed automatic PR
    preview. Neither deployment policy nor hosted settings were changed.
27. **Fluid, memory, region, maxDuration: verify hosted state first.** The root
    config does not establish the deployed Fluid flag, region, allocation, or
    actual deployment SHA. Region primarily affects I/O latency. Lowering
    maxDuration is a timeout change, not a CPU optimization. Current official
    guidance says Hobby cannot configure memory size; Pro/Enterprise allocation
    changes affect CPU and memory together. Profile the tradeoff rather than
    prescribing lower memory. No redeployment is authorized by this report.
    See [memory/CPU configuration](https://vercel.com/docs/functions/configuring-functions/memory).

### Runner, API traffic, cron, and background work

28. **Runner polling: distinguish destination and deployment.** Runner source
    includes GitHub/Linear/Vercel API calls and database lease/queue heartbeats.
    Those do not establish a polling loop against the web app. VM placement and
    live schedules require operational evidence. Calls to Vercel's management
    API are not calls executing this app's route handlers. Audit actual agent,
    mobile, and integration request volumes before relocating any workload.
29. **Do not bypass mobile/agent boundaries.** Sending mobile directly to
    Supabase/PGMQ to avoid function calls conflicts with the repository's
    application/contracts/API authority model. Preserve verified identity,
    authorization, audit, and queue lease semantics. Reduce redundant polling
    at its caller, use backoff or event-driven delivery when justified, and
    retain required boundaries. Moving a handler to another service changes
    where compute is paid; it does not itself eliminate work. There is also an
    [Hono Vercel configuration](../../apps/server/vercel.json), so moving work to
    Hono alone does not establish that Vercel billing disappears.
30. **Cron and server intervals: account for actual invocations.** No schedule
    appears in root Vercel config, but external callers of cron endpoints remain
    unknown. Browser intervals are not server invocations. Separately,
    [agent rate limiting](../../apps/web/src/lib/services/agent-rate-limit-service.ts)
    uses a 60-second cleanup interval with `unref()` in API-serving instances;
    this is server work, not evidence of constant hourly billed execution.
    Inspect it only if profiles show meaningful cost; keep rate limiting intact.

## 9. Concrete work packages and release boundary

| Order | Deliverable | Evidence required before expanding scope |
| --- | --- | --- |
| 1 | Finish #337 visibility callback guard and meaningful same-root lifecycle regression; reconcile final docs/test counts | Regression fails before fix; narrow realtime/shell checks; current-head review and CI independently checked |
| 2 | Capture route/Proxy/API CPU baseline and refresh causes for representative journeys | Exact deployment and environment; CPU/journey, invocations, memory, latency; no sensitive payload logging |
| 3 | Correct sidebar count cap through a bounded aggregate at the existing data boundary | More than 1000 tasks, zero-count projects, predicates, failure state, owner isolation; DB plan and permissions reviewed |
| 4 | Narrow Home tracked-minutes payload/calculation if profiling supports it | Equivalent totals at time boundaries; compare bytes, CPU/journey, latency and DB load |
| 5 | Remove proven redundant mutation/realtime refreshes; trial one partial slice if necessary | Start/stop/edit, external writes, reconnect, duplicate/out-of-order events, hidden catch-up; fewer requests with freshness preserved |
| 6 | Trial selective prefetch controls only on measured waste | Production-mode request traces and navigation latency, including workspace hosts |
| 7 | Decide shared layout and/or owner-partitioned caches in a separate design | Written freshness/invalidation contract; logout/revocation/external-write cases; measured benefit |
| 8 | Address bots, schedules, API polling, or platform allocation only where metrics identify them | Caller/environment attribution, preserved contracts and separately authorized hosted changes |

Orders 2–8 are follow-up work, not claims about changes already in #337. Sidebar
count correctness need not wait for a CPU-saving forecast; complex caching and
client-state changes should wait for measurement. Do not label #337 ready to
merge solely from this source audit: its outstanding regression, current checks,
review state, and protection must be assessed separately. Keep it unmerged as
requested. Production usage is still inaccessible in this research, so no
numeric reduction or completed production experiment is claimed.
