# Screen Parity — EGA House Mobile Redesign

Every user-facing screen must preserve its code-truth features. `Before` = original file at BASE_SHA `dca2dceaa3baa72352ef9a6db8c80d29029fc82a`, `After` = redesigned file at HEAD `6018465` + Wave 9 fixes, `Preserved` = yes/no, `Evidence` = query hook / test / manual check.

## Legend
- Feature sources are code truth (`app/**/*.tsx`, `features/**/query.ts`, `lib/api/**`) — not Stitch prose.
- Stitch defines visual hierarchy only.

---

### Today (`(tabs)/today.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Load/skeleton | ActivityIndicator + SkeletonCard | AppScreen + ActivityIndicator + SkeletonCard×3 (isPending && !today) | YES | `apps/mobile/app/(app)/(tabs)/today.tsx:418-434` `useTodayWorkspaceQuery` placeholderData, `mobile:test` 166/166 |
| Error/retry | errorText + Retry button | AppScreen FeedbackBanner danger + Button Retry (isError && !today) | YES | `today.tsx:436-457` `todayQuery.isError` `today.test` |
| Header eyebrow/title/meta | Daily momentum header + trackedToday + selectedCount | ScreenHeader eyebrow weekday + title Today + description trackedTodayLabel·selectedCount + HeaderActions search+avatar | YES | `today.tsx:484-491` `weekday` `trackedTodayLabel` `selectedCount` |
| Summary stats (In progress/Completed/Overdue) | three stat blocks | DailyMomentum Card statRow 3× InProgress/Completed/Overdue + todayCount + completedRatio | YES | `features/today/components/DailyMomentum.tsx` `summary.inProgressCount` `mobileTheme.colors` |
| Progress ring/bar | progressFill % width | Card ring via react-native-svg + ProgressBar width completedRatio Math.round(completed/total*100) no fake min | YES | `DailyMomentum.tsx:30` `completedRatio` honest math verified |
| Clear completed | button when clearableCompletedCount>0 | Button danger Clear completed when clearableCompletedCount>0 + isPending | YES | `useClearTodayCompletedMutation` `clearCompletedMutation.isPending` |
| Sections: Planned/InProgress/Blocked/Completed | SectionList 4 sections | SectionList 4 sections planned/inProgress/blocked/completed stickyHeadersEnabled false 10/5/10 | YES | `today.tsx:474-565` `sections` memo `today.sections.*` |
| Section empty states | GlassCard EmptyState | TodaySectionEmpty Card+EmptyState icon list-outline 22 title No tasks per section | YES | `features/today/components/TodaySection.tsx` `TodaySectionEmpty` |
| Task card (status/priority/project/goal/due) | TodayTaskCard | TodayTaskCard Card left accent statusTone + Chip status/priority via chipTone + due pill + blockedReason box | YES | `features/today/components/TodayTaskCard.tsx` `MobileTodayTask` |
| Status actions (Todo→Start/Done etc) | ActionSheet | ActionSheet statusActions per getStatusActions + runStatusAction | YES | `useUpdateTodayTaskStatusMutation` `getStatusActions` |
| Priority/due inline update | ActionSheet priority list | ActionSheet priorityItems + dueItems (Today/Tomorrow/Clear) via runInlineUpdate | YES | `useUpdateTaskMutation` `PRIORITY_ORDER` `todayIso/tomorrowIso` |
| Remove from Today | destructive action | ActionSheet Remove from Today destructive + runRemoveFromToday | YES | `useRemoveTaskFromTodayMutation` |
| Suggestions (Pinned/Recently active + Add) | GlassCard list | Card Suggestions with Pinned / focus + Recently active groups mapped | YES | `today.suggestions` `today.tsx:507-550` |
| Add suggestion → Today | GlassButton Add | Button secondary sm Add / Adding... + runAddSuggestion | YES | `useAddTaskToTodayMutation` `activeSuggestionId` |
| Focus refresh on refetch | useFocusEffect refetch | useFocusEffect refetch().catch | YES | `today.tsx:153-163` |
| Footer clearance | floatingTabClearance | SectionList contentContainer paddingBottom floatingTabClearance 160 | YES | `today.tsx:601` `mobileTheme.layout.floatingTabClearance` |

### Tasks (`(tabs)/tasks.tsx`) — compat hidden, canonical via Work hub
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Filters: status/priority/due/sort + custom view detection | STATUS_FILTER, DUE_FILTER, matchTaskViewPreset | TasksListView state status/priority/due/sort + searchQuery + matchTaskViewPreset + TASK_VIEW_PRESETS | YES | `features/tasks/components/TasksListView.tsx:102-131` `useTaskListQuery` placeholderData |
| Quick view pills (All/Today/Overdue/Urgent/Blocked) | GlassPill row | TaskQuickFilters ScrollView TASK_VIEW_PRESETS pills 44h selected accent + Custom | YES | `components/TaskQuickFilters.tsx` `TASK_VIEW_PRESETS` |
| Summary tiles (Visible/Active/Blocked/Urgent) | 4 GlassCards | 4 Card summaryGrid Visible/Active/Blocked/Urgent via counters.byStatus/byPriority | YES | `TasksListView.tsx:328-349` `counters` |
| Task filters panel (Status/Due) | GlassCard + SegmentedControl | TaskFilters Card header filter-outline + collapsible SegmentedControls + activeCount | YES | `TaskFilters.tsx` `activeCount` 5 dims |
| List virtualization | FlatList keyExtractor=item.id | FlatList keyExtractor item.id initialNumToRender 10 windowSize 5 maxToRenderPerBatch 10 removeClippedSubviews false | YES | `TasksListView.tsx:278-286` |
| Task card (status/priority/due/estimate/project/goal/blockedReason) | TaskCard | TaskCard Card+Chip+calendar Due + estimate pill + blocked box muted 0.72 + mainTap sm 10 | YES | `features/tasks/components/TaskCard.tsx` `chipTone` |
| Inline error per task | itemError text | Text inlineErrorText per taskErrors map | YES | `TasksListView.tsx:239` `mutateTask` |
| Action sheet (status/priority/due/Open) | ActionSheet | ActionSheet status/priority/due/Open details via mutateTask | YES | `useUpdateTaskMutation` `actionSheetItems` |
| Header actions (Search/New) | GlassButton | ScreenHeader+HeaderActions (search→/(app)/search avatar→/(app)/profile) + FloatingActionButton New Task | YES | `app/(app)/(tabs)/tasks.tsx:11-25` `HeaderActions` |
| Empty states (no tasks / no match / create CTA) | EmptyState | Card+EmptyState compact 36 title No tasks vs No match + Clear filters+Create actions | YES | `TasksListView.tsx:355-376` |
| Pull to refresh | RefreshControl | RefreshControl refreshing {!!isRefetching} onRefresh accent tint | YES | `TasksListView.tsx:287` |
| Focus refresh | useFocusEffect | useFocusEffect refetch | YES | `TasksListView.tsx:148-152` |
| Compat deep link | /(app)/(tabs)/tasks | href:null hidden route still renders TasksListView + FAB, BottomNavigation filters href:null | YES | `app/(app)/(tabs)/_layout.tsx:70-75` `BottomNavigation isHiddenRoute` |

### Projects (`(tabs)/projects.tsx`) — compat hidden
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| View filter Active/Archived/All | GlassSegmentedControl | SegmentedControl Active/Archived/All via useProjectListQuery(view) placeholderData | YES | `ProjectsListView.tsx:189` `ProjectViewFilter` |
| Project card (status/progress/task counts) | ProjectCard | ProjectCard Card+Chip+ProgressBar flex1 + fraction completed/taskCount single row | YES | `ProjectCard.tsx` `projectStatusTone` delegates statusTone |
| Action sheet (status→planned/active/done/paused + archive/unarchive) | ActionSheet | ActionSheet statusItems+archive/unarchive disabled when equal/isMutating | YES | `useUpdateProjectStatusMutation` `useArchiveProjectMutation` |
| Empty states | EmptyState | Card+EmptyState per view + Clear search vs Create first project CTA | YES | `ProjectsListView.tsx:207-234` |
| FAB New Project | PrimaryFab | FloatingActionButton New Project → /(app)/projects/create | YES | `projects.tsx:25` `work.tsx` context FAB |
| Pull refresh | RefreshControl | RefreshControl refreshing {!!isRefetching} accent | YES | `ProjectsListView.tsx:173-179` |
| Compat deep link | /(app)/(tabs)/projects | href:null hidden route, BottomNavigation filters | YES | `_layout.tsx:78-83` |

### Goals (`(tabs)/goals.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| View filter Active/Archived/All | SegmentedControl | SegmentedControl Active/Archived/All driving useGoalListQuery(view) placeholderData | YES | `GoalsListView.tsx:222` `GoalViewFilter` |
| Goal card (title/project/status/health/progress/task count/next step) | GoalCard | GoalCard Card left accent healthTone/statusTone + 2 Chips status/health separate + ProgressBar flex1 + fraction + nextStep | YES | `GoalCard.tsx` `healthTone/statusTone` `chipTone` |
| Action sheet (status/health/archive/next-step) | ActionSheet | ActionSheet Status (draft/active/done/paused) + Health (on_track/at_risk/off_track) + Archive/Unarchive + Update next step | YES | `GoalsListView.tsx:99-156` `useUpdateGoal*Mutation` |
| Next step editor modal | Modal + GlassBottomSheet + GlassInput | Modal slide transparent overlay 0.45 sheet 28r handle 44 + TextInput 96 multiline + Cancel ghost + Save primary | YES | `GoalsListView.tsx:279-317` `useUpdateGoalNextStepMutation` |
| Empty states | EmptyState | Card+EmptyState per view Active:Create CTA Archived:archive copy All:nothing | YES | `GoalsListView.tsx:237-267` |
| FAB New Goal | PrimaryFab | FloatingActionButton New Goal → /(app)/goals/create | YES | `goals.tsx:27-31` |
| Health vs status separate | distinct chips | Two Chips kind=status/health health null muted slate No health dot #94a3b8 | YES | `GoalCard.tsx` `healthTone null` `DESIGN.md` |

### Timer (`(tabs)/timer.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Server authority (no local elapsed) | projectElapsedSeconds + server session | TimerClock recomputes projectElapsedSeconds(startedAt, nowMs) each render fallback elapsedLabel | YES | `TimerClock.tsx:35-36` `useTimerWorkspaceQuery` |
| Active session card (Running dot, taskTitle, clock, startedAt) | GlassCard | Card activeContent centered Running dot successMid + Running 12 uppercase + taskTitle 17 bold + TimerClock 52/900 + Started at | YES | `TimerScreenContent.tsx:52-77` |
| 1s tick isolation | useEffect interval + nowMs | TimerClock owns setTimeout0+setInterval1000 per startedAt, parent TimerScreen never holds nowMs | YES | `TimerClock.tsx:22-33` grep setInterval only hits TimerClock |
| Start (pick max 12 open tasks, selected) | Pressable taskRow | FocusQueue mapped 12 Pressable taskRow 44 min selected surfaceMuted+accentMid + checkmark-circle + Button Start timer primary 52h | YES | `FocusQueue.tsx` `candidateTasks slice 0..12` `MAX_PICKER_TASKS` |
| Stop | GlassButton Stop | Button Stop timer danger 54h stop 22 + handleStop mutateAsync sessionId | YES | `useStopTimerMutation` `TimerScreenContent` |
| Tracked Today / Sessions / Longest / All Time | summaryCard | TrackedTimeSummary Card 3× centered Today/Sessions/Longest + footer All time | YES | `TrackedTimeSummary.tsx` `workspace.summary` |
| Offline/stale banner | cloud-offline | staleBanner cloud-offline 14 muted text Can't reach server — showing last synced state when isError && !isFetching | YES | `timer.tsx:138` `showStaleBanner` |
| Retry | GlassButton Retry | Card offline + Button Retry secondary → workspaceQuery.refetch | YES | `timer.tsx:117-133` `timer-offline-card` |

### Profile (`(tabs)/profile.tsx` canonical `(app)/profile.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Avatar initials | 2-char email substring | initials email.substring(0,2).toUpperCase() ?? EG | YES | `app/(app)/profile.tsx:21` `useAuth` |
| Name/email display | EGA House + email | Text EGA House 17 extrabold + email 13 muted | YES | `profile.tsx:38-41` |
| Authenticated pill + Mobile workspace pill | GlassPill | View pill 999 6/10 Authenticated shield-checkmark successBg + Mobile workspace phone-portrait infoBg | YES | `profile.tsx:43-51` |
| Sign out | GlassButton danger | Button danger sm log-out-outline 16 compact Card actionRow not full-width | YES | `signOut().then(router.replace welcome)` `profile-sign-out` |
| Version | Constants.expoConfig.version | Text EGA House · v{Constants.expoConfig.version ?? 1.0.0} 12 subtle centered | YES | `profile.tsx:72` |
| Deep link compat | /(app)/(tabs)/profile | tabs/profile.tsx re-exports canonical ../profile, href:null hidden | YES | `app/(app)/(tabs)/profile.tsx:1` `BottomNavigation` filters |

### Welcome (`(public)/welcome.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Dark auth theme | authBackground + circles | SafeAreaView top,bottom bg authBackground + absolute circles authCircleBlue 320/160r authCirclePurple 200/100r pointerEvents none | YES | `mobileTheme.colors.auth*` `welcome.tsx:10-13` |
| Logo + headline + subtitle | flash icon + tagline | logoMark 68 accent card 20 fab flash 32 white + brand EGA House 16/700 tracking 2 upper 0.7 + tagline Your execution\ncommand center 44/900 -1.5 line50 + subtitle Tasks... maxWidth 280 | YES | `welcome.tsx:16-28` |
| Get started → /login | Link Pressable | Link /(public)/login asChild Pressable pill accent radius pill minHeight 52 fab pressed 0.88 + arrow-forward 18 white 17/900 | YES | `welcome.tsx:32-41` `accessibilityLabel Get started` |

### Login (`(public)/login.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Email/password fields | TextInput | TextInput Email/Password mail/lock 18 authTextSubtle + autoCapitalize none email keyboardType email-address autoComplete email secureTextEntry | YES | `login.tsx:86-131` `useAuth().signIn` |
| Validation (email regex, pw≥6) | client checks | isValidEmail /^[^\s@]+@[^\s@]+\.[^\s@]+$/ byte-identical trimmed + length≥6 + clearError() first | YES | `login.tsx:19-20` preserved verbatim |
| Error reserve (no layout shift) | Text minHeight 20 | Text error||authError||' ' minHeight 20 dangerMid #fca5a5 always rendered no conditional | YES | `login.tsx:133-135` `minHeight 20` |
| Loading state | ActivityIndicator disabled | Button pill accent minHeight 52 fab ActivityIndicator white vs Login text disabled busy | YES | `login.tsx:137-150` `editable !isSubmitting` |
| Back to welcome | chevron-back Pressable | Pressable router.replace('/(public)/welcome') 44 circle overlayLight chevron-back 22 white | YES | `login.tsx:72-78` minTouchTarget 44 |
| On success → /(app)/(tabs)/today | router.replace | router.replace('/(app)/(tabs)/today') exact, catch Login failed. Try again. | YES | `login.tsx:48` `today` not tasks (Wave 0 intent) |
| Keyboard safe | — | KeyboardAvoidingView padding|height + ScrollView flexGrow1 keyboardShouldPersistTaps handled | YES | `login.tsx:59-65` |

### Search (`(app)/search.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Tabs: Tasks/Projects/Goals result groups | MobileScreen groups | ScrollView 3 sections Tasks(checkbox accent) Projects(folder info) Goals(trophy success) each with countPill accentSoft + resultRow | YES | `search.tsx:140-243` `features/search/search.ts` |
| Debounce + limits + truncation warning | debounce 250 limit 200 warning | SEARCH_DEBOUNCE_MS 250 useEffect setTimeout + SEARCH_TASK_LIMIT 200 + FeedbackBanner warning Showing first X of Y tasks | YES | `search.tsx:20-21,79-84` |
| Navigation to detail on tap | push detail | Pressable resultRow 56 bg surface border e4e7ec md 14 map→ router.push tasks/[id] projects/[slug] goals/[id] accessibilityRole button | YES | `search.tsx:150-229` |
| Loading/error/empty states | ActivityIndicator / error / empty | ActivityIndicator accent Loading workspace + Card alert-circle Retry per isError branch + EmptyState Find anything / No matches | YES | `search.tsx:88-123` |
| Immediacy memoization | direct compute | useMemo searchWorkspace [debouncedQuery,tasks,projects,goals] avoid ≤200 re-score on every rerender | YES | `search.tsx:43-46` Wave 8 fix |

### Create Task (`(app)/tasks/create.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| title (required) | TextInput | FormField Title required editable !isSubmitting validation trimmedTitle required | YES | `features/tasks/create/TaskCreateScreen.tsx:253-266` `validate` |
| project select | picker | SelectionRow list per project + EmptyState warning when 0 + auto-select when 1 project | YES | `useTaskFormOptionsQuery` `projectId` |
| goal select | picker | SelectionRow No goal null + goals.map | YES | `goalId` null |
| status | segment | SegmentedControl MOBILE_TASK_STATUS_VALUES via formatTaskToken | YES | `TaskCreateScreen.tsx:327-339` |
| priority | segment | SegmentedControl MOBILE_TASK_PRIORITY_VALUES | YES | `340-355` |
| dueDate + DateTimePicker | picker | QuickPill Today/Tomorrow/Clear 44 + Pressable dateField formatDisplayDate + Card DateTimePicker spinner/default + helper Picker still submits YYYY-MM-DD | YES | `TaskCreateScreen.tsx:357-403` `isDateOnlyValue` |
| estimateMinutes | input | FormField number-pad helper Whole minutes up to 525600 validateEstimateMinutesInput | YES | `validateEstimateMinutesInput` 0-525600 |
| description | multiline | FormField multiline What needs to happen? 88h | YES | `normalizeOptionalText` |
| blockedReason | input + validation | FormField multiline helper Required when Blocked vs Only used when Blocked + validation blocked⇒reason | YES | `status==='blocked' && !normalizedBlockedReason` `Blocked reason is required...` |
| Validation + submit | mut query | CreateTaskInput payload + useCreateTaskMutation + FeedbackBanner danger + sticky bar Cancel+Create Task flex1 loading disabled projects.length===0 + router.back() (fixed from /tasks) | YES | `TaskCreateScreen.tsx:153-206` WAVE 9 fix router.back |

### Create Project (`(app)/projects/create.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| name (required) | TextInput | FormField Name required autoCapitalize words | YES | `ProjectCreateScreen.tsx:63-76` |
| description | multiline | FormField Description helper What outcome does this project serve? | YES | `90-105` |
| Derived slug (read-only) | text | View surfaceMuted border control preview /${slug} or Slug is derived... + Read-only · updates live 11 subtle memo normalizeMobileProjectSlug | YES | `slug = useMemo normalizeMobileProjectSlug(name)` `canSubmit` |

### Create Goal (`(app)/goals/create.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| title | TextInput | FormField Title required | YES | `GoalCreateScreen.tsx:116-129` |
| project selection (auto-select if single) | picker | SelectionRow list or EmptyState folder-open Create a project first + Single project auto-selected helper + derived selectedProjectId | YES | `selectedProjectId = projects.some?pid: length===1?first:''` |
| status | segment | SegmentedControl STATUS_OPTIONS draft/active/done/paused | YES | `215-225` |
| health | segment | SegmentedControl HEALTH_OPTIONS on_track/at_risk/off_track | YES | `204-212` |
| nextStep | input | FormField helper Optional immediate next action | YES | `171-183` |
| description/progress | — | FormField Description multiline What does success look like? + sticky 120 + keyboard-safe | YES | `185-199` `useCreateGoalMutation` slug:null |

### Task Detail (`(app)/tasks/[id].tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Loading/error/missing-id | spinner + error | Task id missing FeedbackBanner danger + Back; isError FeedbackBanner+Retry+Back; isPending SkeletonCard+SkeletonLine | YES | `TaskDetailScreen.tsx:260-301` `useTaskByIdQuery` |
| Title/project/goal metadata | header | TaskIdentityCard Card title 22/900 + meta project·goal + Updated formatTimestamp | YES | `TaskIdentityCard.tsx` |
| updatedAt timestamp | text | Text Updated {formatTimestamp} 12 muted | YES | `formatters.formatTimestamp` |
| status / priority / due / estimate / recurrence / timezone | chips + inputs | TaskStateSection FormSection flag/trending-up SegmentedControls + TaskScheduleSection QuickPills Today/Tomorrow/+7/Clear + dateField surfaceMuted + DateTimePicker inline + estimate FormField + recurrence pills + timezone Intl helper | YES | `TaskStateSection` `TaskScheduleSection` `formatDueDate` `formatRecurrenceRule` `isoDateAtOffset` |
| description | multiline | TaskDetailsSection FormField document multiline | YES | `TaskDetailsSection` |
| blockedReason + validation | input | TaskDetailsSection FormField ban multiline helper Required when Blocked vs Only used + dirty ignored note + validation Blocked reason is required... | YES | `onSave` blocked guard |
| reminder date+time pickers | DateTimePicker | TaskReminderSection dateField formatReminderDraft + Date/Time/Clear Buttons + Card DateTimePicker minimumDate | YES | `TaskReminderSection.tsx` `ReminderPickerMode` |
| create email reminder | mutation | Schedule email reminder primary + onCreateReminder null/future guard toISOString future check | YES | `createReminderMutation` `remindAt ISO` |
| pending reminder list + cancel | list | pending asc mapped + Cancel sm per row + cancellingReminderId loading | YES | `pendingReminders` `onCancelReminder` |
| reminder history + errors/success | list | history 3 + Chip status + FeedbackBanner danger/success | YES | `completedReminders` `reminderError/Success` |
| update errors/success + dirty detection + save bar | save logic | TaskSaveBar sticky Back+Save changes/Saved disabled isSaving + isDraftDirty 7 fields + FeedbackBanner danger/success | YES | `isDraftDirty` `TaskSaveBar` `stickyActionClearance 120` |
| Platform DateTimePicker differences | conditional | Android dismissed type guard + date vs time branch setFullYear vs setHours | YES | `onReminderDateChange` `onDueDateChange` |

### Project Detail (`(app)/projects/[slug].tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Project header (status/progress) | GlassCard header | ScreenHeader slug title + Card Chip status + count linked goals + Actions ghost Manage status + archivedBanner neutral | YES | `ProjectDetailScreen.tsx:161-184` `useProjectBySlugQuery` placeholderData |
| Linked goals | FlatList goals | View goalList mapped goalRow accent 3 + title or EmptyState Card No goals linked | YES | `ProjectDetailScreen` `goals` flatMap |
| Actions (status/archive) | ActionSheet etc | ActionSheet status→planned/active/done/paused disabled when equal/isMutating + archive/unarchive destructive + Card Archive/Unarchive danger/secondary + Back ghost | YES | `sheetItems` `isMutating` `projectQueryKeys` |

### Goal Detail (`(app)/goals/[id].tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Goal header (status/health) | GlassCard header | Card title 22/900 projectName upper description/no description + Chip status/health + meta accent dot | YES | `GoalDetailScreen.tsx:172-189` |
| Project link | projectName | projectName upper 11/600 | YES | `projectName` |
| Next step | TextInput + Save | FormSection Next step FormField multiline + Button Save next step disabled isMutating loading | YES | `useUpdateGoalNextStepMutation` `saveNextStep` diff-only |
| Progress + linked tasks | ProgressBar | ProgressBar healthTone + percent + helper completed/total tasks + linked tasks map Chip status | YES | `GoalDetailScreen:247-268` `progress clamped 0-100` |
| Archive/actions | archive Btn | Card Archive goal secondary vs Unarchive + Back ghost + FeedbackBanner danger actionError | YES | `isMutating` `archiveMutation` |
| Loading/error states | Skeleton/Retry | SkeletonCard×3 + Card notFound + Goal id missing + Goal not found  + Retry + Back | YES | `GoalDetailScreen:83-146` |

### Not Found (`+not-found.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| 404 message + back link | Text This screen does not exist + Link / Go to home | AppScreen + ScreenHeader 404/Not found + Card EmptyState icon alert-circle title This screen does not exist description Check URL + Button Go to home → /(app)/(tabs)/today + secondary Link / + theme colors accent surface border | YES | `app/+not-found.tsx` Wave 9 redesign mobileTheme spacing.lg floating safe area minTouchTarget 44 `Button` |

---

## Wave tracking
- Wave 0: establish primitives + navigation (no screen parity change except nav) — DONE
- Wave 1: Today (Daily Momentum ring + 4 sections + Suggestions) — DONE
- Wave 2: Work / Tasks / Projects (segmented Tasks|Projects + FlatList 10/5/10 + placeholderData) — DONE
- Wave 3: Goals (health vs status Chips + ProgressBar+fraction + +Add next step) — DONE
- Wave 4: Timer + Profile (isolated TimerClock + FocusQueue 12 + TrackedTimeSummary + compact Profile) — DONE
- Wave 5: Welcome + Login + Search (dark auth polish + SearchField 250/limit200/truncation warning) — DONE
- Wave 6: Create flows (Task/Project/Goal) with FormSection + sticky 120 + keyboard-safe — DONE
- Wave 7: Detail/Edit flows (Task/Project/Goal) with recurrence/reminder & linked tasks — DONE
- Wave 8: Performance + accessibility hardening (renderItem memo, search memo, SectionList 10/5/10, FeedbackBanner liveRegion, QuickPill 44) — DONE
- Wave 9: Final independent review — DONE (all TBD → YES, BLOCKER/HIGH fixed, validation 0/0/166/166)
