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
Wave 0 — COMPLETE (awaiting parent commit)

## Commits
- `chore(mobile-ui): initialize redesign tracking` — c251851
- Wave 0 working tree: DESIGN + theme + ui/motion + navigation + Work hub (uncommitted, base dca2dceaa)

## Tests
- `npm run typecheck` — exit 0 (2026-08-25, .worktrees/ui-mobile/apps/mobile)
- `npm run test` — exit 0 (166/166 passed, 29 suites, 9.6s) — fixed HeaderActions auth fallback for timer.test
- `git diff --check` — exit 0 (no whitespace errors)
- `npm run doctor` — exit 1 (only @types/react minor mismatch ~19.1.10 vs 19.2.14, unrelated to Wave 0)
- `npm run validate:bundle` — exit 1 (ENOENT /worktree/node_modules — worktree lacks root node_modules, not code defect)
- Mobile-only diff — `git diff --name-only dca2dce...HEAD` → 3 docs (all apps/mobile/**); working-tree diff also apps/mobile/** only → awk empty ✓

## Files Changed (Wave 0)
- Modified: `apps/mobile/components/mobile/theme.ts` (blocked→danger red, in_progress→amber, active→blue, added healthTone/chipTone, preserved glassConfig)
- Modified: `apps/mobile/components/mobile/glass/GlassBottomTab.tsx` (filter href:null)
- Modified: `apps/mobile/app/(app)/(tabs)/_layout.tsx` (4 visible: today/work/goals/timer, tasks/projects/profile href:null, tabBar→BottomNavigation)
- Modified: `apps/mobile/app/(app)/(tabs)/today.tsx` (HeaderActions search+avatar)
- Modified: `apps/mobile/app/(app)/(tabs)/goals.tsx` (HeaderActions, clearance 160)
- Modified: `apps/mobile/app/(app)/(tabs)/timer.tsx` (HeaderActions ×3 states)
- Modified: `apps/mobile/app/(app)/(tabs)/projects.tsx` (clearance 160)
- Modified: `apps/mobile/app/(app)/_layout.tsx` (+profile & tasks/[id] Stack screens)
- Modified: `apps/mobile/app/index.tsx` (redirect today)
- Modified: `apps/mobile/app/(public)/_layout.tsx` (redirect today)
- Modified: `apps/mobile/app/(public)/login.tsx` (replace tasks→today)
- Created: `apps/mobile/DESIGN.md`
- Created: `apps/mobile/docs/redesign/research-wave-0.md`
- Created: `apps/mobile/app/(app)/(tabs)/work.tsx` (Work hub Tasks|Projects + FAB)
- Created: `apps/mobile/app/(app)/profile.tsx` (canonical stack profile)
- Created: `apps/mobile/components/mobile/ui/AppScreen.tsx`
- Created: `apps/mobile/components/mobile/ui/ScreenHeader.tsx`
- Created: `apps/mobile/components/mobile/ui/HeaderActions.tsx`
- Created: `apps/mobile/components/mobile/ui/BottomNavigation.tsx`
- Created: `apps/mobile/components/mobile/ui/Card.tsx`
- Created: `apps/mobile/components/mobile/ui/Button.tsx`
- Created: `apps/mobile/components/mobile/ui/IconButton.tsx`
- Created: `apps/mobile/components/mobile/ui/FloatingActionButton.tsx`
- Created: `apps/mobile/components/mobile/ui/Chip.tsx`
- Created: `apps/mobile/components/mobile/ui/ProgressBar.tsx`
- Created: `apps/mobile/components/mobile/ui/SegmentedControl.tsx`
- Created: `apps/mobile/components/mobile/ui/SelectionRow.tsx`
- Created: `apps/mobile/components/mobile/ui/SearchField.tsx`
- Created: `apps/mobile/components/mobile/ui/EmptyState.tsx`
- Created: `apps/mobile/components/mobile/ui/Skeleton.tsx`
- Created: `apps/mobile/components/mobile/ui/FeedbackBanner.tsx`
- Created: `apps/mobile/components/mobile/ui/index.ts`
- Created: `apps/mobile/components/mobile/motion/AnimatedPressable.tsx`
- Created: `apps/mobile/components/mobile/motion/FadeSlide.tsx`
- Created: `apps/mobile/components/mobile/motion/ReducedMotion.ts`
- Created: `apps/mobile/components/mobile/motion/index.ts`

## Known Issues
- `.worktrees` now git-ignored via `.git/info/exclude` (not tracking root `.gitignore` per mobile-only scope)
- Timer test previously failed due to HeaderActions requiring AuthProvider — fixed via useAuthSafe fallback
- Bundle export fails in worktree without root node_modules install (not Wave 0 regression)
- No design system refactor beyond Wave 0 scope — legacy MobileScreen/Glass* remain as compat

## Next
- Wave 1 — Today parity (migrate to Card/Chip/ProgressBar etc)
- Wave 2 — Work full tasks/projects parity
- Wave 3 — Goals, Wave 4 — Timer clock isolation + avatar polish

## Handoff Notes for Next Wave Agent
- Read `apps/mobile/components/mobile/theme.ts` before touching tokens
- Preserve `glassConfig.useRealBlurOnAndroid = false`
- Do not create second theme authority — Stitch tokens map into `mobileTheme`
