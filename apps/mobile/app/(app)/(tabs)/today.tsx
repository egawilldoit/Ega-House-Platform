import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import {
  EmptyState,
  MobileScreen,
  MobileScreenHeader,
  MobileSectionHeader,
  SkeletonCard,
  SurfaceCard,
} from '@/components/mobile/primitives';
import { TodayTaskCard } from '@/components/mobile/TodayTaskCard';
import { mobileTheme } from '@/components/mobile/theme';
import {
  addMobileTaskToToday,
  clearMobileTodayCompletedTasks,
  fetchMobileToday,
  removeMobileTaskFromToday,
  updateMobileTodayTaskStatus,
} from '@/lib/api/today';
import { updateMobileTask } from '@/lib/api/tasks';
import type { MobileTodayResponse, MobileTodayTask } from '@/types/today';
import type { MobileTaskPriority, MobileTaskStatus } from '@/types/tasks';

type TodaySection = {
  key: 'planned' | 'inProgress' | 'blocked' | 'completed';
  title: string;
  emptyText: string;
  data: MobileTodayTask[];
};

const PRIORITY_ORDER: MobileTaskPriority[] = ['low', 'medium', 'high', 'urgent'];

function getLocalIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addLocalDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDueDate(value: string | null) {
  if (!value) {
    return 'No due date';
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}

function getStatusActions(task: MobileTodayTask): Array<{ label: string; status: MobileTaskStatus }> {
  switch (task.status) {
    case 'todo':
      return [
        { label: 'Start', status: 'in_progress' },
        { label: 'Done', status: 'done' },
      ];
    case 'in_progress':
      return [
        { label: 'Done', status: 'done' },
        { label: 'To do', status: 'todo' },
      ];
    case 'done':
      return [{ label: 'Reopen', status: 'todo' }];
    case 'blocked':
      return [
        { label: 'To do', status: 'todo' },
        { label: 'Start', status: 'in_progress' },
      ];
  }
}

function getTodayTaskCount(today: MobileTodayResponse | null) {
  if (!today) {
    return 0;
  }

  return (
    today.summary.plannedCount +
    today.summary.inProgressCount +
    today.summary.blockedCount +
    today.summary.completedCount
  );
}

export default function TodayScreen() {
  const router = useRouter();
  const [today, setToday] = useState<MobileTodayResponse | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isClearingCompleted, setIsClearingCompleted] = useState(false);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);

  const activeTask = useMemo(
    () =>
      today
        ? [
            ...today.sections.planned,
            ...today.sections.inProgress,
            ...today.sections.blocked,
            ...today.sections.completed,
          ].find((task) => task.id === activeTaskId) ?? null
        : null,
    [activeTaskId, today],
  );

  const todayIso = useMemo(() => getLocalIsoDate(new Date()), []);
  const tomorrowIso = useMemo(() => getLocalIsoDate(addLocalDays(new Date(), 1)), []);

  const loadToday = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    if (mode === 'initial') {
      setIsLoading(true);
    } else if (mode === 'refresh') {
      setIsRefreshing(true);
    }

    try {
      const response = await fetchMobileToday();
      setToday(response);
      setHasLoadedOnce(true);
      setError(null);
    } catch (loadError) {
      const message = formatMessage(loadError, 'Unable to load Today right now.');
      if (mode === 'silent') {
        throw new Error(message);
      }
      setError(message);
    } finally {
      if (mode === 'initial') {
        setIsLoading(false);
      } else if (mode === 'refresh') {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadToday('initial').catch(() => {
      // handled in loadToday state
    });
  }, [loadToday]);

  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce) {
        return;
      }

      loadToday('silent').catch(() => {
        // Keep existing data visible if focus refresh fails.
      });
    }, [hasLoadedOnce, loadToday]),
  );

  const sections = useMemo<TodaySection[]>(() => {
    if (!today) {
      return [];
    }

    return [
      {
        key: 'planned',
        title: 'Planned',
        emptyText: 'No planned tasks in Today.',
        data: today.sections.planned,
      },
      {
        key: 'inProgress',
        title: 'In Progress',
        emptyText: 'No in-progress tasks in Today.',
        data: today.sections.inProgress,
      },
      {
        key: 'blocked',
        title: 'Blocked',
        emptyText: 'No blocked tasks in Today.',
        data: today.sections.blocked,
      },
      {
        key: 'completed',
        title: 'Completed',
        emptyText: 'No completed tasks in Today.',
        data: today.sections.completed,
      },
    ];
  }, [today]);

  const runStatusAction = useCallback(
    async (task: MobileTodayTask, status: MobileTaskStatus) => {
      setActionError(null);
      setActiveTaskId(task.id);

      try {
        await updateMobileTodayTaskStatus(task.id, status);
        await loadToday('silent');
      } catch (mutationError) {
        setActionError(formatMessage(mutationError, 'Unable to update task status.'));
      } finally {
        setActiveTaskId(null);
      }
    },
    [loadToday],
  );

  const runInlineUpdate = useCallback(
    async (
      task: MobileTodayTask,
      input: {
        priority?: MobileTaskPriority;
        dueDate?: string | null;
      },
    ) => {
      setActionError(null);
      setActiveTaskId(task.id);

      try {
        await updateMobileTask(task.id, input);
        await loadToday('silent');
      } catch (mutationError) {
        setActionError(formatMessage(mutationError, 'Unable to update task.'));
      } finally {
        setActiveTaskId(null);
      }
    },
    [loadToday],
  );

  const runRemoveFromToday = useCallback(
    async (task: MobileTodayTask) => {
      setActionError(null);
      setActiveTaskId(task.id);

      try {
        await removeMobileTaskFromToday(task.id);
        await loadToday('silent');
      } catch (mutationError) {
        setActionError(formatMessage(mutationError, 'Unable to remove task from Today.'));
      } finally {
        setActiveTaskId(null);
      }
    },
    [loadToday],
  );

  const runAddSuggestion = useCallback(
    async (task: MobileTodayTask) => {
      setActionError(null);
      setActiveSuggestionId(task.id);

      try {
        await addMobileTaskToToday(task.id);
        await loadToday('silent');
      } catch (mutationError) {
        setActionError(formatMessage(mutationError, 'Unable to add task to Today.'));
      } finally {
        setActiveSuggestionId(null);
      }
    },
    [loadToday],
  );

  const runClearCompleted = useCallback(async () => {
    setActionError(null);
    setIsClearingCompleted(true);

    try {
      await clearMobileTodayCompletedTasks();
      await loadToday('silent');
    } catch (clearError) {
      setActionError(formatMessage(clearError, 'Unable to clear completed tasks from Today.'));
    } finally {
      setIsClearingCompleted(false);
    }
  }, [loadToday]);

  const actionSheetItems = useMemo<ActionSheetItem[]>(() => {
    if (!activeTask) {
      return [];
    }

    const statusItems = getStatusActions(activeTask).map((action) => ({
      key: `status-${action.status}`,
      label: action.label,
      onPress: () => {
        runStatusAction(activeTask, action.status).catch(() => {
          // handled in runStatusAction state
        });
      },
    }));

    const priorityItems = PRIORITY_ORDER.map((priority) => ({
      key: `priority-${priority}`,
      label: `Priority: ${priority}${priority === activeTask.priority ? ' (Current)' : ''}`,
      disabled: priority === activeTask.priority,
      onPress: () => {
        runInlineUpdate(activeTask, { priority }).catch(() => {
          // handled in runInlineUpdate state
        });
      },
    }));

    const dueItems: ActionSheetItem[] = [
      {
        key: 'due-today',
        label: 'Set due today',
        disabled: activeTask.dueDate === todayIso,
        onPress: () => {
          runInlineUpdate(activeTask, { dueDate: todayIso }).catch(() => {
            // handled in runInlineUpdate state
          });
        },
      },
      {
        key: 'due-tomorrow',
        label: 'Set due tomorrow',
        disabled: activeTask.dueDate === tomorrowIso,
        onPress: () => {
          runInlineUpdate(activeTask, { dueDate: tomorrowIso }).catch(() => {
            // handled in runInlineUpdate state
          });
        },
      },
      {
        key: 'due-clear',
        label: 'Clear due date',
        disabled: activeTask.dueDate === null,
        onPress: () => {
          runInlineUpdate(activeTask, { dueDate: null }).catch(() => {
            // handled in runInlineUpdate state
          });
        },
      },
    ];

    return [
      ...statusItems,
      ...priorityItems,
      ...dueItems,
      ...(activeTask.isPlannedForToday
        ? [
            {
              key: 'remove-today',
              label: 'Remove from Today',
              destructive: true,
              onPress: () => {
                runRemoveFromToday(activeTask).catch(() => {
                  // handled in runRemoveFromToday state
                });
              },
            } satisfies ActionSheetItem,
          ]
        : []),
      {
        key: 'open',
        label: 'Open task details',
        onPress: () => {
          router.push({
            pathname: '/(app)/tasks/[id]',
            params: { id: activeTask.id },
          });
        },
      },
    ];
  }, [
    activeTask,
    router,
    runInlineUpdate,
    runRemoveFromToday,
    runStatusAction,
    todayIso,
    tomorrowIso,
  ]);

  if (isLoading) {
    return (
      <MobileScreen>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.subtitle}>Loading Today...</Text>
        </View>
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </MobileScreen>
    );
  }

  if (error && !today) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Today</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => {
              loadToday('initial').catch(() => {
                // handled in loadToday state
              });
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      </MobileScreen>
    );
  }

  if (!today) {
    return null;
  }

  const todayCount = getTodayTaskCount(today);
  const completedRatio =
    todayCount > 0 ? Math.round((today.summary.completedCount / todayCount) * 100) : 0;

  return (
    <MobileScreen padded={false}>
      <SectionList
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => item.id}
        sections={sections}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              loadToday('refresh').catch(() => {
                // handled in loadToday state
              });
            }}
          />
        }
        ListHeaderComponent={
          today ? (
            <View style={styles.pagePadding}>
              <MobileScreenHeader
                eyebrow={new Date(`${today.date}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long',
                })}
                title="Today"
                description={`${today.summary.trackedTodayLabel} tracked tasks in focus`}
              />

              <SurfaceCard style={styles.summaryCard}>
                <View style={styles.summaryAccentBubble} />
                <Text style={styles.summaryTitle}>Daily momentum</Text>
                <Text style={styles.summaryMeta}>{new Date(`${today.date}T00:00:00`).toDateString()}</Text>
                <View style={styles.summaryStatsRow}>
                  <View style={styles.statBlock}>
                    <Text style={styles.statValue}>{today.summary.inProgressCount}</Text>
                    <Text style={styles.statLabel}>In progress</Text>
                  </View>
                  <View style={styles.statBlock}>
                    <Text style={styles.statValue}>{today.summary.completedCount}</Text>
                    <Text style={styles.statLabel}>Completed</Text>
                  </View>
                  <View style={styles.statBlock}>
                    <Text style={styles.statValue}>{completedRatio}%</Text>
                    <Text style={styles.statLabel}>Completion</Text>
                  </View>
                </View>

                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${completedRatio}%` }]}>
                    <View style={styles.progressFillStart} />
                    <View style={styles.progressFillEnd} />
                  </View>
                </View>

                {todayCount === 0 ? (
                  <Text style={styles.emptyText}>Nothing in Today yet. Add tasks from suggestions below.</Text>
                ) : null}

                {today.summary.clearableCompletedCount > 0 ? (
                  <Pressable
                    disabled={isClearingCompleted}
                    onPress={() => {
                      runClearCompleted().catch(() => {
                        // handled in runClearCompleted state
                      });
                    }}
                    style={styles.clearButton}
                  >
                    <Ionicons name="trash-outline" size={16} color={mobileTheme.colors.danger} />
                    <Text style={styles.clearButtonText}>
                      {isClearingCompleted ? 'Clearing...' : 'Clear completed'}
                    </Text>
                  </Pressable>
                ) : null}

                {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
              </SurfaceCard>
            </View>
          ) : null
        }
        ListFooterComponent={
          today ? (
            <View style={styles.pagePadding}>
              <SurfaceCard>
                <Text style={styles.suggestionsTitle}>Suggestions</Text>
                {today.suggestions.pinned.length === 0 && today.suggestions.inProgress.length === 0 ? (
                  <Text style={styles.sectionEmpty}>No suggestions right now.</Text>
                ) : null}
                {[
                  { key: 'Pinned / focus', items: today.suggestions.pinned },
                  { key: 'Recently active', items: today.suggestions.inProgress },
                ].map((group) =>
                  group.items.length > 0 ? (
                    <View key={group.key} style={styles.suggestionGroup}>
                      <Text style={styles.suggestionGroupTitle}>{group.key}</Text>
                      {group.items.map((task) => {
                        const isMutating = activeSuggestionId === task.id;

                        return (
                          <View key={task.id} style={styles.suggestionRow}>
                            <View style={styles.suggestionCopy}>
                              <Text style={styles.suggestionTaskTitle}>{task.title}</Text>
                              <Text style={styles.suggestionTaskMeta}>
                                {task.projectName}
                                {task.goalTitle ? ` · ${task.goalTitle}` : ''}
                              </Text>
                            </View>
                            <Pressable
                              disabled={isMutating}
                              onPress={() => {
                                runAddSuggestion(task).catch(() => {
                                  // handled in runAddSuggestion state
                                });
                              }}
                              style={styles.addButton}
                            >
                              <Text style={styles.addButtonText}>{isMutating ? 'Adding...' : 'Add'}</Text>
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                  ) : null,
                )}
              </SurfaceCard>
            </View>
          ) : null
        }
        renderSectionFooter={({ section }) =>
          section.data.length === 0 ? (
            <View style={styles.pagePadding}>
              <EmptyState
                icon="list-outline"
                title="No tasks"
                description={section.emptyText}
              />
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.pagePadding}>
            <MobileSectionHeader count={section.data.length} title={section.title} />
          </View>
        )}
        renderItem={({ item }) => {
          const isMutating = activeTaskId === item.id;
          const statusActions = getStatusActions(item);
          const primaryAction = statusActions[0];

          return (
            <View style={styles.pagePadding}>
              <View style={styles.cardWrap}>
                <TodayTaskCard
                  blockedReason={item.status === 'blocked' ? item.blockedReason : null}
                  busy={isMutating}
                  dueLabel={formatDueDate(item.dueDate)}
                  goal={item.goalTitle}
                  muted={item.status === 'done'}
                  onActions={() => setActiveTaskId(item.id)}
                  onOpen={() => {
                    router.push({
                      pathname: '/(app)/tasks/[id]',
                      params: { id: item.id },
                    });
                  }}
                  onPrimaryAction={() => {
                    runStatusAction(item, primaryAction.status).catch(() => {
                      // handled in runStatusAction state
                    });
                  }}
                  primaryActionLabel={primaryAction.label}
                  priority={item.priority}
                  project={item.projectName}
                  status={item.status}
                  title={item.title}
                />
              </View>
            </View>
          );
        }}
      />

      <ActionSheet
        footer={activeTaskId ? <Text style={styles.sheetFooter}>Running update...</Text> : null}
        items={actionSheetItems}
        onClose={() => setActiveTaskId(null)}
        subtitle={
          activeTask
            ? `${activeTask.projectName}${activeTask.goalTitle ? ` · ${activeTask.goalTitle}` : ''}`
            : undefined
        }
        title={activeTask?.title ?? 'Task actions'}
        visible={Boolean(activeTask)}
      />
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 14,
  },
  addButtonText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 12,
    fontWeight: mobileTheme.font.extrabold,
  },
  button: {
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    marginTop: mobileTheme.spacing.lg,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonText: {
    color: mobileTheme.colors.textOnAccent,
    fontWeight: mobileTheme.font.extrabold,
  },
  cardWrap: {
    marginBottom: mobileTheme.spacing.sm,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  clearButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.dangerBg,
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 8,
    marginTop: mobileTheme.spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  clearButtonText: {
    color: mobileTheme.colors.danger,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
  },
  emptyText: {
    color: mobileTheme.colors.textMuted,
    marginTop: mobileTheme.spacing.sm,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    marginTop: mobileTheme.spacing.sm,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: mobileTheme.spacing.xxl,
    paddingTop: mobileTheme.spacing.sm,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingTop: mobileTheme.spacing.xxl,
  },
  pagePadding: {
    paddingHorizontal: 16,
  },
  progressFill: {
    borderRadius: 3,
    flexDirection: 'row',
    height: 6,
    overflow: 'hidden',
  },
  progressFillEnd: {
    backgroundColor: mobileTheme.colors.successMid,
    flex: 1,
  },
  progressFillStart: {
    backgroundColor: mobileTheme.colors.accentMid,
    flex: 1,
  },
  progressTrack: {
    backgroundColor: mobileTheme.colors.backgroundDeep,
    borderRadius: 3,
    height: 6,
    marginTop: mobileTheme.spacing.sm,
    overflow: 'hidden',
  },
  sectionEmpty: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginBottom: 12,
  },
  sheetFooter: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  skeletonWrap: {
    marginTop: mobileTheme.spacing.lg,
  },
  statBlock: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.3,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  statValue: {
    color: mobileTheme.colors.text,
    fontSize: 26,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.6,
  },
  subtitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 15,
    marginTop: mobileTheme.spacing.sm,
    textAlign: 'center',
  },
  suggestionCopy: {
    flex: 1,
    marginRight: 12,
  },
  suggestionGroup: {
    marginTop: mobileTheme.spacing.md,
  },
  suggestionGroupTitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  suggestionRow: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: mobileTheme.spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionsTitle: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
  },
  suggestionTaskMeta: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 2,
  },
  suggestionTaskTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
  },
  summaryAccentBubble: {
    backgroundColor: mobileTheme.colors.accentSoft,
    borderRadius: 40,
    height: 80,
    opacity: 0.5,
    position: 'absolute',
    right: -20,
    top: -20,
    width: 80,
  },
  summaryCard: {
    overflow: 'hidden',
    position: 'relative',
  },
  summaryMeta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  summaryStatsRow: {
    flexDirection: 'row',
    marginTop: mobileTheme.spacing.md,
  },
  summaryTitle: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.black,
  },
});
