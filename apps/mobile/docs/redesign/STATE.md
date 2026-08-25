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
- [x] Wave 2 — Work / Tasks / Projects (segmented Tasks|Projects, context FAB)
- [x] Wave 3 — Goals (health vs status Chips, ProgressBar+fraction, +Add next step, placeholderData)
- [ ] Wave 4 — Timer + Profile (avatar header, timer clock isolation)
- [ ] Wave 5 — Welcome + Login + Search
- [ ] Wave 6 — Create flows (Task/Project/Goal)
- [ ] Wave 7 — Detail/Edit flows (Task/Project/Goal)
- [ ] Wave 8 — Performance + accessibility hardening
- [ ] Wave 9 — Final independent review

## Current Wave
Wave 3 — COMPLETE (awaiting parent commit)

## Commits
- `chore(mobile-ui): initialize redesign tracking` — c251851
- `refactor(mobile-ui): establish redesign foundation` — 132ab8d (Wave 0)
- `feat(mobile-ui): redesign today experience` — d51c48a (Wave 1)
- `feat(mobile-ui): introduce work hub` — 21f0d6d (Wave 2)
- Wave 3 working tree: Goals parity — Active/Archived/All + health/status Chips + ProgressBar fraction + Add next step (uncommitted, base dca2dceaa, HEAD 21f0d6d)

## Tests
- `npm run typecheck` — exit 0 (2026-08-25, .worktrees/ui-mobile/apps/mobile) — Wave 0
- `npm run test` — exit 0 (166/166 passed, 29 suites, 9.6s) — Wave 0, fixed HeaderActions auth fallback for timer.test
- Wave 1: `npx tsc --noEmit` (apps/mobile) — exit 0 (2026-08-25)
- Wave 1: `npm run test` (apps/mobile) — exit 0 (166/166 passed, 29 suites, 7.6s) — fixed IconButton minHeight to satisfy TodayTaskCard 44 target (cards-a11y-test)
- Wave 2: `npx tsc --noEmit` (apps/mobile) — exit 0 (2026-08-25)
- Wave 2: `npm run test` (apps/mobile) — exit 0 (166/166 passed, 29 suites, 6.4s) — fixed TaskCard mainTap borderRadius 10 to satisfy cards-a11y-test
- Wave 3: `npx tsc --noEmit` (apps/mobile) — exit 0 (2026-08-25)
- Wave 3: `npx tsc --noEmit` (worktree root) — exit 0 (2026-08-25)
- Wave 3: `npm run mobile:test` (worktree root via `npm --prefix apps/mobile`) — exit 0 (166/166 passed, 29 suites, 6.7s) — updated GoalCard-test to expect `1 / 2 tasks` fraction (bar+fraction, not bar+percent+count triple) to match ProjectCard parity
- Wave 3: `git diff --check` — exit 0 (no whitespace errors)
- `npm run doctor` — exit 1 (only @types/react minor mismatch ~19.1.10 vs 19.2.14, unrelated to Wave 0/1/2/3)
- `npm run validate:bundle` — exit 1 (ENOENT /worktree/node_modules — worktree lacks root node_modules, not code defect)
- Mobile-only diff — `git diff --name-only dca2dce...HEAD` (Wave 0/1/2) and `git diff --name-only dca2dce` + `ls-files --others` (Wave 1/2/3 working tree) → all `apps/mobile/**` only → `awk '!/^apps\/mobile\//'` empty + others also `apps/mobile/**` only ✓

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

## Files Changed (Wave 2)
- Modified: `apps/mobile/features/tasks/query.ts` (adds `placeholderData:(prev)=>prev` to keep stale rows during filter switching / refetch; query keys unchanged)
- Modified: `apps/mobile/features/projects/query.ts` (adds `placeholderData:(prev)=>prev`; keeps `projectQueryKeys.list(view)` unchanged)
- Modified: `apps/mobile/components/mobile/TaskCard.tsx` (now re-export alias to canonical `features/tasks/components/TaskCard.tsx`; Chip via chipTone, not GlassPill)
- Modified: `apps/mobile/components/mobile/ProjectCard.tsx` (now alias to `features/projects/components/ProjectCard.tsx` + `projectStatusTone` delegates to central `statusTone`; no triple progress)
- Modified: `apps/mobile/app/(app)/(tabs)/work.tsx` (Work hub: ScreenHeader Execution/Work + HeaderActions + WorkModeSelector Tasks|Projects sync via useLocalSearchParams+local state; body flex1 renders TasksListView|ProjectsListView; single FloatingActionButton context-aware Tasks→New Task / Projects→New Project; removed ScrollView+map 8-row preview + duplicate summaryRow)
- Modified: `apps/mobile/app/(app)/(tabs)/tasks.tsx` (compat hidden route href:null — AppScreen with ScreenHeader Execution/Tasks + HeaderActions + TasksListView + FAB New Task; preserves deep link `/(app)/(tabs)/tasks` without duplicating glass logic)
- Modified: `apps/mobile/app/(app)/(tabs)/projects.tsx` (compat hidden route — AppScreen Planning/Projects + ProjectsListView + FAB New Project)
- Created: `apps/mobile/features/work/WorkModeSelector.tsx` (SegmentedControl Tasks|Projects wrapper, thin boundary)
- Created: `apps/mobile/features/tasks/components/TaskCard.tsx` (canonical Card+Chip+Button/IconButton; left accent via statusTone, priority Chip dot via chipTone, calendar Due pill, timer estimate pill, blocked dangerBg box, muted 0.72 for done, Pressable mainTap borderRadius sm 10 for a11y test, actions Edit+IconButton 44)
- Created: `apps/mobile/features/tasks/components/TaskQuickFilters.tsx` (horizontal ScrollView TASK_VIEW_PRESETS pills 36h, selected accent, Custom pill when matchTaskViewPreset===null)
- Created: `apps/mobile/features/tasks/components/TaskFilters.tsx` (collapsible Card header filter-outline + Filters + activeCount pill + Clear + chevron; expanded shows Status/Priority/Due SegmentedControls; activeCount computed from 5 dims)
- Created: `apps/mobile/features/tasks/components/TasksListView.tsx` (FlatList virtualized keyExtractor item.id initialNumToRender 10 windowSize 5; filters status/priority/due/sort+searchQuery client filter; server counters via counters.total/byStatus/byPriority; matchTaskViewPreset + TASK_VIEW_PRESETS parity; SearchField always visible; TaskQuickFilters always visible; advanced TaskFilters collapsible; counters Showing X of Y + summary tiles Visible/Active/Blocked/Urgent + subtle refreshing hint; placeholderData via query; RefreshControl subtle; ActionSheet Status/Priority/Due/Open; mutations via useUpdateTaskMutation with per-row busy+inline error; EmptyState compact with Clear filters+Create; skeleton 3× when pending; error FeedbackBanner+Retry; preserves formatDueDate/estimate/blockedReason/goal/project name uppercase)
- Created: `apps/mobile/features/projects/components/ProjectCard.tsx` (canonical Card+Chip+ProgressBar; status Chip via chipTone, title+description 2-line, single progress row ProgressBar flex1 + `completed/taskCount tasks` fraction; no triple bar+fraction+percent duplication; overflow IconButton ghost 44 absolute)
- Created: `apps/mobile/features/projects/components/ProjectsListView.tsx` (FlatList virtualized same params; filter view Active/Archived/All via SegmentedControl + client SearchField; server ProjectsReadModel; counters filtered length + view hint; FeedbackBanner subtle; ActionSheet status→planned/active/done/paused + archive/unarchive; mutations pending; empty per view/copy; skeleton; retry)
- Created: `apps/mobile/docs/redesign/research-wave-2.md` (Mobbin tasks list/filter bar, Page Flows work switcher, Refero card density, Screenlane project progress, Mobbin FAB & empties — each SOURCE/PATTERN/WHY/ADOPT/REJECT with Wave2 cross-reference decisions)

## Files Changed (Wave 3)
- Modified: `apps/mobile/features/goals/query.ts` (adds `placeholderData:(prev)=>prev` to keep stale goals during view switching / refetch; keys unchanged; invalidations preserved for lists/detail/projects detail)
- Modified: `apps/mobile/components/mobile/GoalCard.tsx` (now alias to canonical `features/goals/components/GoalCard.tsx` + `goalHealthTone`/`goalStatusTone` delegate to central `healthTone`/`statusTone`; no GlassPill)
- Modified: `apps/mobile/components/__tests__/GoalCard-test.tsx` (progress assertion now `1 / 2 tasks` fraction via bar+fraction, not `50%` — aligns with ProjectCard `1 / 4 tasks` parity and removes triple bar+percent+count)
- Modified: `apps/mobile/app/(app)/(tabs)/goals.tsx` (migrated MobileScreen/GlassCard/GlassButton/GlassSegmentedControl → AppScreen/ScreenHeader/FloatingActionButton + GoalsListView; header eyebrow Planning + title Goals + description outcomes health + next step + HeaderActions; body flex1 GoalsListView; single FloatingActionButton New Goal → `/(app)/goals/create`; floatingTabClearance 160 via FlatList contentContainer)
- Created: `apps/mobile/features/goals/components/GoalCard.tsx` (canonical Card+Chip×2+ProgressBar+nextStep; title 16/700 2-line, project uppercase 11/600 0.6 muted, badgeRow two Chips kind=status/health via chipTone central (health null muted slate “No health” dot #94a3b8, status via statusTone), left accent via healthTone or statusTone, nextStep row icon arrow-forward-circle 14 accent + muted 13 text 2-line or Button `+ Add next step` secondary sm leftIcon add 44h when missing → opens sheet, progressRow ProgressBar flex1 value clamped progressPercent + fraction `${completed}/${total} tasks` honest where completed=linkedTasks.filter(done).length, not triple bar+percent+count; Pressable mainTap focusable borderRadius sm 10 opacity 0.72 pressed, overflow IconButton ghost 44 absolute top 6 right 6; muted done title textSubtle)
- Created: `apps/mobile/features/goals/components/GoalsListView.tsx` (FlatList virtualized keyExtractor item.id initialNumToRender 10 windowSize 5 maxToRenderPerBatch 10 removeClippedSubviews false contentContainer paddingBottom floatingTabClearance 160 paddingHorizontal lg 20 paddingTop sm 8; filter Active/Archived/All SegmentedControl driving useGoalListQuery(view) with placeholderData; ListHeader SegmentedControl + counter `X goal(s) · view` + Refreshing hint + FeedbackBanner; ListEmpty Card+EmptyState per view (Active → Create CTA, Archived → archive copy, All → nothing); ActionSheet Status (draft/active/done/paused disabled when equal) + Health (on_track/at_risk/off_track) + Archive/Unarchive + Update next step (general); mutations via useUpdateGoalStatus/Health/NextStep/Archive/Unarchive with invalidateGoalLists; Modal bottom sheet 28r overlay rgba(15,23,42,0.45) handle 5×44 title Next step subtitle goal.title TextInput 96 multiline border lg control shadow + Cancel ghost + Save primary loading; useFocusEffect refetch; preserves all query invalidations; one FAB in parent goals.tsx)
- Created: `apps/mobile/docs/redesign/research-wave-3.md` (Mobbin goals OKR health, Refero density hierarchy, Screenlane progress fraction, Mobbin+Refero next-step FAB — each SOURCE/PATTERN/WHY/ADOPT/REJECT with Wave3 cross-reference decisions)

## Known Issues
- `.worktrees` now git-ignored via `.git/info/exclude` (not tracking root `.gitignore` per mobile-only scope)
- Timer test previously failed due to HeaderActions requiring AuthProvider — fixed via useAuthSafe fallback
- TodayTaskCard 44 target test fixed via IconButton minHeight/minWidth (Wave 1) — ensures ghost actions button meets 44 without hitSlop
- TaskCard mainTap test fixed via Pressable borderRadius sm 10 in features/tasks/components/TaskCard.tsx (Wave 2) — satisfies cards-a11y-test
- GoalCard-test progress asserted `1 / 2 tasks` fraction (Wave 3) to avoid triple bar+percent+count — aligns with ProjectCard `1 / 4 tasks` parity (old `50%` removed)
- Bundle export fails in worktree without root node_modules install (not Wave 0/1 regression)
- Legacy MobileScreen/Glass* remain as compat until respective waves (tasks/projects/goals detail/create screens still glass until Waves 6–7)
- DailyMomentum ring visualizes completion ratio (completed/total) not trackedToday seconds vs estimate — honest math, no fake min
- Work hub client search is title/project/goal substring (no new endpoint); server filtering remains canonical for status/priority/due/sort
- Goals progress `completed / total tasks` client-derived from `linkedTasks.filter(done)` — consistent with server `progressPercent = round(completed/total*100)` (see `getGoalsReadModel`)

## Next
- Wave 4 — Timer clock isolation + avatar header polish

## Handoff Notes for Next Wave Agent
- Read `apps/mobile/components/mobile/theme.ts` before touching tokens
- Preserve `glassConfig.useRealBlurOnAndroid = false`
- Do not create second theme authority — Stitch tokens map into `mobileTheme`
- Today parity preserves SectionList virtualization (keyExtractor item.id) + floatingTabClearance 160 — do not replace with ScrollView+map
- Work parity preserves FlatList virtualization (keyExtractor item.id, initialNumToRender 10, windowSize 5) + floatingTabClearance 160 — same no ScrollView+map for large collections
- Goals parity preserves FlatList virtualization (same params) + floatingTabClearance 160 + placeholderData:(prev)=>prev keep-previous — maintain for Timer
- Chip is single primitive via chipTone(kind,value) — do not reintroduce StatusChip/PriorityChip or InfoBadge/GlassPill; status vs health distinct Chips (two chips) must stay separate, health muted when null with “No health” label and slate dot
- ProjectCard and GoalCard progress is single primary (ProgressBar flex1 + fraction `completed / total tasks`) — do not reintroduce bar+fraction+percent triple or percent-only; bar width is honest `progressPercent` clamped 0–100, fraction derived from `linkedTasks.filter(done)`
- Goals `+ Add next step` button affordance (secondary sm + add icon) → bottom sheet 28r with 96h TextInput + Cancel/Save must remain when nextStep null — not just text
- research-wave-1/2/3 decisions (no fake min, no duplicate metric, compact empties, quick-filters always visible, advanced collapsible, one context FAB, keep-previous placeholderData) apply to later waves
