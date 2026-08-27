# Navigation — Redesign (Wave 10.1)

## Final Route Structure (B-1 — 4 tabs only)

```
apps/mobile/app/(app)/(tabs)/
  _layout.tsx              → Tabs with BottomNavigation, 4 screens only
  today.tsx                → Today
  work.tsx                 → Work hub (Tasks | Projects via ?mode=)
  goals.tsx                → Goals
  timer.tsx                → Timer

apps/mobile/app/(app)/
  (tabs)/                  → Stack.Screen name="(tabs)" headerShown false
  tasks/
    index.tsx              → Redirect href="/(app)/(tabs)/work?mode=tasks" (compat)
    create.tsx             → Stack modal Create Task
    [id].tsx               → Stack Task detail
  projects/
    index.tsx              → Redirect href="/(app)/(tabs)/work?mode=projects" (compat)
    create.tsx             → Stack modal Create Project
    [slug].tsx             → Stack Project detail
  goals/
    create.tsx             → Stack modal Create Goal
    [id].tsx               → Stack Goal detail
  profile.tsx              → Stack Profile (canonical, headerShown true)
  search.tsx               → Stack Search
  _layout.tsx              → Stack with (tabs) + 10 stack screens (tasks/index, projects/index, tasks/create, tasks/[id], projects/create, projects/[slug], goals/create, goals/[id], search, profile)
```

Verification: `state.routes.length === 4` in `BottomNavigation`. No `href:null` entries remain. `BottomNavigation` still filters `href===null` as safety, but filter is no-op after 10.1.

Deleted from `(tabs)/`: `tasks.tsx`, `projects.tsx`, `profile.tsx` (previously `href:null` compat). Tab file count now exactly 4 (+ `__tests__`).

## Compatibility / Deep Links

- `/(app)/(tabs)/tasks` no longer a tab route. Old bookmarks resolve via stack redirect `/(app)/tasks` → `work?mode=tasks`. If caller still uses `/(app)/(tabs)/tasks`, router will 404; canonical deep link is now `/(app)/tasks` or `/(app)/(tabs)/work?mode=tasks`.
- `/(app)/tasks` → `Redirect` to `/(app)/(tabs)/work?mode=tasks` (`app/(app)/tasks/index.tsx`)
- `/(app)/projects` → `Redirect` to `/(app)/(tabs)/work?mode=projects` (`app/(app)/projects/index.tsx`)
- `/(app)/(tabs)/projects` same 404 as above; use new path.
- `/(app)/(tabs)/profile` removed; canonical is `/(app)/profile` only. `HeaderActions` avatar already pushes `/(app)/profile` — verified.
- `tasks/create`, `tasks/[id]`, `projects/create`, `projects/[slug]`, `goals/create`, `goals/[id]`, `search` remain unchanged as stack screens.
- `experiments.typedRoutes=true` preserved; all `router.push` destinations type-check (`tsc --noEmit` 0).
- Existing E2E `00-welcome.yaml` etc not broken — they use `/today` and stack routes.

## Work Mode State (B-2)

- Before: `params.mode → useState(initial) + useEffect` anti-pattern with `eslint-disable set-state-in-effect`.
- After: source of truth is URL:
  ```ts
  const params = useLocalSearchParams<{mode?: string}>()
  const mode: WorkMode = params.mode === 'projects' ? 'projects' : 'tasks'
  const setMode = (next: WorkMode) => router.setParams({mode: next})
  ```
- `WorkModeSelector onChange` calls `router.setParams`, not local `setMode`. No `useEffect`, no `useState` for mode. Disable removed.

## Bottom Chrome Geometry (B-4)

### Canonical tokens
`apps/mobile/components/mobile/navigation/bottomChrome.ts`:
```
NAV_HEIGHT = 72
HORIZONTAL_MARGIN = 24
BOTTOM_GAP = 20
FAB_GAP = 16
CONTENT_GAP = 16
TAB_LABEL_MAX_FONT_SCALE = 1.4
```

### Hook
`useBottomChromeMetrics()` → `useSafeAreaInsets()` + `useWindowDimensions()`:
```
navBottom = Math.max(insets.bottom, 12) + BOTTOM_GAP
fabBottom = navBottom + NAV_HEIGHT + FAB_GAP
contentBottomPadding = fabBottom + CONTENT_GAP          // FAB screens: Work/Goals
contentBottomPaddingNoFab = navBottom + NAV_HEIGHT + CONTENT_GAP  // Today/Timer/Profile/Search
pillWidth = Math.max(Math.min(width - HORIZONTAL_MARGIN*2, 560), 280)
```

### Consumers
- `BottomNavigation.tsx` → imports `NAV_HEIGHT`, `TAB_LABEL_MAX_FONT_SCALE`, `useBottomChromeMetrics()` for `navBottom`/`pillWidth`; `height 72`, `margin 24`, `bottomGap 20` no longer hardcoded. `testID="bottom-navigation"` on wrapper. Keeps `state.routes.filter(href===null)` safety.
- `FloatingActionButton.tsx` → `useBottomChromeMetrics().fabBottom` as `bottom: fabBottom` (`position:absolute right:18`). Removes `bottom: spacing.lg (20)` magic. Inset-aware.
- List `contentContainerStyle paddingBottom`:
  - `TasksListView`, `ProjectsListView`, `GoalsListView` (FAB present) → `contentBottomPadding` via hook, overridden inline `style={[styles.listContent, {paddingBottom: contentBottomPadding}]}`. Static `floatingTabClearance` remains in StyleSheet as fallback but runtime is authoritative.
  - `today.tsx` SectionList, `timer.tsx` ScrollView, `profile.tsx` ScrollView, `search.tsx` ScrollView (no FAB) → `contentBottomPaddingNoFab`.
- `AppScreen` stays `SafeAreaView edges=['top']` only; bottom handled via chrome metrics.
- `mobileTheme.layout.floatingTabClearance = 160` kept as fallback token with comment `// fallback; runtime authoritative`. No longer used as primary geometry; docs retain for reference.

## Bottom Nav Visual (unchanged geometry, refined in 10.2/10.3)

- Floating dark graphite `rgba(20,20,20,0.85)` pill, `height 72 radius pill shadow y10 r18 opacity 0.22 elevation 10`, inner highlight `top1 rgba(255,255,255,0.10)`.
- 4 equal regions `flex1 gap 3 minHeight44`, no width change on active, `TAB_LABEL_MAX_FONT_SCALE 1.4`.
- Active state remains dot 16×4 `#2563eb` (will become tonal capsule in 10.2/10.3) — geometry correct now.

## Header Actions
- `ScreenHeader` + `HeaderActions` (search magnifier → `/(app)/search`, avatar initials → `/(app)/profile`) unchanged, verified `HeaderActions` pushes `/(app)/profile`.

## Cleanup
- Deleted `components/mobile/glass/GlassBottomTab.tsx` duplicate (zero imports). `BottomNavigation` is sole bottom chrome. `glass/index.ts` no longer re-exports `GlassBottomTab`.
- Removed all `href:null` filtering reliance; filter kept as safety in `BottomNavigation`.

## Typed Routes
- `app.json experiments.typedRoutes=true`
- Added stack screens `tasks/index` and `projects/index` with `headerShown:false` to `_layout.tsx`.
- `router.push` destinations (`/(app)/tasks/create`, `/(app)/projects/create`, `/(app)/tasks/[id]`, `/(app)/projects/[slug]`, `/(app)/goals/[id]`, `/(app)/goals/create`, `/(app)/search`, `/(app)/profile`) still type-check.
- New redirects use string href `/(app)/(tabs)/work?mode=tasks|projects` which is valid typed route.

## Testing
- `BottomNavigation` test: `state.routes.length === 4`, `visibleRoutes === state.routes`.
- Work mode: `useLocalSearchParams` drives `mode`, `router.setParams` updates URL; no local state.
- Bottom chrome: `useBottomChromeMetrics` returns inset-aware `navBottom/fabBottom/contentBottomPadding` — verify with mocked `useSafeAreaInsets` (bottom 34 → navBottom 54, fabBottom 142, contentBottom 158).
- `npx tsc --noEmit` 0, `npm run mobile:test` 166/166, `git diff --check` 0.
- Scope: `git diff --name-only origin/main...HEAD | awk '!/^apps\/mobile\//'` empty.
