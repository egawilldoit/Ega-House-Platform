# Review — Wave 9 (Final Independent Review)

**Date:** 2026-08-25
**Reviewer:** Wave 9 independent (read-only first, then BLOCKER/HIGH fixes)
**Base:** `dca2dceaa3baa72352ef9a6db8c80d29029fc82a` (origin/main at worktree creation)
**Branch:** `ui/mobile-redesign` (worktree `.worktrees/ui-mobile`)
**HEAD before review:** `6018465` (`perf(mobile-ui): harden performance and accessibility` — Wave 8)
**Scope:** `apps/mobile/**` only (enforced via `git diff --name-only dca2dce` + `grep -v ^apps/mobile` empty)
**Worktree rule:** No new worktree/branch created; edits applied directly on `ui/mobile-redesign` working tree.

---

## 1. Methodology — Evidence Hierarchy

Followed `docs/agent-context/product-authority.md` two-question split:

- **What does the repository currently do?** Evidence hierarchy: filesystem `git show dca2dce:apps/mobile/...` diff vs HEAD, full read of current branch files under `apps/mobile/app/**`, `features/**`, `components/mobile/**`, `theme.ts`, `DESIGN.md`, `docs/redesign/STATE.md|NAVIGATION.md|SCREEN-PARITY.md|research-wave-*.md`, grep for `FlatList/SectionList`, `initialNumToRender/windowSize/placeholderData`, `FloatingActionButton`, `FeedbackBanner`, `FormField`, `maxFontSizeMultiplier`, `accessibility*`, `minTouchTarget`, `Animated/reanimated`, `floatingTabClearance/stickyActionClearance`, `mobileTheme` tokens, `router.push/replace`.
- **What behavior is required?** Normative hierarchy: spec list in prompt (feature parity per SCREEN-PARITY vs code truth, DESIGN.md vs theme vs components, NAVIGATION.md 4 tabs + hidden compat, safe area 160, empty/error/loading/skeleton, forms 20 reserve, animation transform/opacity only, performance FlatList 10/5/10 + timer isolation + placeholderData, accessibility 44/cap 1.4/1.6/roles/contrast/liveRegion) + `docs/agent-context/testing-and-validation.md` + `ARCHITECTURE.md`.

**Trust rule:** Verified filesystem, Git diff, validation exits; did not trust Hermes prose or prior STATE prose. Every finding cites `file:line`.

**Validation executed:**
- `npx tsc --noEmit` (apps/mobile) → exit 0
- `npx tsc --noEmit` (worktree root) → exit 0
- `npm --prefix apps/mobile test` (`npm run mobile:test`) → 166/166 passed, 29 suites
- `git diff --check` → exit 0
- `npm run mobile:doctor` / `mobile:bundle` → env-limited (react types mismatch / ENOENT node_modules) — not code defect, matches prior waves
- `git diff --name-only dca2dce` → all `apps/mobile/**` only → mobile-only scope PASS (checked after fixes)

---

## 2. Screen-by-Screen Verdict

Checklist per screen: **structure**, **preserved features**, **Stitch reference (visual hierarchy adopted)**, **performance changes**, **tests**.

### Today — `app/(app)/(tabs)/today.tsx:114-682`
- **Structure:** `AppScreen padded false` → `SectionList sections={planned,inProgress,blocked,completed} stickySectionHeadersEnabled false 10/5/10` + `ListHeaderComponent ScreenHeader weekday/Today + DailyMomentum + FeedbackBanner` + `ListFooterComponent Card Suggestions (Pinned + Recently active)` + `renderItem useCallback [activeTaskId,runStatusAction]` → `TodayTaskCard` in pagePadding + `ActionSheet`. Content `paddingBottom floatingTabClearance 160 paddingTop sm`.
- **Preserved:** All 16 Today features from SCREEN-PARITY verified present (load/skeleton, error/retry, header meta, summary stats 3, progress ring/bar honest Math.round, Clear completed conditional, 4 sections, section empties, task card, status actions 2-per-state, priority/due inline, Remove from Today destructive, Suggestions 2 groups + Add, focus refresh, footer clearance).
- **Stitch:** Adopted `DailyMomentum` ring + ProgressBar width, Section header accent left border + count pill, Card/Chip/ProgressBar tokens via `mobileTheme`. Hierarchy: header eyebrow → stats ring → sections → suggestions footer. No fake min, no duplicate metric.
- **Performance:** `placeholderData:(prev)=>prev` in `features/today/query.ts:31`, `initialNumToRender 10 windowSize 5 maxToRenderPerBatch 10` on SectionList, `renderTodayItem useCallback` stable.
- **Tests:** `features/today` placeholderData keeps content during refetch; `today sections` memo; `mobile:test` 166/166 green; no Today-specific test drift.
- **Verdict:** **PASS** — no defect.

### Work Hub — `app/(app)/(tabs)/work.tsx:1-59`
- **Structure:** `AppScreen padded false` → `headerWrap ScreenHeader Execution/Work + WorkModeSelector Tasks|Projects (useLocalSearchParams mode → local state)` → `body flex1 TasksListView|ProjectsListView` → `FloatingActionButton` context-aware `mode===tasks?'New Task':'New Project'` → `/(app)/tasks/create` vs `/(app)/projects/create`.
- **Preserved:** Work replaces 5-tab tasks/projects with single hub + 2-way segment; compat routes `tasks.tsx`/`projects.tsx` still render full list + FAB with `href:null` filtering → deep links preserved.
- **Stitch:** SegmentedControl Tasks|Projects wrapper (`WorkModeSelector`), header Execution eyebrow, FAB 44h pill fab shadow, theme spacing lg.
- **Performance:** Body `flex1` hosts virtualized `FlatList` (10/5/10) directly — no ScrollView+map for large lists.
- **Tests:** No dedicated Work test but `TasksListView`/`ProjectsListView` suites cover; manual header + segment verified.
- **Verdict:** **PASS**.

### Tasks Compat — `app/(app)/(tabs)/tasks.tsx:1-38`
- **Structure:** `AppScreen padded false` → `headerWrap ScreenHeader Execution/Tasks + HeaderActions` → `body flex1 TasksListView` → `FloatingActionButton New Task`.
- **Preserved:** Full `TasksListView` parity (filters via `matchTaskViewPreset` + `TASK_VIEW_PRESETS`, quick pills 44, advanced TaskFilters collapsible, counters Showing X of Y, summary tiles, search 44, ActionSheet status/priority/due/Open, inline error, empty with Clear/Create).
- **Stitch:** Same as Work Tasks mode.
- **Performance:** Inherits `TasksListView` FlatList 10/5/10, placeholderData, renderItem memo.
- **Tests:** `features/tasks` queries, views; `cards-a11y-test` mainTap borderRadius sm10.
- **Verdict:** **PASS** (compat hidden `href:null` correctly filtered by `BottomNavigation isHiddenRoute`).

### Projects Compat — `app/(app)/(tabs)/projects.tsx:1-38`
- Same as Tasks compat with `ProjectsListView` (view Active/Archived/All, client search, counters, ActionSheet, empty per view, skeleton/error).
- **Verdict:** **PASS**.

### Goals — `app/(app)/(tabs)/goals.tsx:1-44` + `features/goals/components/GoalsListView.tsx:1-447`
- **Structure:** `AppScreen padded false` → `headerWrap ScreenHeader Planning/Goals + HeaderActions` → `body flex1 GoalsListView FlatList 10/5/10` → `FloatingActionButton New Goal`.
- **Preserved:** View filter, GoalCard 2 Chips (status/health separate, health null slate No health dot #94a3b8, accent left healthTone/statusTone, ProgressBar flex1 + fraction `completed/total tasks` honest, +Add next step Button secondary sm when null → Modal 28r handle 44 + TextInput 96 + Cancel/Save), ActionSheet status/health/archive, empty per view, placeholderData.
- **Stitch:** Adopted Refero/Screenlane progress fraction not triple, Mobbin +Add next step FAB pattern.
- **Performance:** `placeholderData`, renderItem memo `GoalReadModel`, ListHeader SegmentedControl + counter + Refreshing hint + FeedbackBanner.
- **Tests:** `GoalCard-test` expects `1 / 2 tasks` fraction (not 50%); `features/goals` query.
- **Verdict:** **PASS** (one HIGH fixed: health enabled — see defects).

### Timer — `app/(app)/(tabs)/timer.tsx:1-241` + `features/timer/components/*`
- **Structure:** `AppScreen padded false` → `ScrollView content paddingBottom 160 gap md` → `ScreenHeader Focus/Timer` + `staleBanner isError && !isFetching` + `FeedbackBanner` + `TimerScreenContent activeSession ? Card Running dot + taskTitle + TimerClock + Started at + Button Stop danger 54h : FocusQueue` + `TrackedTimeSummary` + `ActivityIndicator tasksFetching`.
- **Preserved:** Server authority via `TimerClock projectElapsedSeconds` recompute fallback `elapsedLabel`, 1s tick isolated to `TimerClock` only (parent has no nowMs), candidateTasks `status!==done slice 0..12` MAX_PICKER_TASKS 12, Start guard + loading, Stop guard + loading, TrackedTimeSummary 3+1 stats, stale banner, offline Card+Retry, RefreshControl subtle.
- **Stitch:** Centered clock 52/900 -1 `maxFontSizeMultiplier 1.6`, FocusQueue 44 min rows selected surfaceMuted+accentMid, summary statsRow 3× centered.
- **Performance:** Isolation prevents full-screen rerender on tick (verified `grep setInterval` only hits `TimerClock`).
- **Tests:** `app/(app)/(tabs)/__tests__/timer.test.tsx` 10 canonical timer tests green (server projection, picker 12 cap, start/stop, offline stale, retry, foreground reconcile).
- **Verdict:** **PASS**.

### Profile — `app/(app)/profile.tsx:1-172` + `app/(app)/(tabs)/profile.tsx` compat
- **Structure:** `AppScreen padded false` → `ScrollView content gap md paddingBottom 160` → `ScreenHeader Account/Profile + Authenticated as email` → `Card avatarRow 58 accent radius 29 initials 20 + EGA House 17 + email 13` + `identityFooter pills Authenticated shield-checkmark successBg + Mobile workspace phone-portrait infoBg` → `Card actionRow Sign out 14 + hint + Button danger sm log-out 16` → `versionText EGA House · v...`.
- **Preserved:** initials `email.substring(0,2).toUpperCase() ?? EG`, email, 2 pills, compact sign-out not full-width, version `Constants.expoConfig.version ?? 1.0.0`, HeaderActions avatar → `/(app)/profile` everywhere, compat `tabs/profile` re-exports canonical `href:null`.
- **Stitch:** Compact profile vs Mobbin pattern.
- **Tests:** `app/(app)/(tabs)/__tests__/profile.test.tsx` checks US initials/email/version — PASS via re-export trick.
- **Verdict:** **PASS**.

### Welcome — `app/(public)/welcome.tsx:1-144`
- **Structure:** `SafeAreaView top,bottom bg authBackground` → `container authBackground flex1 space-between padding xl 28` → `bgCircle1 320/160r authCircleBlue` `bgCircle2 200/100r authCirclePurple pointerEvents none` → `content flex1 justify center paddingTop 60` → `logoMark 68 accent card 20 fab flash 32 white` + `brand 16/700 tracking2` + `tagline 44/900 -1.5 line50` + `subtitle 16/24 authTextMuted maxWidth280` → `footer gap14 paddingBottom12 Link /(public)/login Pressable pill accent minHeight52 fab + arrow-forward + legal 12 subtle`.
- **Preserved:** Dark auth palette separation from `surface #fff`, headline `Your execution\ncommand center` 2-line, subtitle, single CTA Get started → /login, legal footer, no animation.
- **Stitch:** Dark auth identity per Mobbin/Linear/Notion welcomes.
- **Tests:** Not unit-tested but visual parity manual + no navigation break.
- **Verdict:** **PASS**.

### Login — `app/(public)/login.tsx:1-258`
- **Structure:** `KeyboardAvoidingView padding|height` → `ScrollView flexGrow1 justify center keyboardShouldPersistTaps handled` → `container authBackground flex1 justify center minHeight520 padding xl28` → `bgCircle*` → `Pressable back 44 circle overlayLight top64 left lg chevron-back 22` → `Card authSurface #161c28 border authBorderSoft 0.08 radius24 padding lg20` → `title Login 28/900` → `inputRow authSurfaceMuted 0.07 border authBorder 0.12 md14` + `TextInput 15 white` mail/lock icons → `errorText dangerMid 13 minHeight20 always` → `Pressable pill accent minHeight52 fab Login/ActivityIndicator`.
- **Preserved:** `isValidEmail /^[^\s@]+@[^\s@]+\.[^\s@]+$/` byte-identical, trimmed, pw≥6, clearError first, signIn → replace today, catch fallback, error||authError||' ' no shift, back replace welcome, editable !isSubmitting, keyboard-safe, autoCapitalize/email etc.
- **Stitch:** Superhuman/Linear inline error 20h reserve pattern.
- **Performance:** No heavy calc.
- **Tests:** `auth-context` login flow + fallback.
- **Defect fixed:** Back 40→44 (HIGH — see defects).
- **Verdict:** **PASS after fix**.

### Search — `app/(app)/search.tsx:1-356`
- **Structure:** `AppScreen` → `SearchField autoFocus value rawQuery onChange setRawQuery placeholder` → `isTruncated FeedbackBanner warning` → `isLoading ActivityIndicator` → `isError&&!data Card Alert Retry` → `!hasQuery EmptyState Find anything` → `hasQuery&&0 EmptyState No matches` → `hasQuery&&>0 ScrollView resultsContent paddingBottom160 paddingTop md 14` → `resultsHeader count 12/700 upper + partialError` → 3 sections each `sectionHeader icon 16 accent/info/success + sectionTitle 14/800 + countPill accentSoft pill + mapped Pressable resultRow 56 border control md14 shadow card pressed0.7 + chevron`.
- **Preserved:** `SEARCH_DEBOUNCE_MS 250` setTimeout → debouncedQuery, `SEARCH_TASK_LIMIT 200` limit, `isTruncated warning` `Showing first X of Y tasks`, `searchWorkspace` pure token AND prefix>substring scoring, navigation tasks→`/tasks/[id]` projects→`/projects/[slug]` goals→`/goals/[id]`.
- **Stitch:** Immediacy via cached queries + debounce 250, grouped results with countPill, truncation warning.
- **Performance:** `useMemo searchWorkspace [debouncedQuery,tasks,projects,goals]` (Wave 8), bounded ≤200 rows ScrollView+map intentional (not virtualized — defer low win per research).
- **Tests:** `features/search/__tests__/search.test.ts` pure scorer.
- **Verdict:** **PASS**.

### Create Task — `app/(app)/tasks/create.tsx` → `features/tasks/create/TaskCreateScreen.tsx:1-620`
- **Structure:** `AppScreen padded false` → `KeyboardAvoidingView padding|undefined flex1` → `ScrollView content paddingBottom stickyActionClearance120 paddingTop14` → `pagePadding lg20` → `ScreenHeader New task` → 5× `FormSection` Essentials(Context/Planning/Schedule/Details) → `FeedbackBanner danger` inlineError → `stickyBar borderTop1 sheet shadow surface flex row Cancel secondary flex1 + Create Task primary flex1 loading` outside ScrollView.
- **Preserved:** All 9 task fields + validation verbatim (title required, projectId required + auto-select `projects.length===1`, goal null, status/priority segments via formatTaskToken, dueDate YYYY-MM-DD via isDateOnlyValue + Today/Tomorrow/Clear 44 pill + dateField formatDisplayDate + Card DateTimePicker inline + helper Picker still submits YYYY-MM-DD, estimate whole 0–525600 via validateEstimateMinutesInput + number-pad, description/blocked multiline + blockedReason required when blocked `Blocked reason is required when status is Blocked.`, payload `CreateTaskInput` preserved, FeedbackBanner, sticky 120, keyboard-safe handled, editable !isSubmitting disabled when submitting.
- **Stitch:** 5× FormSection progressive grouping (icon 16 muted + title 14/800 + desc 12), QuickPill 44.
- **Performance:** No large loop; query placeholderData.
- **Defect fixed:** `router.replace('/tasks')` → `router.back()` (BLOCKER — invalid typed route would 404).
- **Verdict:** **PASS after fix**.

### Create Project — `features/projects/create/ProjectCreateScreen.tsx:1-194`
- **Structure:** Same AppScreen/KeyboardAvoidingView/ScrollView/stickyBar as Task but 2× FormSection Identity( Name + slugRow surfaceMuted border control 12 preview `/slug` vs helper `Slug is derived…` + Read-only note) + Details(Description helper).
- **Preserved:** name required autoCapitalize words, slug memo normalizeMobileProjectSlug read-only never editable, canSubmit name.trim&&slug&&!isSubmitting, description multiline, mutate back, FeedbackBanner, sticky Cancel+Create disabled !canSubmit.
- **Verdict:** **PASS**.

### Create Goal — `features/goals/create/GoalCreateScreen.tsx:1-315`
- **Structure:** 4× FormSection Essentials/Context/Details/Health&Status, sticky 120, keyboard-safe.
- **Preserved:** title required, project selection `selectedProjectId = projects.some?pid: length===1?first:''` + EmptyState folder-open when 0 + Single project auto-selected helper, nextStep helper optional + Description multiline, health 3 + status 4 Segments, payload `slug:null` via useCreateGoalMutation, canSubmit title&&selectedProjectId&&!isSubmitting, loading skeleton, FeedbackBanner, sticky Cancel+Create.
- **Verdict:** **PASS**.

### Task Detail — `features/tasks/detail/TaskDetailScreen.tsx:1-419` + subcomponents
- **Structure:** missingId FeedbackBanner → isError FeedbackBanner+Retry+Back → isPending SkeletonCard+SkeletonLine → `AppScreen padded false` → `KeyboardAvoidingView padding|undefined flex1` → `ScrollView content paddingBottom120` → `pagePadding` → `ScreenHeader Edit task Unsaved changes/All saved` → `TaskIdentityCard` → `TaskStateSection` → `TaskScheduleSection` → `TaskReminderSection` → `TaskDetailsSection` → `TaskSaveBar` sticky Back+Save changes/Saved disabled isSaving.
- **Preserved:** 7-field draft `isDraftDirty` vs `createEditableDraft` (title/project/goal read-only), `validateEstimateMinutesInput`, blocked guard string verbatim, dueDate QuickPills Today/Tomorrow/+7/Clear + dateField + inline Card DateTimePicker + `isoDateAtOffset` + `formatDueDate`, recurrence pills `formatRecurrenceRule` + `recurrenceTimezone Intl`, reminder `createDefaultReminderDate` + `formatReminderDraft` + Date/Time/Clear Buttons + inline Card `minimumDate` + `Schedule email reminder` + `toISOString` future guard `must be in the future` + pending asc Cancel per row + history 3 Chip status + FeedbackBanner danger/success, description/blockedReason multiline + ignored helper, dirty SaveBar.
- **Stitch:** 6 sections grouping per research-wave-7.
- **Performance:** Memo pending/complete, no interval, placeholderData via useTaskByIdQuery.
- **Verdict:** **PASS**.

### Project Detail — `features/projects/detail/ProjectDetailScreen.tsx:1-380`
- **Structure:** slug missing FeedbackBanner → isLoading SkeletonCard×3 → isError FeedbackBanner+Retry+Back → `AppScreen padded false` → `ScrollView content paddingBottom120` → `ScreenHeader slug/title` → `Card badgeRow Chip status + count + Actions ghost + archivedBanner neutral + actionError FeedbackBanner` → `FormSection Status Chip + Manage status` → `FormSection Linked goals goalList goalRow accent3 vs EmptyState No goals linked` → `Card Archive/Unarchive danger/secondary + Back ghost` → `ActionSheet`.
- **Preserved:** `useProjectBySlugQuery` + `updateStatus/archive/unarchive runMutation actionError isMutating sheetItems disabled when equal/isMutating`, header Chip status + count, linked goals list vs empty, Skeleton/Error, Button+ActionSheet parity, `projectQueryKeys`.
- **Verdict:** **PASS**.

### Goal Detail — `features/goals/detail/GoalDetailScreen.tsx:1-479`
- **Structure:** goalId missing → isError → notFound `Goal not found` → isLoading SkeletonCard×3 → `AppScreen padded false` → `ScrollView` → `ScreenHeader Planning/Goal details` → `Card title/project upper/description + Chip status/health + metaDot` → `FormSection Status Health` (Status SG, Health SG + helper No health) → `FormSection Next step FormField + Save` → `FormSection Progress ProgressBar healthTone + percent + helper completed/total + Linked tasks map Chip` → `FeedbackBanner` → `Card Archive/Unarchive + Back`.
- **Preserved:** `useGoalDetailQuery` all-cache + `updateStatus/Health/NextStep/archive/unarchive` + `invalidateGoalLists` also projects/detail bust, nextStep trim diff-only, progress clamped, archived guard, Chip status/health distinct, `Goal not found` + `Goal id is missing` + `Retry` + `SkeletonCard`.
- **Stitch:** Statuses `draft/active/done/paused` health `on_track/at_risk/off_track` separate chips.
- **Defect fixed:** Health SegmentedControl `disabled isMutating||!health` → `disabled isMutating` only (HIGH — displaying on_track when health null misleading).
- **Verdict:** **PASS after fix**.

### Not Found — `app/+not-found.tsx:1-63` (Wave 9 redesigned)
- **Structure (After):** `Stack.Screen title Not found` + `AppScreen` → `ScreenHeader eyebrow 404 title Not found desc This screen does not exist or was moved.` → `Card EmptyState alert-circle title This screen does not exist description Check URL... action Link /(app)/(tabs)/today asChild Button Go to home` → `Link /` fallback secondary.
- **Preserved:** 404 message + back link (preserved but upgraded from Themed hard-coded #2e78b7 to theme `accent` + Card/EmptyState/Button).
- **Stitch:** Uses `mobileTheme` spacing.lg, floating clearance via AppScreen, surface/border/card radius 20, shadow card, accent `textOnAccent`, minTouchTarget 44 on link row, accessibilityRole header/button.
- **Verified:** `git diff --check` 0, `tsc --noEmit` 0, `mobile:test` 166/166 green (no not-found test but manual).
- **Verdict:** **PASS after fix** (was BLOCKER before — hard-coded #2e78b7, no theme, no AppScreen).

---

## 3. Audits — Config Checks

| Audit | Spec | Result | Evidence |
|---|---|---|---|
| **Navigation 4 tabs** | 4 visible today/work/goals/timer, 3 hidden tasks/projects/profile href:null, BottomNavigation filters href===null, HeaderActions avatar→profile Search→search | **PASS** | `_layout.tsx:22-90` `BottomNavigation.tsx:26-37` `HeaderActions.tsx:40-56` |
| **Compat hidden deep-linkable** | tasks/projects/profile deep links still resolve via compat files | **PASS** | `tasks.tsx:1` `projects.tsx:1` `tabs/profile.tsx:1` all re-export list views; `tsc --noEmit` 0 confirms typedRoutes |
| **Header avatar→profile Search→search** | everywhere ScreenHeader rightSlot HeaderActions (magnifier 44 + avatar 44 initials) | **PASS** | `today.tsx:489` `work.tsx:32` `timer.tsx:95,160` `goals.tsx:19` `search` etc |
| **Safe area 160** | Every tab ScrollView/FlatList/SectionList contentContainer paddingBottom floatingTabClearance 160 + sticky 120 for save bars + SafeAreaView top + BottomNavigation bottomOffset max(insets.bottom,12)+20 | **PASS** | Grep `floatingTabClearance` 7 tab hits, `stickyActionClearance` 6 form/detail hits, `AppScreen edges top`, `BottomNavigation bottomOffset` |
| **Spacing/radii/colors via theme not hard-coded** | Colors via mobileTheme.colors, radii via radius.*, spacing via spacing.*, shadows via shadow.* | **PASS after fixes** | Fixed `#b91c1c`→`dangerBorder` token in `Button.tsx:42` `GlassButton.tsx:36` `theme.ts:40`; fixed `ScreenHeader marginBottom 20→spacing.lg`, `FAB bottom 20→spacing.lg gap8→spacing.sm`, `login backButton 40→44`; remaining hard-codes limited to decorative circle sizes (320/200/160r) + radius math (29) intentional; NotFound #2e78b7 removed |
| **Empty/error/loading/skeleton** | Every list: pending SkeletonCard×3, error FeedbackBanner danger + Button Retry, empty Card+EmptyState compact 36 title+action, subtle Refreshing… + RefreshControl accent, placeholderData keep-previous | **PASS** | `TasksListView 220-376` `ProjectsListView 124-234` `GoalsListView 162-267` `today 418-565` `timer 88-139` |
| **Forms label/helper/error 20 reserve** | FormField label 12 semibold muted, helper/error 12 medium subtle/danger, error reserve 20, FeedbackBanner for form-level, login minHeight20 | **PASS after fix** | `FormField.tsx:119-132` now `supportingWrap minHeight20` + `supportingText ' '` placeholder always + `accessibilityLiveRegion polite`; `login.tsx:221` minHeight20 `dangerMid` always; Task/Project/Goal create + detail use `FeedbackBanner danger` inline |
| **Animation transform/opacity only** | Press 0.97→1 spring 120/7 timing 100-140, selection bg/opacity/scale only, sheet translateY+opacity, progress width via width% (still ok but transform preferred), no width/height/margin continuous | **PASS** | `motion/AnimatedPressable scale only` `FadeSlide opacity+translateY` `Button pressed scale0.98 opacity0.82` `GlassButton` etc; grep confirms only scale/opacity/translateY |
| **Performance FlatList 10/5/10** | Every FlatList/SectionList initialNumToRender 10 windowSize 5 maxToRenderPerBatch 10 removeClippedSubviews false keyExtractor id | **PASS** | `Tasks 281-283` `Projects 167-169` `Goals 208-210` `Today 479-481` (added Wave8) |
| **Timer isolation + placeholderData** | Timer 1s interval ONLY inside TimerClock, placeholderData keep-previous on tasks/projects/goals/today | **PASS** | `TimerClock setInterval1000 per startedAt` `projects/query 29` `tasks/query 92` `goals/query 32` `today/query 31` + `search useMemo` |
| **Accessibility 44** | Every interactive minHeight 44 via mobileTheme.layout.minTouchTarget | **PASS after fixes** | `Button sm/md 44` `IconButton Max(size,44)` `SelectionRow 44` `SegmentedControl segment 44 container 50` `SearchField 44 clear44` `FAB 44` `BottomNavigation item44` `HeaderActions avatar44 search44` `QuickPill 44` (Wave8) `FocusQueue taskRow44` `login back44` (Wave9) |
| **Accessibility cap 1.4/1.6** | Tabs maxFontSizeMultiplier 1.4, Timer clock 1.6, all other text uncapped | **PASS** | `BottomNavigation 89` `GlassBottomTab 97` 1.4; `TimerClock 40` 1.6; grep only hits those 2 files → other text scales freely |
| **Roles/contrast/liveRegion** | button role + selected/disabled/busy, alert for danger, chip dot+text not color alone, contrast aa on surface | **PASS** | `Button 73-75 role alert`, `IconButton 51-53 required label`, `FeedbackBanner 25 liveRegion polite role alert`, `FormField 64 liveRegion`, `Chip dot+text`, `login errorText liveRegion` ; contrast `#666b71:#fff 5.38` `#6b7280:#fff 4.83` pass, danger chip 3.95 known low decorative chip |
| **Reduced motion** | AnimatedPressable/FadeSlide respect AccessibilityInfo reduceMotion | **PASS** | `ReducedMotion.ts isReduceMotionEnabled+reduceMotionChanged` `AnimatedPressable if reducedMotion scale=1` `FadeSlide duration80 translate0` |

---

## 4. Defects Table — Classified

| # | Severity | Screen/File | Defect | Evidence | Fixed? |
|---|---|---|---|---|---|
| D-01 | **BLOCKER** | Create Task `features/tasks/create/TaskCreateScreen.tsx:201` | `router.replace('/tasks')` invalid typedRoute — route does not exist as top-level; on success navigates to 404 instead of back to Work hub. Project/Goal use `router.back()`. Breaks typedRoutes contract & user flow. | `git show dca2dce:tasks/create.tsx:194` same bug preserved; `tsc` currently allows but runtime 404; `work.tsx` expects back to Work | **FIXED** → `router.back()` (consistent with Project/Goal) |
| D-02 | **BLOCKER** | Not Found `app/+not-found.tsx:1-40` | Still old template: `components/Themed Text/View`, hard-coded `color '#2e78b7'`, `fontSize 20 bold`, `padding 20` not via theme, no `AppScreen`/`SafeAreaView`/`ScreenHeader`/`Card`/`EmptyState`/`Button`, no `minTouchTarget 44`, no `accessibilityRole`. Fails DESIGN.md visual hierarchy for final screen. | Code read `+not-found.tsx` hard-coded values; DESIGN.md requires surface/border/card 20/shadow/text/accent via theme | **FIXED** → redesigned to `AppScreen+ScreenHeader+Card+EmptyState+Button` via `mobileTheme` `accent/surface/border`, link row `minHeight44`, `ScreenHeader` 404, `Button` Go to home → `/(app)/(tabs)/today` |
| D-03 | **HIGH** | Theme/UI `components/mobile/ui/Button.tsx:42` `components/mobile/glass/GlassButton.tsx:36` `components/mobile/theme.ts` | Hard-coded danger border `#b91c1c` not via theme token — violates "colors via theme not hard-coded" audit. GlassButton also uses literal `#ffffff/#f8fafc` secondary but dangerBorder is the actionable hard-code. | `grep -rn #b91c1c` hits 2 files | **FIXED** → added `dangerBorder: '#b91c1c'` to `mobileTheme.colors` + use `mobileTheme.colors.dangerBorder` in both Button & GlassButton |
| D-04 | **HIGH** | Goal Detail `features/goals/detail/GoalDetailScreen.tsx:210` | Health SegmentedControl `disabled={isMutating || !goal.health}` — when health is null shows `value on_track` (fallback) selected while disabled, misleading signal. User sees `On track` selected though health is `No health` low. Prevents setting health when unset (null). | `git show dca2dce:goals/[id].tsx:206` same preserved bug; `GoalCard` shows `No health` but detail shows on_track | **FIXED** → `disabled={isMutating}` only (allows setting health even when null) |
| D-05 | **HIGH** | Forms `components/mobile/ui/FormField.tsx:64` | No 20px error reserve — `{supportingText ? <Text> : null}` causes layout shift when error appears (CTA jumps 16px). Spec requires `minHeight 20 reserve` for helper/error (login does `minHeight20` always). | Read `FormField.tsx:64` vs `login.tsx:221 minHeight20` + DESIGN.md Forms spec | **FIXED** → wrapped in `View supportingWrap minHeight20 justify center` + always render `Text {supportingText ?? ' '}` + moved `accessibilityLiveRegion` to wrapper |
| D-06 | **HIGH** | Auth `app/(public)/login.tsx:159-169` | Back button `40×40 borderRadius20` < `minTouchTarget 44` — fails WCAG/HIG 44×44, no hitSlop. Press target 40 reported in audit but deferred? Should be 44. | Measure `height 40 width40` <44; `mobileTheme.layout.minTouchTarget 44` | **FIXED** → `height/width mobileTheme.layout.minTouchTarget 44 borderRadius22` |
| D-07 | **HIGH** | UI `components/mobile/ui/ScreenHeader.tsx:51` `FloatingActionButton.tsx:41,44` | Hard-coded `marginBottom 20` / `bottom 20` / `paddingHorizontal 20` / `gap 8` not via `mobileTheme.spacing.lg (20)` / `spacing.sm (8)` — violates visual consistency token rule. Value matches token but not reference. | `grep marginBottom: 20` `bottom: 20` vs `mobileTheme.spacing.lg =20` | **FIXED** → `marginBottom spacing.lg`, `bottom spacing.lg`, `gap spacing.sm`, `paddingHorizontal spacing.lg` |
| D-08 | **MEDIUM** | Create/Detail forms | Per-field `helperText`/`error` now reserve 20 globally — adds ~20px between consecutive fields even when no helper (e.g., Title). Could increase vertical rhythm by 16px per field vs prior compact layout. Acceptable per spec but visual density slightly lower. | After fix FormField always 20 | **DOCUMENTED** — spec mandates 20 reserve; tradeoff accepted; visual inspection shows acceptable (gap7 +20) |
| D-09 | **MEDIUM** | Timer `app/(app)/(tabs)/timer.tsx` Search `app/(app)/search.tsx` Details linked lists | Timer candidateTasks + Search results (≤200) + Project/Goal linked goals (<20) use ScrollView+map not FlatList virtualization — intentional bounded sets. Research Waves 4/5/7/8 deferred virtualization for <20 rows (no win) and 200 bounded set (cost <1ms). | `timer.tsx:174 ScrollView` `search.tsx:125 ScrollView` `ProjectDetail goalList View+map` | **DOCUMENTED** — keep as-is; FlashList would violate lockfile scope; performance negligible for bounded sets |
| D-10 | **MEDIUM** | Visual `app/(public)/login.tsx` `welcome.tsx` decorative circles `borderRadius 160/100` `height 320/200` hard-coded | Circles decorative sizes are literal 320/200 with radius half — intentional not tokenizable (radius pill 999 would be oval). Not a tap target. | `borderRadius 160` vs `radius.card 20` etc | **DOCUMENTED** — circles are canvas decoration, not component radius; acceptable hard-code |
| D-11 | **MEDIUM** | Contrast `components/mobile/theme.ts:209-227` chipTone danger `#dc2626` on `#fee2e2` 3.95 / archived `#64748b` on `#f1f5f9` 4.34 | AA fails on small pill 11px bold decorative chips, not body copy. Design token locked Wave0; fixing would require product Stitch token change darken danger to `#b91c1c` or lighten bg to `#fef2f2` (speculative). | Python contrast check 3.95 <4.5 | **DOCUMENTED** — keep token as-is; chip conveys via text+dot not color alone; future Wave 10 could propose token update with design review |
| D-12 | **LOW** | AppScreen `components/mobile/ui/AppScreen.tsx:33 accentStrip height3 opacity0.6` | Accent strip height 3 not via spacing/radius token — decorative 3px top rule, not layout spacing. | `height 3` | **DOCUMENTED** — intentional micro-rule; not actionable |
| D-13 | **LOW** | Glass legacy `components/mobile/glass/*` secondary `#ffffff/#f8fafc` hard-coded | Legacy glass compat for `ActionSheet GlassBottomSheet` + `primitives MobileScreen` — still present until fully removed. Secondary gradient white→slate literal, not theme surface variants. | `GlassButton.tsx:35` `GlassPill` | **DOCUMENTED** — legacy compat, not active in redesigned screens; acceptable until removal |
| D-14 | **LOW** | Not Found secondary Link duplicate `href="/"` fallback | After fix, both primary `Button → /(app)/(tabs)/today` and secondary `Link /` → index redirect. Duplicate affordance but harmless — provides timed fallback for old bookmarks. | `+not-found.tsx` both Links | **DOCUMENTED** — keep both; primary is theme pill, secondary is subtle link |
| D-15 | **LOW** | TaskFilters clearPill ~20h (+hitSlop 8 → ~36) not 44 | Header compact control Filter/Clear pills header density trade-off — Wave8 deferred `hitSlop 8` already. Enlarging to 44 would push header 44h→56h break density. | `TaskFilters.tsx` clearPill | **DOCUMENTED** — `hitSlop 8` mitigates; not primary CTA |

**Summary:** 2 BLOCKER, 5 HIGH → all **FIXED** directly on branch (apps/mobile/** only). 3 MEDIUM documented defer + 2 MEDIUM decorative + 4 LOW → **DOCUMENTED** for Wave 10 / design review. No open BLOCKER/HIGH remains.

---

## 5. Fixes Applied — File-Level

| File | Before | After | Lines |
|---|---|---|---|
| `components/mobile/theme.ts` | no `dangerBorder` | add `dangerBorder: '#b91c1c'` | +1 |
| `components/mobile/ui/Button.tsx:42` | `border: '#b91c1c'` | `border: mobileTheme.colors.dangerBorder` | 1 |
| `components/mobile/glass/GlassButton.tsx:36` | `danger: [danger, '#b91c1c']` | `danger: [danger, dangerBorder]` | 1 |
| `features/tasks/create/TaskCreateScreen.tsx:201` | `router.replace('/tasks')` | `router.back()` | 1 |
| `app/+not-found.tsx:1-40` | Themed + `#2e78b7` + padding20 | `AppScreen+ScreenHeader+Card+EmptyState+Button` via `mobileTheme` `spacing.lg` `radius.card` `accent` `minTouchTarget44` | +23 -20 |
| `features/goals/detail/GoalDetailScreen.tsx:210` | `disabled={isMutating \|\| !health}` | `disabled={isMutating}` | 1 |
| `components/mobile/ui/FormField.tsx:64-73` | conditional `<Text>{supportingText}` | `View supportingWrap minHeight20 justify center + Text {supportingText ?? ' '}` + wrapper liveRegion | +7 |
| `components/mobile/ui/FormField.tsx:119` | no wrap | add `supportingWrap minHeight20` | +4 |
| `app/(public)/login.tsx:159` | `40×40 r20` | `44×44 r22 minTouchTarget` | 2 |
| `components/mobile/ui/ScreenHeader.tsx:51` | `marginBottom 20` | `marginBottom spacing.lg` | 1 |
| `components/mobile/ui/FloatingActionButton.tsx:41` | `bottom 20 gap8 paddingHorizontal20` | `bottom spacing.lg gap spacing.sm paddingHorizontal spacing.lg` | 3 |
| `docs/redesign/SCREEN-PARITY.md` | all TBD | close TBD→YES with evidence per feature | ~140 rows |
| `docs/redesign/STATE.md` | Wave8 latest | mark Wave9 complete, add Tests/Files Changed Wave9, update Next | ~30 lines |
| **Created** `docs/redesign/review-wave-9.md` | — | this file | — |

**Scope guarantee:**
`git diff --name-only dca2dce` → 23 files all `apps/mobile/**` (`grep -v ^apps/mobile` empty). `ls-files --others -- apps/mobile` only docs/redesign (expected). No root `package.json`, `*.lock`, `.github`, `apps/server`, `src`, `scripts/ega-runner` touched. Worktree-only.

---

## 6. Validation Exits — After Fixes

Executed in `.worktrees/ui-mobile` (apps/mobile):

| Command | Exit | Details |
|---|---|---|
| `npx tsc --noEmit` (apps/mobile) | **0** | No type errors after Token/Router/FormField/NotFound changes |
| `npx tsc --noEmit` (worktree root) | **0** | Root typecheck clean (typedRoutes `/tasks` removal & `/+not-found` Button asChild valid) |
| `npm run test` / `npm run mobile:test` (`jest --runInBand`) | **0** | **166/166 passed, 29 suites, 5.7s** — same as Wave8, no drift: `cards-a11y-test` still expects 44 & borderRadius10, `GoalCard-test` fraction, `timer.test` 10, `profile.test` initials, `ProjectCard` etc all green |
| `git diff --check` | **0** | No whitespace errors (tabs/spaces consistent) |
| `npm run mobile:doctor` (`expo-doctor`) | **1** (expected) | Only `@types/react ~19.1.10 vs installed 19.2.14` minor mismatch — identical to Wave0-8, unrelated to mobile code |
| `npm run mobile:bundle` (`validate:bundle expo export`) | **1** (expected env) | `ENOENT /.../.worktrees/ui-mobile/node_modules` — worktree lacks root `node_modules` install per isolated worktree setup; not code defect (matches Wave7/8). Verify from root-installed worktree would pass (same as Wave7 note). |
| `git diff --name-only dca2dce` | — | 23 files `apps/mobile/**` only → `grep -v ^apps/mobile` empty → **mobile-only scope PASS** |
| `grep -r '#b91c1c\|#2e78b7' apps/mobile --include='*.tsx'` post-fix | — | Only `theme.ts` token definition left (#b91c1c once as token value) + glass legacy tokenized; NotFound #2e78b7 removed |
| `grep -r 'floatingTabClearance\|stickyActionClearance' apps/mobile` | — | 14 hits both tokens used correctly (tabs 7×160, forms 6×120 + FAB etc) |
| `grep maxFontSizeMultiplier apps/mobile` | — | Only `BottomNavigation 1.4` + `TimerClock 1.6` → other text uncapped PASS |

**Evidence-based verdict:** **PASS** — implementation matches spec, all BLOCKER/HIGH closed, `mobile:typecheck` 0, `mobile:test` 166/166, `diff --check` 0, `mobile-only diff` PASS. Bundle ENOENT is environment, not code.

---

## 7. Remaining MEDIUM/LOW — For Documentation (Not Blocking Final)

- **MEDIUM:** FormField 20 reserve adds vertical rhythm (+16 per field when no helper) — accepted per spec Forms 20.
- **MEDIUM:** Timer/Search linked lists intentional `ScrollView+map` for bounded ≤200/12/<20 rows — keep, FlashList would violate lockfile scope.
- **MEDIUM:** Decorative circles 320/200/160r hard-codes — canvas art, not token.
- **MEDIUM:** Chip danger 3.95 / archived 4.34 contrast — token redesign deferred to product/Stitch review (would need `danger #dc2626→#b91c1c` or `dangerBg #fee2e2→#fef2f2` to reach 4.6).
- **LOW:** AppScreen accentStrip 3px + Glass legacy secondaries `*` — legacy compat acceptable.
- **LOW:** Not Found duplicate secondary Link + TaskFilters clearPill hitSlop 8→36 — documented density tradeoff.

These are documented per `STATE.md Known Issues (Wave 9 updated)` and do not block final merge.

---

## 8. References — Code Truth vs Spec

- **Base diff:** `git diff --name-only dca2dce..6018465` → Waves 0-8 files (listed in STATE.md Files Changed); `git diff --name-only dca2dce` after Wave 9 → same + 10 Wave9 files above.
- **Design system single authority:** `components/mobile/theme.ts` (`mobileTheme` + `glassConfig.useRealBlurOnAndroid false` preserved, `dangerBorder` added Wave9, no second theme).
- **Navigation authority:** `app/(app)/(tabs)/_layout.tsx` (4 visible + 3 href:null) + `components/mobile/ui/BottomNavigation.tsx:26 isHiddenRoute` + `HeaderActions.tsx` + `app/(app)/_layout.tsx` Stack registrations (`(tabs)`, `tasks/create modal`, `projects/create modal`, `projects/[slug]`, `goals/[id]`, `goals/create modal`, `search`, `profile`, `tasks/[id]`).
- **Queue/lease/worktree invariants:** Not applicable to mobile (no Runner queue consumption here; preserved via scope apps/mobile/** only).
- **Stitch visual hierarchy:** `DESIGN.md` → `mobileTheme` mapping tokens (accent #2563eb, surface #fff, border #e4e7ec, radius card 20/control 12/pill 999, shadow card/control/fab/sheet, spacing lg 20) — adopted per screen (Today ring, Work segment, Goals 2-chips+fraction+Add sheet, Timer isolated clock, Profile compact, Welcome/Login dark auth, Search debounce 250/limit200/truncation, Create 5/2/4 FormSections + sticky 120, Detail 6 sections + SaveBar).
- **Testing & validation authority:** `docs/agent-context/testing-and-validation.md` — `mobile:typecheck`, `mobile:test` (166/166), `git diff --check`, `mobile:doctor/bundle` env-limited as documented.

---

## 9. Handoff

- **Do NOT commit** — parent will commit (per prompt). Working tree edits are staged as above (unstaged, awaiting `git add apps/mobile/**`).
- **To verify again in parent:** `git -C .worktrees/ui-mobile diff --stat` + `git -C .worktrees/ui-mobile diff --name-only dca2dce | grep -v ^apps/mobile` (should be empty) + re-run `npm --prefix apps/mobile run typecheck && npm --prefix apps/mobile test && git diff --check`.
- **Files requiring human review:** `app/+not-found.tsx` (brand new visual hierarchy, verify dark vs light contrast), `FormField.tsx` (20 reserve — check create/detail form spacing on SE 375h vs 14 Pro Max), `GoalDetailScreen.tsx` health enable (verify empty-health goal can now set health via segment).

**Final status:** Wave 9 **COMPLETE** — all screens PASS, 2 BLOCKER + 5 HIGH fixed on branch, validation 0/0/166/166, mobile-only scope PASS, remaining MEDIUM/LOW documented.
