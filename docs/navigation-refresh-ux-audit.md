# Navigation And Refresh UX Audit

Date: 2026-05-31
Scope: Static re-review of app navigation, login redirects, realtime refresh behavior, server-action redirects, and navigation-only forms.

## Summary

This audit has been updated against the current codebase. Several findings from the previous version are now partially or fully addressed:

- Workspace subdomain middleware no longer rewrites known global routes such as `/dashboard` into invalid workspace-prefixed routes.
- The main sidebar, app launcher, top-bar shell signals, and workspace keyboard shortcuts now resolve cross-host destinations with `useCanonicalUrl()`.
- Login now uses app-router navigation for same-origin redirects.
- Realtime refresh debounce was increased to `1000ms`, hidden tabs are skipped, duplicate refresh bursts are guarded, and event filtering exists.
- Workspace revalidation paths are normalized to pathnames and deduplicated.
- The project "New Project" navigation-only forms were replaced with `Link`.

Some UX risks still remain:

- Several page-level and sidebar project links are still raw root-relative links. On workspace subdomains, those can still be rewritten into invalid paths if clicked from the wrong host.
- Login still performs full document navigation when the safe redirect target is on a different platform host, including workspace subdomains.
- Realtime still uses `router.refresh()` on broad page surfaces, so Dashboard, Today, and Timer can still rerender the full RSC route tree after task/session events.
- Revalidation is deduped, but still broad by mutation type.
- Some GET forms are still used for filter/date/navigation flows.

Important distinction: `router.refresh()` is not the same as `window.location.reload()`. It does not reload the browser document. But because the app shell and pages are server-rendered and data-heavy, `router.refresh()` can still look like a page refresh to the user: panels rerender, scroll/focus can shift, pending states reset, and data fetches repeat.

## Status After Re-review

| Priority | Issue | Status | User impact |
| --- | --- | --- | --- |
| High | Subdomain navigation rewrite can produce invalid internal routes. | Partially fixed | Main shell paths are safer, but remaining raw links can still break cross-workspace navigation on subdomains. |
| Medium | Login uses hard navigation for cross-host platform redirects. | Partially fixed | Same-origin login is app-router based; cross-host login still reloads the document. |
| Medium | Realtime refresh calls `router.refresh()` on broad page surfaces. | Partially fixed | Refresh is moderated, but broad RSC rerenders still occur after task/session events. |
| Medium | Workspace mutations over-invalidate broad workspace routes. | Partially fixed | Duplicate/query invalidation is fixed; invalidation scope is still broad. |
| Low | Navigation-only and filter forms use native navigation. | Partially fixed | Project create links are fixed; selected GET filter/date flows remain. |

## Finding 1 - Residual Subdomain Navigation Links Can Still Break Routes

Priority: High

### Files

| File | Lines | Current state |
| --- | --- | --- |
| `src/middleware.ts` | 17-32, 205-235, 238-258 | Known global routes now redirect to the canonical root host instead of being rewritten. Workspace-prefixed routes are still rewritten as designed. |
| `src/lib/use-canonical-url.ts` | 1-105 | Client-side resolver returns canonical absolute URLs for routes outside the current workspace subdomain. |
| `src/components/layout/sidebar.tsx` | 151, 187-190, 206-250, 279-283 | Core and general items use `useCanonicalUrl()`, but project links still use raw `/tasks...` hrefs. |
| `src/app/apps/apps-launcher-grid.tsx` | 33-83 | App launcher uses `useCanonicalUrl()`. |
| `src/components/layout/shell-signals.tsx` | 110-122 | Top-bar signal links use `useCanonicalUrl()`. |
| `src/components/layout/workspace-keyboard-shortcuts.tsx` | 62, 94-99 | Keyboard shortcuts use `useCanonicalUrl()`. |
| Multiple page components | Various | Many page-level links still use raw root-relative app routes. |

### What is fixed

Middleware now treats global app routes as canonical-root routes. On workspace subdomains, paths such as `/dashboard`, `/today`, `/apps`, `/settings`, `/startup`, and `/shutdown` are redirected to `https://www.egawilldoit.online/...` instead of being rewritten under the workspace prefix.

The main shell navigation also resolves links through `useCanonicalUrl()`, so routes outside the current workspace subdomain become canonical absolute URLs.

### What is still open

Not every app link uses the canonical resolver. Examples include:

- Sidebar project links such as `/tasks/projects/new`, `/tasks?project=...`, and `/tasks/projects`.
- Page-level cross-workspace links such as Timer to Tasks, Dashboard to Timer/Tasks/Review/Goals, Today to Timer/Tasks, Startup/Shutdown to Today/Review/Timer, and similar links.

These links are safe on the root host. They can be unsafe on workspace subdomains if the current host prefix does not match the target route.

Example:

1. User is on `timer.egawilldoit.online`.
2. User clicks a raw link to `/tasks`.
3. Middleware sees host `timer.egawilldoit.online` and prefix `/timer`.
4. `/tasks` does not start with `/timer`.
5. Middleware can rewrite it to `/timer/tasks`.
6. `/timer/tasks` is not a real route.

### Recommended fix

Keep the canonical-host behavior already added, then finish applying it consistently.

- Use `useCanonicalUrl().resolve(...)` for client-rendered links that can point outside the current workspace subdomain.
- For server components that render cross-workspace links, introduce a small shared `CanonicalLink` client wrapper or a server-safe helper fed by host context.
- At minimum, fix remaining shell/sidebar project links first because they are visible from every workspace route.
- Add a regression test that scans or renders key navigation surfaces and verifies cross-workspace hrefs become canonical on workspace subdomains.

### Acceptance checks

- From `tasks.egawilldoit.online`, Dashboard reaches the canonical app host, not `/tasks/dashboard`.
- From `timer.egawilldoit.online`, Tasks reaches the real Tasks route, not `/timer/tasks`.
- Sidebar project links are host-aware.
- Page-level CTA links that cross workspace boundaries are host-aware.
- Keyboard shortcuts and app launcher links continue to navigate to canonical destinations.

## Finding 2 - Login Still Hard Navigates For Cross-host Platform Redirects

Priority: Medium

### Files

| File | Lines | Current state |
| --- | --- | --- |
| `src/middleware.ts` | 112-121, 189-193, 218-222 | Middleware still builds `/login?next=<absolute-url>` using the original protected host. |
| `src/app/login/login-form.tsx` | 10-28, 63-74 | Safe same-origin redirects use `router.replace()` and `router.refresh()`; safe different-origin platform URLs use `window.location.assign()`. |
| `src/app/login/login-form.test.ts` | 1-127 | Tests cover relative, platform absolute, unsafe external, and cross-subdomain redirect classification. |

### What is fixed

Same-origin login redirects no longer hard navigate. If `next` resolves to the current origin, login uses:

```ts
router.replace(path);
router.refresh();
```

Unsafe external redirects are still rejected.

### What is still open

Middleware stores an absolute `next` URL using the original protected host. When login is served from `www.egawilldoit.online`, a protected request from `tasks.egawilldoit.online` or another workspace host still produces a different-origin safe platform redirect. `LoginForm` then uses:

```ts
window.location.assign(safeRedirect.href);
```

That is intentional for true host switches, but it is still a full document navigation.

### Why it hurts UX

Cross-subdomain login throws away the current document and reloads from the network. That may be necessary for some host transitions, but the current behavior does not distinguish between host switches that are required and host switches that could be normalized to canonical app routes.

### Recommended fix

Normalize safe platform URLs more aggressively when the target can be represented on the canonical app host.

Suggested behavior:

- Same-origin target: keep `router.replace(pathname + search + hash)` and `router.refresh()`.
- Canonical app host target from canonical login host: use app-router navigation.
- Workspace subdomain target that maps to the same route on the canonical host: consider routing to canonical path through the app router.
- Different platform subdomain target that genuinely must switch host: keep `window.location.assign()`.

Also consider changing middleware to store a relative `next` path when the login host can serve the protected route after canonicalization.

### Acceptance checks

- Login from `/dashboard` redirects with app-router navigation.
- Login from `/tasks?status=blocked` preserves query params.
- Unsafe external `next` values remain blocked.
- Cross-host redirects only hard navigate when a host switch is required.
- Workspace-subdomain login redirects that can be canonicalized do not unnecessarily hard navigate.

## Finding 3 - Realtime Refresh Still Reloads The Full RSC Route Tree

Priority: Medium

### Files

| File | Lines | Current state |
| --- | --- | --- |
| `src/components/realtime/owner-scoped-realtime-refresh.tsx` | 12-130 | Debounced realtime refresh is moderated but still calls `router.refresh()`. |
| `src/app/today/page.tsx` | 117-121 | Today subscribes to `tasks` and `task_sessions`. |
| `src/app/dashboard/_components/DashboardOptimizedView.tsx` | 472-476 | Dashboard subscribes to `task_sessions` and `tasks`. |
| `src/app/timer/page.tsx` | 165-169 | Timer subscribes to `task_sessions`. |
| `src/components/layout/app-shell.tsx` | 86-107 | App shell refetches sidebar projects, goals, and shell metrics on route refresh. |
| `src/lib/workspace-shell.ts` | 120-204 | Shell metrics execute multiple Supabase reads. |
| `src/components/realtime/owner-scoped-realtime-refresh.test.tsx` | 168-480 | Tests cover debounce, hidden-document skip, cleanup, and event filtering. |

### What is fixed

The realtime refresh component now includes several moderation improvements:

- Default debounce is `1000ms`.
- Hidden documents skip refresh.
- Duplicate refresh bursts are guarded while a timeout is queued.
- Table/event filtering is available.
- Cleanup clears pending timeouts and unsubscribes.

### What is still open

Realtime events still refresh the entire current route tree. In this app, that includes `AppShell`, which reloads:

- Sidebar projects
- Sidebar goals
- Shell metrics
- Page-level server data

Server actions also call `revalidateWorkspaceFor()` and redirect back to the return path. If the same write emits a realtime event, the user can still get both:

1. Mutation redirect/revalidation.
2. Realtime `router.refresh()`.

### Why it hurts UX

Small updates can still make the workspace feel unstable. A user marking a task done, starting a timer, or editing Today may see broad rerenders instead of a small local update.

### Recommended fix

Keep the existing moderation and move toward narrower updates.

Short-term improvements:

- Add own-write suppression after local server-action submissions.
- Configure `eventFilter` at call sites where only specific table/event combinations matter.
- Consider page-specific debounce values for high-churn surfaces.
- Avoid shell metric refetches for task/session events that do not affect shell signals.

Better long-term direction:

- Move highly volatile data into client-owned state for the active page.
- Let realtime update only the affected task/session in local state.
- Keep `router.refresh()` as a stale-data fallback rather than the primary update mechanism.

### Acceptance checks

- Starting a timer updates the active timer surface without duplicate visible rerenders.
- Another device changing a task still updates the current page within a reasonable delay.
- Dashboard shell does not refetch projects/goals for every task/session event unless required.
- Realtime tests cover debounce, hidden-document behavior, event filters, own-write suppression, and unsubscribe cleanup.

## Finding 4 - Mutations Are Deduped But Still Broadly Invalidate Workspace Routes

Priority: Medium

### Files

| File | Lines | Current state |
| --- | --- | --- |
| `src/lib/workspace/workspace-navigation.ts` | 41-100, 135-145 | Return paths are normalized to pathnames and deduplicated before `revalidatePath()`. Mutation path sets are still broad. |
| `src/lib/workspace/workspace-navigation.test.ts` | 166-495 | Tests cover deduplication and query-string removal. |
| `src/app/tasks/actions.ts` | Multiple | Task mutations call `revalidateWorkspaceFor("task", ...)`. |
| `src/app/today/actions.ts` | Multiple | Today mutations call `revalidateWorkspaceFor("today", ...)`. |
| `src/app/timer/actions.ts` | Multiple | Timer mutations call `revalidateWorkspaceFor("timer", ...)`. |
| `src/app/startup/actions.ts` | 33, 51 | Startup mutations invalidate multiple workspace paths. |
| `src/app/shutdown/actions.ts` | 32, 47 | Shutdown mutations invalidate multiple workspace paths. |

### What is fixed

The previous duplicate invalidation issue is fixed. `returnTo = "/tasks?status=blocked"` now normalizes to `/tasks`, and `/tasks` is revalidated only once. Query strings are not passed to `revalidatePath()`.

### What is still open

The path sets are still broad. For example, a task mutation invalidates:

- `/tasks`
- `/tasks/projects`
- `/dashboard`
- `/today`
- `/timer`
- `/review`

Timer, Today, Startup, and Shutdown mutations also invalidate several major surfaces.

The tests currently assert this broad behavior, so this is intentional design rather than an accidental typo.

### Why it hurts UX

Common actions become heavier than needed:

- Mark done
- Pin/unpin
- Start timer
- Stop timer
- Add/remove Today task
- Archive/restore

These actions often need only the current surface and one or two aggregate surfaces updated. Broad invalidation makes subsequent navigation and route refreshes heavier.

### Recommended fix

Preserve the dedupe/normalization fix and split broad mutation types into narrower events.

Suggested changes:

- Keep pathname normalization and deduplication.
- Split mutation types into narrower events, for example:
  - `task-create`
  - `task-inline-update`
  - `task-archive`
  - `timer-start`
  - `timer-stop`
  - `today-plan-update`
- Invalidate only the current return path plus surfaces with known derived data.
- Keep broad invalidation only for mutations that genuinely affect dashboard/review/timer aggregates.

### Acceptance checks

- `revalidateWorkspaceFor()` never calls `revalidatePath()` twice for the same path.
- Query strings are not passed to `revalidatePath()`.
- Task inline updates do not invalidate Review unless review data actually depends on that update.
- Timer stop still invalidates Timer, Dashboard, Today, and Review if those surfaces use timer summary data.
- Tests distinguish narrow and broad mutation classes.

## Finding 5 - Some GET Navigation And Filter Forms Remain

Priority: Low

### Files

| File | Lines | Current state |
| --- | --- | --- |
| `src/app/tasks/projects/page.tsx` | 191-194, 378-380 | Project creation navigation now uses `Link`. |
| `src/app/review/week-selector.tsx` | 26-43 | Week date selection uses a native GET form. Prev/Next use `Link`. |
| `src/app/ideas/page.tsx` | 202-208 | Ideas filters use a native GET form. |
| `src/app/settings/account/page.tsx` | 93-99 | Google Calendar connect uses a GET form to an API integration route. This may be appropriate because it starts an external OAuth flow. |

### What is fixed

The clearest navigation-only project forms were replaced with `Link`.

### What is still open

Some GET forms remain for filter/date/navigation flows. These are not automatically wrong:

- Review week selector benefits from progressive enhancement.
- Ideas filters can work without JavaScript.
- Google Calendar connect is an OAuth/API route and should not be treated as a simple app-router page navigation without checking the integration flow.

### Why it hurts UX

Native GET form submissions can feel less smooth than app-router navigation for filter/date changes. They can also reset client state more aggressively than a client component using `router.replace()`.

### Recommended fix

- Keep GET fallback where progressive enhancement matters.
- Add client enhancement for Review week selection if it should feel instant.
- Add client enhancement for Ideas filters if preserving UI state matters.
- Leave the Google Calendar connect flow alone unless OAuth behavior is explicitly redesigned.

### Acceptance checks

- "New Project" continues to navigate through `Link`, not a form submit.
- Week selector still works without JavaScript if progressive enhancement is required.
- With JavaScript enabled, week selection can update through App Router navigation.
- Ideas filters preserve expected query params and view state.
- Google Calendar connect still starts the OAuth flow correctly.

## Additional Improvement Opportunities

These are not the main reload issues, but they would improve app feel.

### Make shell data less volatile

`AppShell` fetches projects, goals, and metrics on each server render. This is convenient, but it amplifies every route refresh.

Recommended direction:

- Move shell metrics into a small client island that refreshes independently.
- Keep sidebar projects/goals stable unless task/project/goal mutations require them.
- Consider caching or tagging shell reads if the app moves deeper into Next cache tags.

Files:

- `src/components/layout/app-shell.tsx`
- `src/lib/workspace-shell.ts`

### Preserve local UI state around mutations

Inline task edits, Today actions, and timer actions often redirect back to the same path. The app should preserve scroll, focused task, expanded cards, selected tabs, and sheet state where possible.

Files:

- `src/components/tasks/inline-task-update-form.tsx`
- `src/components/tasks/task-kanban-card.tsx`
- `src/components/tasks/quick-task-sheet.tsx`
- `src/components/today/today-task-card.tsx`
- `src/components/timer/timer-stop-form.tsx`

### Add browser-level regression tests

Static inspection can identify likely reload patterns, but the strongest proof is an end-to-end test that detects document reloads.

Recommended Playwright checks:

- Start from Dashboard and click shell navigation. Assert no invalid prefixed route appears.
- Start from a workspace subdomain and click page-level links that cross workspace boundaries. Assert canonical destinations.
- Add a listener for `beforeunload` or track a `window.__docLoadId` marker to detect full document reloads.
- Submit login with `next=/dashboard` and assert no full document reload.
- Submit login with a workspace-subdomain `next` and assert hard navigation only when expected.
- On Today, perform a task action and assert URL, scroll, and visible state remain stable.

## Recommended Fix Order

1. Finish host-aware navigation for remaining raw cross-workspace links.
2. Tighten login redirect normalization for platform URLs that can be canonicalized.
3. Split broad revalidation mutation types into narrower invalidation classes.
4. Add realtime own-write suppression and configure filters at call sites.
5. Enhance remaining GET filter/date forms only where the smoother app-router behavior is worth the complexity.
6. Add Playwright coverage to prevent regressions.

## Suggested Implementation Slices

### Slice 1 - Finish host-aware navigation

Files likely touched:

- `src/components/layout/sidebar.tsx`
- `src/components/layout/shell-signals.tsx` only if regressions appear
- `src/app/apps/apps-launcher-grid.tsx` only if regressions appear
- Page components with raw cross-workspace `Link href="/..."` usage
- A shared canonical link helper or wrapper if needed

Tests:

- Middleware route rewrite tests if present or added.
- Sidebar project href tests.
- App launcher href tests.
- Keyboard shortcut route tests.
- A focused Playwright check for workspace-subdomain cross-navigation.

Risk:

- Host behavior can differ between local, preview, and production. Test with realistic `Host` and `x-forwarded-host` headers.

### Slice 2 - Login redirect normalization

Files likely touched:

- `src/app/login/login-form.tsx`
- `src/middleware.ts`
- `src/app/login/login-form.test.ts`

Tests:

- Relative `next`.
- Same-origin absolute `next`.
- Canonical-host platform `next`.
- Workspace-subdomain platform `next`.
- Unsafe external `next`.

Risk:

- Cross-subdomain login may still need a full navigation if cookies or host-specific rewrites require it.

### Slice 3 - Revalidation narrowing

Files likely touched:

- `src/lib/workspace/workspace-navigation.ts`
- `src/lib/workspace/workspace-navigation.test.ts`
- Server action callers if mutation types become more granular.

Tests:

- Existing dedupe tests.
- Existing pathname normalization tests.
- Mutation-specific invalidation expectations.

Risk:

- Too-narrow invalidation can leave dashboard/today/review data stale. Start conservative, then tighten with tests.

### Slice 4 - Realtime refresh moderation

Files likely touched:

- `src/components/realtime/owner-scoped-realtime-refresh.tsx`
- `src/lib/supabase/realtime.ts`
- Dashboard/Today/Timer realtime call sites
- Realtime tests

Tests:

- Existing debounce behavior.
- Hidden-document behavior.
- Event filter behavior.
- Own-write suppression.
- Unsubscribe cleanup.

Risk:

- Suppressing refresh too aggressively can hide remote updates.

### Slice 5 - GET form enhancement

Files likely touched:

- `src/app/review/week-selector.tsx`
- Possibly `src/app/ideas/page.tsx`
- Avoid changing `src/app/settings/account/page.tsx` unless OAuth behavior is explicitly in scope.

Tests:

- Existing page rendering tests.
- Link/query assertions.
- Client navigation tests for enhanced date/filter pickers if added.

Risk:

- Low for Review and Ideas if GET fallback is preserved.
- Higher for Google OAuth; leave it alone unless separately specified.

## Verification Plan

Run narrow checks first:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/workspace/workspace-navigation.test.ts
npm test -- src/components/realtime/owner-scoped-realtime-refresh.test.tsx
npm test -- src/app/login/login-form.test.ts
```

For navigation behavior, add or run focused Playwright tests:

```bash
npm run test:auth-session:e2e
```

If new Playwright specs are added for reload detection, run only those specs before the full suite.

## Final Recommendation

Treat the old audit as partially completed. The remaining highest-value work is not the original middleware bug; it is consistency. Finish host-aware navigation for every cross-workspace link, then reduce hard login redirects and broad refresh pressure. After that, narrow revalidation and add browser-level tests so the core loop stays stable:

`Project -> Goal -> Task -> Timer -> Review`
