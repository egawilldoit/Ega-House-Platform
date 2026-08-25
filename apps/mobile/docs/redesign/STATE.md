# EGA House Mobile Redesign — State

## Base
- **BASE_SHA:** `dca2dceaa3baa72352ef9a6db8c80d29029fc82a` (origin/main at worktree creation)
- **Branch:** `ui/mobile-redesign`
- **Worktree:** `.worktrees/ui-mobile`
- **Scope:** `apps/mobile/**` only
- **Stitch Project:** EGA House Mobile Rebuild (refine existing screens)
- **Status:** NOT STARTED → Wave 0 pending

## Screen Inventory (existing)
- `/ (index)` — auth gate redirect
- `(public)/welcome` — dark auth welcome
- `(public)/login` — dark auth login
- `(app)/(tabs)/today` — Today workspace
- `(app)/(tabs)/tasks` — Tasks list + filters + FAB + ActionSheet
- `(app)/(tabs)/projects` — Projects list + status filter + FAB + ActionSheet
- `(app)/(tabs)/goals` — Goals list + health/status + next-step modal + FAB
- `(app)/(tabs)/timer` — Server-authoritative timer + focus queue + stats
- `(app)/(tabs)/profile` — Profile + sign out + version
- `(app)/search` — Search stack screen
- `(app)/tasks/create` — Create Task modal
- `(app)/tasks/[id]` — Task detail/edit
- `(app)/projects/create` — Create Project modal
- `(app)/projects/[slug]` — Project detail
- `(app)/goals/create` — Create Goal modal
- `(app)/goals/[id]` — Goal detail
- `+not-found` — 404

## Planned Waves
- [ ] Wave 0 — Design system + navigation (4-tab Work hub, hidden compat routes)
- [ ] Wave 1 — Today
- [ ] Wave 2 — Work / Tasks / Projects (segmented Tasks|Projects, context FAB)
- [ ] Wave 3 — Goals
- [ ] Wave 4 — Timer + Profile (avatar header, timer clock isolation)
- [ ] Wave 5 — Welcome + Login + Search
- [ ] Wave 6 — Create flows (Task/Project/Goal)
- [ ] Wave 7 — Detail/Edit flows (Task/Project/Goal)
- [ ] Wave 8 — Performance + accessibility hardening
- [ ] Wave 9 — Final independent review

## Current Wave
Wave 0 — NOT STARTED

## Commits
- `chore(mobile-ui): initialize redesign tracking` — pending

## Tests
- Pending (run `npm run mobile:typecheck`, `mobile:test`, `mobile:doctor`, `mobile:bundle` per wave)

## Known Issues
- `.worktrees` now git-ignored via `.git/info/exclude` (not tracking root `.gitignore` per mobile-only scope)
- No design system refactor yet
- Bottom nav currently 6 tabs (Today/Tasks/Projects/Goals/Timer/Profile) — target is 4 (Today/Work/Goals/Timer)

## Next
- Implement Wave 0 foundation

## Handoff Notes for Next Wave Agent
- Read `apps/mobile/components/mobile/theme.ts` before touching tokens
- Preserve `glassConfig.useRealBlurOnAndroid = false`
- Do not create second theme authority — Stitch tokens map into `mobileTheme`
