# Navigation — Redesign

## Current (pre-redesign)
```
Tabs:
- today (Tasks? Actually Today)
- tasks
- projects
- goals
- timer
- profile

Stack (app):
- (tabs) (no header)
- tasks/create (modal)
- tasks/[id]
- projects/create (modal)
- projects/[slug]
- goals/create (modal)
- goals/[id]
- search
```

Custom bottom bar: `GlassBottomTab` iterates `state.routes.map` — does NOT filter `href:null`.

## Target
```
Primary tabs (4 visible):
- today
- work   (NEW) — segmented Tasks | Projects
- goals
- timer

Header actions:
- Search → Search stack screen
- Avatar → Profile

Hidden/compat:
- tasks.tsx — keep file, set href:null, redirect or delegate to work?mode=tasks
- projects.tsx — keep file, href:null, delegate to work?mode=projects
- profile.tsx — keep file href:null OR move canonical to (app)/profile.tsx

Search: header action → /(app)/search
Profile: header avatar → /profile (stack)
```

## Recommended Route Structure
```
apps/mobile/app/(app)/(tabs)/
  _layout.tsx
  today.tsx
  work.tsx               NEW — Work hub with internal Tabs|Projects segment
  goals.tsx
  timer.tsx
  tasks.tsx              compat — href:null
  projects.tsx           compat — href:null
  profile.tsx            compat — href:null or redirect

apps/mobile/app/(app)/
  profile.tsx            canonical profile (if tab removed)
  search.tsx             already exists
```

Alternative if Expo Router upgrade makes href:null filtering unreliable:
- Option A: Make GlassBottomTab explicitly filter `descriptors[route.key].options.href === null` OR `options.href === null` / `options.tabBarItemStyle: {display:'none'}` check.
- Option B: Restructure so only 4 screens are declared in (tabs)/_layout; hidden routes live outside tabs group.

Chosen approach will be documented after Wave 0 implementation with test evidence.

## Header Actions
- Implemented via `ScreenHeader` / `HeaderActions` primitives
- Search: IconButton(magnifying glass) → `router.push('/(app)/search')`
- Avatar: Pressable avatar initials → `router.push('/(app)/profile')`

## Safe Area / Content Clearance
- Floating bottom pill: `mobileTheme.layout.floatingTabClearance` (160) as bottom padding on every tab ScrollView/FlatList/SectionList
- Sticky action bar: `mobileTheme.layout.stickyActionClearance` (120)
- Top safe area via `SafeAreaView edges=['top']` in `MobileScreen` / new `AppScreen`

## Typed Routes
- Must keep `experiments.typedRoutes = true`
- No break to `router.push` destinations
- Verify `tsc --noEmit` after move

## Compatibility / Deep Links
- Preserve deep links to old paths:
  - `/(app)/(tabs)/tasks` → should still resolve (either redirect to work?mode=tasks or keep handler)
  - Same for projects/profile
- Document final mapping after implementation
- Do not break existing E2e maestro flows (`00-welcome.yaml` etc.)

## Testing
- Navigation visibility test: only 4 labels in BottomNavigation
- Tap targets ≥44px
- No geometry change between primary screens
- Hidden routes remain reachable programmatically
