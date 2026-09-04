# Wave 05 web UX quality audit

**Starting accepted HEAD:** `c15517403756a360847640fb1a089ad7369d597c` (origin/main, Wave 04 merge PR #213)
**Branch:** `wave/05-web-ux-quality`
**Scope:** web workflows at desktop (`1280px+`) and narrow (`390px`) widths, including the Wave 04 Notifications surface.

## Objective

Inspect the rendered product before making visual changes. Preserve existing workflow capability while improving clarity, action hierarchy, state feedback, responsive behavior, keyboard interaction, and reduced-motion behavior where evidence supports a change.

## Required screens

Dashboard, Today, Tasks, Goals, Projects, Timer, Inbox, Review, Friction, Work Analytics, Search, Startup, Shutdown, Notifications, and Settings. Secondary navigation, notification entry points, dialogs, sheets, and destructive actions are included when reachable from those screens.

## Audit record

For each reachable screen, record the viewport, entry path, state (loading, empty, populated, error, success, disabled), primary action, observed interaction, and evidence reference. A screenshot or browser snapshot is required before classifying a rendered issue as a visual defect. Source/tests may establish implementation coverage but do not replace authenticated rendered evidence.

| Surface | Desktop 1280+ | Narrow 390 | Authenticated runtime | Source/test follow-up |
| --- | --- | --- | --- | --- |
| Dashboard | NOT VERIFIED | NOT VERIFIED | pending browser access | route has loading.tsx; async panels under Suspense |
| Today | NOT VERIFIED | NOT VERIFIED | pending browser access | route has loading.tsx; primary planning actions present |
| Tasks | NOT VERIFIED | NOT VERIFIED | pending browser access | route has loading.tsx + error.tsx |
| Goals | NOT VERIFIED | NOT VERIFIED | pending browser access | route has loading.tsx + error.tsx |
| Projects | NOT VERIFIED | NOT VERIFIED | pending browser access | route has loading.tsx |
| Timer | NOT VERIFIED | NOT VERIFIED | pending browser access | route has loading.tsx + error.tsx |
| Inbox | NOT VERIFIED | NOT VERIFIED | pending browser access | quick-capture component wired in mobile drawer |
| Review | NOT VERIFIED | NOT VERIFIED | pending browser access | route has loading.tsx + error.tsx |
| Friction | NOT VERIFIED | NOT VERIFIED | pending browser access | no route loading.tsx (consistent with settings/startup/shutdown) |
| Work Analytics | NOT VERIFIED | NOT VERIFIED | pending browser access | route has loading.tsx |
| Search | NOT VERIFIED | NOT VERIFIED | pending browser access | command palette model tested; 13 navigation items incl. Notifications |
| Startup | NOT VERIFIED | NOT VERIFIED | pending browser access | no route loading.tsx (pre-existing pattern variance) |
| Shutdown | NOT VERIFIED | NOT VERIFIED | pending browser access | no route loading.tsx (pre-existing pattern variance) |
| Notifications | NOT VERIFIED | NOT VERIFIED | pending browser access | Wave 04 surface: empty/error/success/pagination states in source; sidebar + palette + top-bar entries with unread badge |
| Settings | NOT VERIFIED | NOT VERIFIED | pending browser access | no route loading.tsx (pre-existing pattern variance) |

## Environment limitation

No authenticated browser session or database-backed test account is available locally. The repository Playwright visual suite remains the executable fallback; its authenticated-route assertions explicitly allow a redirect to `/login`, so a passing run must not be promoted to authenticated visual proof.

Until a real authenticated rendered session is available, this document must keep the affected cells `NOT VERIFIED` and must not claim a complete visual audit. Any code change in this wave requires a reproducible source/test rationale and the narrowest affected validation.

## Product gate

No new page or navigation destination is authorized by endpoint existence alone. A touched surface must retain its important existing capability, have a clear primary purpose/action, and provide useful loading, empty, error, success, disabled, keyboard-focus, responsive, and reduced-motion behavior where applicable.

## Evidence status

This is an investigative Wave 05 artifact. Results, screenshots, confirmed defects, fixes, exact commands, and remaining `RUNTIME NOT VERIFIED` items are appended as the audit proceeds.

## Wave 05 evidence update (reconciled 2026-09-04 UTC)

The historical Wave 05 stack (69 files / 50 commits on PR #214) carried the full Waves 00→04 history because it was branched before those waves squash-merged. That stack was rebuilt: the branch was reset to current `origin/main` (`c1551740`) and now carries only true Wave 05 work (this document). The pre-rebuild tip is preserved at local ref `backup/wave05-pre-reconcile-e2b11ead` and was not pushed.

### Fresh static audit against current main

- Command palette (`command-palette.tsx` + `command-palette-model.ts`): focus trap, Escape handling, focus restore, `combobox`/`listbox`/`option` roles with `aria-activedescendant`, loading/error/empty states, arrow-key wrap via tested `nextActiveIndex`. Navigation set has 13 items including Notifications; the model test pins the full label list.
- Sidebar (`sidebar-navigation.tsx`, `shell-route-meta.ts`): Notifications present as system route `S2` with icon, active-state handling, and unread-count badge; command routes 01–06 unchanged.
- Top bar (`top-bar.tsx`): Notifications bell links `/notifications` with a count-aware `aria-label` plus screen-reader-only unread text; shortcut help and account settings entries unchanged.
- Mobile drawer (`sidebar-mobile-drawer.tsx`): Escape handling, focus restore to trigger, body scroll lock, auto-close on link navigation. Covered by `sidebar-mobile-drawer.test.tsx`.
- Notifications page (`app/notifications/page.tsx`): `force-dynamic` server component with error card + retry, success/error feedback blocks (`role="status"` / `role="alert"`), empty state, read/unread badges, per-item actions with pending labels, and cursor pagination.
- Loading/error boundary variance (missing `loading.tsx` on friction/search/startup/shutdown/settings/notifications/ideas/help/home; missing per-route `error.tsx` on several routes) is pre-existing and consistent across routes, with root `app/error.tsx` + `global-error.tsx` as fallback. Not a Wave 04 regression, so no boundary was added for a single route.
- CSS sweep: `:focus-visible` styling present (13 hits), `prefers-reduced-motion` handling present, `overflow-x: clip/hidden` guards present on shell/auth/home surfaces.

### Executable evidence (worktree at `c1551740`, 2026-09-04 UTC)

```text
npm run web:typecheck
PASS (tsc --noEmit, no errors)

npm run web:test
167 test files passed, 1286 tests passed

DATABASE_URL=<local postgres> NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<CI placeholders> npm run web:build
PASS (production build; Next auto-touched apps/web/tsconfig.json and npm added @next/swc optional stubs in package-lock.json — both restored, not part of Wave 05)

CI=1 npm run web:test:visual
4 passed, 1 skipped (command-palette case skipped: no authenticated session)
```

The visual suite verified public rendering, the unauthenticated redirect-tolerant protected-route contract, keyboard focus on the login form, and reduced-motion behavior. Static `DATABASE_URL`-less builds fail at page-data collection for `/api/agent/capabilities`; that is environmental (CI supplies Postgres + Supabase placeholders), not a product defect.

### Findings and product decision

STATIC VERIFIED: navigation/palette/sidebar/top-bar/drawer/notification source integration reviewed against current main; no capability loss, no stale route, no broken keyboard path found in source.
TEST VERIFIED: web unit suite green (167 files / 1286 tests), palette model counts pinned.
BUILD VERIFIED: production build green with CI-equivalent env.
VISUAL VERIFIED: login shell + public routes + focus + reduced motion via Playwright (4 passed, 1 skipped).
RUNTIME VERIFIED: none for authenticated workflows.
RUNTIME NOT VERIFIED: all authenticated populated/empty/error workflow states remain NOT VERIFIED; no authenticated screenshots were captured and none are claimed.

No rendered defect could be safely classified for the authenticated product surfaces, so no application/styling change was made. This preserves the accepted Wave 04 product behavior while avoiding source-only styling changes without authenticated evidence.

### Gate result

```text
Code gate: PASS (typecheck, tests, build, visual suite)
Runtime gate: ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE
  - local unauthenticated shell: VERIFIED
  - authenticated populated/empty/error workflow states: NOT VERIFIED
Product gate: PASS for the verified shell; authenticated workflow quality: NOT VERIFIED
Review gate: exact final-range review required before merge
Publication gate: branch publication is safe; Wave 00 ignore enforcement remains active
```

Wave 05 result is `ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE`. The `NOT VERIFIED` cells above must be revisited when a safe authenticated browser/database environment is available.
