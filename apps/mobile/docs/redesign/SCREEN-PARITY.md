# Screen Parity — EGA House Mobile Redesign

Every user-facing screen must preserve its code-truth features. `Before` = original file at BASE_SHA, `After` = redesigned file, `Preserved` = yes/no, `Evidence` = query hook / test / manual check.

## Legend
- Feature sources are code truth (`app/**/*.tsx`, `features/**/query.ts`, `lib/api/**`) — not Stitch prose.
- Stitch defines visual hierarchy only.

---

### Today (`(tabs)/today.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Load/skeleton | ActivityIndicator + SkeletonCard | TBD | TBD | `useTodayWorkspaceQuery` |
| Error/retry | errorText + Retry button | TBD | TBD | query error state |
| Header eyebrow/title/meta | Daily momentum header + trackedToday + selectedCount | TBD | TBD | `today.summary` |
| Summary stats (In progress/Completed/Overdue) | three stat blocks | TBD | TBD | `summary.inProgressCount` etc |
| Progress ring/bar | progressFill % width | TBD | TBD | `completedCount/total` |
| Clear completed | button when clearableCompletedCount>0 | TBD | TBD | `useClearTodayCompletedMutation` |
| Sections: Planned/InProgress/Blocked/Completed | SectionList 4 sections | TBD | TBD | `today.sections.*` |
| Section empty states | GlassCard EmptyState | TBD | TBD | |
| Task card (status/priority/project/goal/due) | TodayTaskCard | TBD | TBD | `MobileTodayTask` |
| Status actions (Todo→Start/Done etc) | ActionSheet | TBD | TBD | `useUpdateTodayTaskStatusMutation` |
| Priority/due inline update | ActionSheet priority list | TBD | TBD | `useUpdateTaskMutation` |
| Remove from Today | destructive action | TBD | TBD | `useRemoveTaskFromTodayMutation` |
| Suggestions (Pinned/Recently active + Add) | GlassCard list | TBD | TBD | `today.suggestions` |
| Add suggestion → Today | GlassButton Add | TBD | TBD | `useAddTaskToTodayMutation` |
| Focus refresh on refetch | useFocusEffect refetch | TBD | TBD | |
| Footer clearance | floatingTabClearance | TBD | TBD | |

### Tasks (`(tabs)/tasks.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Filters: status/priority/due/sort + custom view detection | STATUS_FILTER, DUE_FILTER, matchTaskViewPreset | TBD | TBD | `useTaskListQuery` |
| Quick view pills (All/Today/Overdue/Urgent/Blocked) | GlassPill row | TBD | TBD | `TASK_VIEW_PRESETS` |
| Summary tiles (Visible/Active/Blocked/Urgent) | 4 GlassCards | TBD | TBD | `counters.byStatus/byPriority` |
| Task filters panel (Status/Due) | GlassCard + SegmentedControl | TBD | TBD | |
| List virtualization | FlatList keyExtractor=item.id | TBD | TBD | |
| Task card (status/priority/due/estimate/project/goal/blockedReason) | TaskCard | TBD | TBD | |
| Inline error per task | itemError text | TBD | TBD | `mutateTask` |
| Action sheet (status/priority/due/Open) | ActionSheet | TBD | TBD | `useUpdateTaskMutation` |
| Header actions (Search/New) | GlassButton | TBD | TBD | |
| Empty states (no tasks / no match / create CTA) | EmptyState | TBD | TBD | |
| Pull to refresh | RefreshControl | TBD | TBD | |
| Focus refresh | useFocusEffect | TBD | TBD | |

### Projects (`(tabs)/projects.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| View filter Active/Archived/All | GlassSegmentedControl | TBD | TBD | `useProjectListQuery` |
| Project card (status/progress/task counts) | ProjectCard | TBD | TBD | |
| Action sheet (status→planned/active/done/paused + archive/unarchive) | ActionSheet | TBD | TBD | `useUpdateProjectStatusMutation` etc |
| Empty states | EmptyState | TBD | TBD | |
| FAB New Project | PrimaryFab | TBD | TBD | |
| Pull refresh | RefreshControl | TBD | TBD | |

### Goals (`(tabs)/goals.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| View filter Active/Archived/All | SegmentedControl | TBD | TBD | `useGoalListQuery` |
| Goal card (title/project/status/health/progress/task count/next step) | GoalCard | TBD | TBD | |
| Action sheet (status/health/archive/next-step) | ActionSheet | TBD | TBD | |
| Next step editor modal | Modal + GlassBottomSheet + GlassInput | TBD | TBD | `useUpdateGoalNextStepMutation` |
| Empty states | EmptyState | TBD | TBD | |
| FAB New Goal | PrimaryFab | TBD | TBD | |
| Health vs status separate | distinct chips | TBD | TBD | |

### Timer (`(tabs)/timer.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Server authority (no local elapsed) | projectElapsedSeconds + server session | TBD | TBD | `useTimerWorkspaceQuery` |
| Active session card (Running dot, taskTitle, clock, startedAt) | GlassCard | TBD | TBD | |
| 1s tick isolation | useEffect interval + nowMs | TBD | TBD | |
| Start (pick max 12 open tasks, selected) | Pressable taskRow | TBD | TBD | `useStartTimerMutation` |
| Stop | GlassButton Stop | TBD | TBD | `useStopTimerMutation` |
| Tracked Today / Sessions / Longest / All Time | summaryCard | TBD | TBD | `workspace.summary` |
| Offline/stale banner | cloud-offline | TBD | TBD | `isError && !isFetching` |
| Retry | GlassButton Retry | TBD | TBD | |

### Profile (`(tabs)/profile.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Avatar initials | 2-char email substring | TBD | TBD | `useAuth().user.email` |
| Name/email display | EGA House + email | TBD | TBD | |
| Authenticated pill + Mobile workspace pill | GlassPill | TBD | TBD | |
| Sign out | GlassButton danger | TBD | TBD | `signOut()` |
| Version | Constants.expoConfig.version | TBD | TBD | |

### Welcome (`(public)/welcome.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Dark auth theme | authBackground + circles | TBD | TBD | `mobileTheme.colors.auth*` |
| Logo + headline + subtitle | flash icon + tagline | TBD | TBD | |
| Get started → /login | Link Pressable | TBD | TBD | |

### Login (`(public)/login.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Email/password fields | TextInput | TBD | TBD | `useAuth().signIn` |
| Validation (email regex, pw≥6) | client checks | TBD | TBD | |
| Error reserve (no layout shift) | Text minHeight 20 | TBD | TBD | |
| Loading state | ActivityIndicator disabled | TBD | TBD | |
| Back to welcome | chevron-back Pressable | TBD | TBD | |
| On success → /(app)/(tabs)/tasks | router.replace | TBD | TBD | |

### Search (`(app)/search.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Tabs: Tasks/Projects/Goals result groups | TBD | TBD | TBD | `features/search/search.ts` |
| Debounce + limits + truncation warning | TBD | TBD | TBD | |
| Navigation to detail on tap | TBD | TBD | TBD | |

### Create Task (`(app)/tasks/create.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| title (required) | TextInput | TBD | TBD | `features/tasks/form-utils` |
| project select | picker | TBD | TBD | |
| goal select | picker | TBD | TBD | |
| status | segment | TBD | TBD | |
| priority | segment | TBD | TBD | |
| dueDate + DateTimePicker | picker | TBD | TBD | |
| estimateMinutes | input | TBD | TBD | |
| description | multiline | TBD | TBD | |
| blockedReason | input + validation | TBD | TBD | |
| Validation + submit | mut query | TBD | TBD | |

### Create Project (`(app)/projects/create.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| name (required) | TextInput | TBD | TBD | `features/projects/form-utils` |
| description | multiline | TBD | TBD | |
| Derived slug (read-only) | text | TBD | TBD | |

### Create Goal (`(app)/goals/create.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| title | TextInput | TBD | TBD | |
| project selection (auto-select if single) | picker | TBD | TBD | |
| status | segment | TBD | TBD | |
| health | segment | TBD | TBD | |
| nextStep | input | TBD | TBD | |
| description/progress | TBD | TBD | TBD | |

### Task Detail (`(app)/tasks/[id].tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Loading/error/missing-id | spinner + error | TBD | TBD | `useTasks?` |
| Title/project/goal metadata | header | TBD | TBD | |
| updatedAt timestamp | text | TBD | TBD | |
| status / priority / due / estimate / recurrence / timezone | chips + inputs | TBD | TBD | |
| description | multiline | TBD | TBD | |
| blockedReason + validation | input | TBD | TBD | |
| reminder date+time pickers | DateTimePicker | TBD | TBD | |
| create email reminder | mutation | TBD | TBD | |
| pending reminder list + cancel | list | TBD | TBD | |
| reminder history + errors/success | list | TBD | TBD | |
| update errors/success + dirty detection + save bar | save logic | TBD | TBD | |
| Platform DateTimePicker differences | conditional | TBD | TBD | |

### Project Detail (`(app)/projects/[slug].tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Project header (status/progress) | TBD | TBD | TBD | |
| Linked goals | TBD | TBD | TBD | |
| Actions (status/archive) | TBD | TBD | TBD | |

### Goal Detail (`(app)/goals/[id].tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| Goal header (status/health) | TBD | TBD | TBD | |
| Project link | TBD | TBD | TBD | |
| Next step | TBD | TBD | TBD | |
| Progress + linked tasks | TBD | TBD | TBD | |
| Archive/actions | TBD | TBD | TBD | |

### Not Found (`+not-found.tsx`)
| Feature | Before | After | Preserved | Evidence |
|---|---|---|---|---|
| 404 message + back link | TBD | TBD | TBD | |

---

## Wave tracking
- Wave 0: establish primitives + navigation (no screen parity change except nav)
- Waves 1-7: each screen moved to Preserved=YES with evidence updated
- Wave 9: final audit closes all TBD to YES
