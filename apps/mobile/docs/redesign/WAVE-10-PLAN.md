# Wave 10 Plan — Real-Device Correction

**Date:** 2026-08-26
**Branch:** `ui/mobile-redesign` `57aa429` (after 10.0)
**Base:** `origin/main 147a84b`

## Audit synthesis (6 parallel read-only)

- **Nav:** 7 routes in `state.routes` but 4 visible (filtered). `work.tsx` mode is local + `useEffect` sync (anti-pattern). FAB `bottom:20` ignores `insets.bottom`. `GlassBottomTab` duplicate of `BottomNavigation`. `floatingTabClearance 160` static vs nav runtime.
- **Work:** 320-380px chrome before first task (ScreenHeader 90 + WorkModeSelector 50 + Search 44 + QuickFilters 48 + Filters card 44 + Counter 16 + SummaryGrid 76). Metric 4-card duplicates counter. Pill everywhere, card soup, giant Edit, duplicated progress.
- **Today/Timer:** Tracked time demoted to `ScreenHeader description 14 muted` vs completion ring 58 dominant. Timer isolated correctly (parent no rerender) but idle has Card around each candidate, running uses `Card surface #fff` not tonal.
- **Projects/Goals:** Progress bar + fraction + percent (GoalDetail triple), status+health triple (chips + meta row + segmented), card-in-card (FormSection Card wrapping Card rows), next step CTA vs passive.
- **Design System:** Pill `999` on 8 types, card `surface #fff border #e4e7ec radius20 shadow card` same for all, shadow duplicate `card vs glass.shadow`, tokens 12 vs 14 vs 14 vs 20, colors `primary==info`, `danger==blocked`, `slate==neutralStrong`, 5 greys, `textMuted≈textSubtle`.
- **Perf/A11y:** BLOCKER `ProjectDetailScreen` conditional hook, HIGH `Projects/GoalsListView useFocusEffect([query])` storm, chip contrast 3.95 fail, GlassPill 30h, search ScrollView unbounded 200, placeholder masking, midnight memo, legacy AnimatedPressable.

## Classification

### BLOCKER (must fix before aesthetic)

- **B-1 — Navigation state vs visual:** Remove `tasks`, `projects`, `profile` from `tabs/_layout.tsx` (7→4). Create stack compat `app/(app)/tasks/index.tsx` → `work?mode=tasks` redirect and `app/(app)/projects/index.tsx` → `work?mode=projects`. Keep `profile` only at `app/(app)/profile.tsx`. Verify typed routes.
- **B-2 — Work mode source of truth:** Replace `params.mode → useState + useEffect` with `mode = params.mode === 'projects' ? 'projects' : 'tasks'` and `router.setParams({mode})` on selector. Remove `eslint-disable set-state-in-effect`.
- **B-3 — Hook correctness:** Fix `ProjectDetailScreen` `useRouter` inside IIFE try/catch (conditional hook) and `HeaderActions useAuthSafe` try/catch. Provide `AuthProvider` mock in tests, not production fallback. Remove `rules-of-hooks` suppressions.
- **B-4 — Bottom chrome geometry:** Create `components/mobile/navigation/bottomChrome.ts` with `NAV_HEIGHT 72, HORIZONTAL_MARGIN 24, BOTTOM_GAP 20, FAB_GAP 16, CONTENT_GAP 16` and hook `useBottomChromeMetrics()` using `useSafeAreaInsets()`. Derive `navBottom, fabBottom, contentBottomPadding` runtime. Remove `floatingTabClearance 160` fallback for runtime, keep token only as fallback.

### HIGH (product hierarchy & system)

- **H-1 — Work chrome budget:** Remove 4-card metric grid, replace with one compact line `8 tasks · 1 urgent` (hide 0). Make advanced filters single row `Filters • 2` collapsed, expand fade+translate 180ms. Keep Search 44 + quick 44 + counter 16 before list.
- **H-2 — Task card:** Remove giant `Edit` button (`Button secondary flex:1`), keep `Pressable` card tap → detail + `IconButton 44` overflow → ActionSheet. Keep chips + due pill, hide estimate unless >0, use `Chip` dot only.
- **H-3 — Today hero:** Promote `trackedTodayLabel` to hero `heroNumber 42-48` `tracked today` `heroLabel 11 uppercase`, demote completion to secondary `1 of 4 completed` + bar `Math.round(completed/total*100)` no ring dominant. Rename DailyMomentum to hero, not ring. First task visible ~180px.
- **H-4 — Tonal system:** Introduce `surface #fff, surfaceLow #f3f6fb, surfaceMid #edf2f8, surfaceHigh #e6ecf5` and semantic containers `primaryContainer #dbeafe etc` + darker accessible foregrounds `danger #991B1B`. Replace card soup with `plain/tonal/elevated` variants; shadow only for nav/FAB/sheet.
- **H-5 — Shape & pill:** Limit pill to `Chip, quick filters, nav capsule, FAB, segmented thumb`; buttons/inputs use `control 12`, cards `16`, hero `20`, sheet `28`. Fix radii duplication.
- **H-6 — Timer expressive:** Idle `FocusQueue` rows tonal `surfaceLow` no card per row; running use `primaryContainer` or `surfaceMid` tonal background, clock `52` hero, `Stop` danger 54, no card border.
- **H-7 — Search rows:** Replace `ScrollView+map` unbounded 200 with virtualized grouping or at least keep `ScrollView` but note N=200 bounded + truncation warning; keep debounce 250, but style rows as `View` with divider `hairline #e4e7ec` not `Card`.

### MEDIUM (refine, test, document)

- **M-1 — Projects/Goals dedup:** GoalDetail reduce bar+percent+fraction → bar+fraction only, header `Linked tasks (n)` enough; ProjectDetail remove duplicate status chips.
- **M-2 — Empty states:** Compact plain `View` 64 icon + two lines, no `Card` wrap when filtered.
- **M-3 — Focus refetch audit:** Change `ProjectsListView`/`GoalsListView` `useFocusEffect([query])` → `[refetch]` like Tasks/Today; audit `placeholderData` hiding `archived` switch.
- **M-4 — Midnight memo:** Fix `today.tsx todayIso/tomorrowIso useMemo([],[])` to recompute on mount or use `new Date()` inline.
- **M-5 — Draft overwrite:** Guard `TaskDetailScreen useEffect setDraft` with `if (!isDraftDirty)` or only on `taskId` change.
- **M-6 — Spacing token:** Fix `md=14` → `12` or `16` to align with 4/8/12/16/20/24/32 rhythm; update `spacing` and all `paddingHorizontal 12 vs 14` literals.

### LOW (defer with justification)

- **L-1 — Danger chip contrast 3.95:** Requires token redesign to `danger #991B1B` (7.1) — deferred until tonal system H-4, document.
- **L-2 — FlashList:** Lockfile, no profiling hard evidence, keep FlatList.
- **L-3 — `getItemLayout`:** Task row height wraps, not deterministic, do not use.

## Wave sequence (10.1–10.13)

- **10.1 — Nav architecture:** 4 tabs only, compat redirects, `router.setParams`, `bottomChrome` metrics, `FAB` inset-aware, `GlassBottomTab` delete, typed routes verify.
- **10.2 — Tonal system:** `theme.ts` new surfaces + containers + darker foregrounds, contrast utility, `spacing` fix.
- **10.3 — Primitives:** `Card` variants `plain/tonal/elevated`, `Button` control radius, `Chip` contrast, `SegmentedControl` pill thumb only, `FormSection` View not Card, `SelectionRow` etc.
- **10.4 — Work:** Rebuild `Work` + `TasksListView` + `TaskCard` + `TaskFilters` around task-first, remove metric grid/Edit, compact filters, bottomChrome.
- **10.5 — Today:** Hero `tracked time`, completion secondary, reuse Work task DNA.
- **10.6 — Goals/Projects:** Dedup progress/health, next-step CTA, tonal cards.
- **10.7 — Timer:** Idle tonal rows, running tonal hero.
- **10.8 — Search/Profile/Auth:** Row hierarchy, profile calm, auth dark keep.
- **10.9 — Create/Detail:** `FormSection` View grouping, sticky bar safe-area.
- **10.10 — Hooks:** Remove try/catch, remove disables, fix tests to provide providers.
- **10.11 — Perf:** List tuning justify `windowSize` default, remove `removeClippedSubviews false` unless proven, `console.log` audit.
- **10.12 — Remove obsolete:** `rg` for `Glass*` unused, delete if zero imports, `primitives` etc.
- **10.13 — Final review:** 3 reviewers read-only, fix BLOCKER/HIGH, report.

## Design spike (before 10.4)

Stitch MCP — create/refine:

- **A. Work / Tasks:** 2 compositions, both `first task in first viewport`, no metric wall, one search, compact quick filters, collapsed advanced, 4 nav, FAB above nav, light.
- **B. Today:** `24m tracked today` hero (no fake target), completion secondary.
- **C. Timer Running:** idle + running, running most expressive but calm.

Chosen IDs recorded before coding.

## Validation per wave

`git diff --check`, `npm run mobile:typecheck`, `npm run mobile:test`, then `mobile:doctor`, `mobile:bundle` at gates. Scope `git diff --name-only origin/main...HEAD | awk '!/^apps\/mobile\//'` must be empty.
