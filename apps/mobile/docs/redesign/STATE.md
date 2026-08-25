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
- [x] Wave 0 — Design system + navigation (4-tab Work hub, hidden compat routes)
- [x] Wave 1 — Today (Daily Momentum ring + progress bar, 4 sections, Suggestions, Card/Chip/ProgressBar parity)
- [ ] Wave 2 — Work / Tasks / Projects (segmented Tasks|Projects, context FAB)
- [ ] Wave 3 — Goals
- [ ] Wave 4 — Timer + Profile (avatar header, timer clock isolation)
- [ ] Wave 5 — Welcome + Login + Search
- [ ] Wave 6 — Create flows (Task/Project/Goal)
- [ ] Wave 7 — Detail/Edit flows (Task/Project/Goal)
- [ ] Wave 8 — Performance + accessibility hardening
- [ ] Wave 9 — Final independent review

## Current Wave
Wave 1 — COMPLETE (awaiting parent commit)

## Commits
- `chore(mobile-ui): initialize redesign tracking` — c251851
- `refactor(mobile-ui): establish redesign foundation` — 132ab8d (Wave 0)
- Wave 1 working tree: Today redesign — DailyMomentum + Sections + TaskCard parity (uncommitted, base dca2dceaa, HEAD 132ab8d)

## Tests
- `npm run typecheck` — exit 0 (2026-08-25, .worktrees/ui-mobile/apps/mobile) — Wave 0
- `npm run test` — exit 0 (166/166 passed, 29 suites, 9.6s) — Wave 0, fixed HeaderActions auth fallback for timer.test
- Wave 1: `npx tsc --noEmit` (apps/mobile) — exit 0 (2026-08-25)
- Wave 1: `npm run test` (apps/mobile) — exit 0 (166/166 passed, 29 suites, 7.6s) — fixed IconButton minHeight to satisfy TodayTaskCard 44 target (cards-a11y-test)
- `git diff --check` — exit 0 (no whitespace errors) — Wave 0 + Wave 1
- `npm run doctor` — exit 1 (only @types/react minor mismatch ~19.1.10 vs 19.2.14, unrelated to Wave 0/1)
- `npm run validate:bundle` — exit 1 (ENOENT /worktree/node_modules — worktree lacks root node_modules, not code defect)
- Mobile-only diff — `git diff --name-only dca2dce...HEAD` (Wave 0) and `git diff --name-only dca2dce` (Wave 1 working tree) → all `apps/mobile/**` only → `awk '!/^apps\/mobile\//'` empty + `ls-files --others --exclude-standard` also `apps/mobile/**` only ✓

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

## Files Changed (Wave 1)
- Modified: `apps/mobile/app/(app)/(tabs)/today.tsx` (migrated MobileScreen/GlassCard/GlassButton → AppScreen/ScreenHeader/Card/Button/FeedbackBanner/Skeleton; SectionList retained with keyExtractor item.id, contentContainer paddingBottom floatingTabClearance 160; header eyebrow weekday + title Today + description trackedTodayLabel·selectedCount + HeaderActions; DailyMomentum + TodaySection + TodayTaskCard decomposition; preserved all mutations runStatusAction/runInlineUpdate/runRemoveFromToday/runAddSuggestion/runClearCompleted/actionError/activeTaskId/activeSuggestionId/selectedTaskId sheet/onRefresh/useFocusEffect refetch; completedRatio=Math.round(completed/total*100) no fake min; placeholderData keeps existing content during refetch, RefreshControl subtle; Suggestions Card with Pinned/Recently active; compact EmptyState per section; motion press 100–140ms via Button/IconButton, no list animation)
- Modified: `apps/mobile/components/mobile/TodayTaskCard.tsx` (delegates to feature component; ensures Chip via chipTone, not GlassPill/InfoBadge)
- Modified: `apps/mobile/components/mobile/ui/IconButton.tsx` (adds minHeight/minWidth 44 to satisfy TodayTaskCard 44 target while preserving height/width for TaskCard/ProjectCard/GoalCard)
- Modified: `apps/mobile/features/today/query.ts` (adds placeholderData: (previousData)=>previousData to keep existing content during refetch rather than spinner)
- Created: `apps/mobile/features/today/components/DailyMomentum.tsx` (Card with tracked-time ring via react-native-svg, progress Math.round no fake min, shows inProgress/completed/overdue stats, ProgressBar width completedRatio, date toDateString, Clear completed danger Button when clearableCompletedCount>0)
- Created: `apps/mobile/features/today/components/TodaySection.tsx` (TodaySectionHeader with accent left border + count pill, TodaySectionEmpty Card wrapping compact EmptyState icon list-outline 22 title No tasks)
- Created: `apps/mobile/features/today/components/TodayTaskCard.tsx` (Card + left accent via statusTone, Chip kind=status/priority via chipTone, due pill with calendar icon, blockedReason dangerBg box, actions Button primary/secondary + IconButton ghost 44h, muted opacity, priority dot, project uppercase)
- Created: `apps/mobile/docs/redesign/research-wave-1.md` (Mobbin daily planner, Page Flows time-tracking ring, Refero status grouping, Screenlane compact empties, Mobbin task card density — each SOURCE/PATTERN/WHY/ADOPT/REJECT)

## Known Issues
- `.worktrees` now git-ignored via `.git/info/exclude` (not tracking root `.gitignore` per mobile-only scope)
- Timer test previously failed due to HeaderActions requiring AuthProvider — fixed via useAuthSafe fallback
- TodayTaskCard 44 target test fixed via IconButton minHeight/minWidth (Wave 1) — ensures ghost actions button meets 44 without hitSlop
- Bundle export fails in worktree without root node_modules install (not Wave 0/1 regression)
- No design system refactor beyond Wave 1 scope — legacy MobileScreen/Glass* remain as compat until respective waves
- DailyMomentum ring currently visualizes completion ratio (completed/total) not trackedToday seconds vs estimate (no target data to invent) — honest math, no fake min, no duplicate tracked metric

## Next
- Wave 2 — Work full tasks/projects parity (segmented Tasks|Projects + TaskCard/ProjectCard using Card/Chip, context FAB, virtualized FlatList, preserve filters/sorts)
- Wave 3 — Goals, Wave 4 — Timer clock isolation + avatar polish

## Handoff Notes for Next Wave Agent
- Read `apps/mobile/components/mobile/theme.ts` before touching tokens
- Preserve `glassConfig.useRealBlurOnAndroid = false`
- Do not create second theme authority — Stitch tokens map into `mobileTheme`
- Today parity preserves SectionList virtualization (keyExtractor item.id) + floatingTabClearance 160 — do not replace with ScrollView+map
- Today query uses placeholderData: (prev)=>prev to keep content during refetch — maintain pattern for Work/Goals/Timer
- Chip is single primitive via chipTone(kind,value) — do not reintroduce StatusChip/PriorityChip or InfoBadge/GlassPill
- research-wave-1 decisions (no fake min, no duplicate metric, compact empties) apply to later waves
