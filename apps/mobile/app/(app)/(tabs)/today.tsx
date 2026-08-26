/* eslint-disable react-hooks/exhaustive-deps -- today renderTodayItem stable; router is stable expo-router singleton */
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { useBottomChromeMetrics } from '@/components/mobile/navigation/bottomChrome';
import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { HeaderActions } from '@/components/mobile/ui/HeaderActions';
import { Card } from '@/components/mobile/ui/Card';
import { Button } from '@/components/mobile/ui/Button';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { SkeletonCard } from '@/components/mobile/ui/Skeleton';
import { DailyMomentum } from '@/features/today/components/DailyMomentum';
import { TodaySectionEmpty, TodaySectionHeader } from '@/features/today/components/TodaySection';
import { TodayTaskCard } from '@/features/today/components/TodayTaskCard';
import {
  useAddTaskToTodayMutation,
  useClearTodayCompletedMutation,
  useRemoveTaskFromTodayMutation,
  useTodayWorkspaceQuery,
  useUpdateTodayTaskStatusMutation,
} from '@/features/today/query';
import { useUpdateTaskMutation } from '@/features/tasks/query';
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

function formatDueDate(task: MobileTodayTask) {
  if (!task.dueDate) {
    return 'No due date';
  }

  const date = new Date(`${task.dueDate}T00:00:00`);
  const formatted = Number.isNaN(date.getTime())
    ? task.dueDate
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (task.dueBucket === 'overdue') {
    return `Overdue ${formatted}`;
  }

  if (task.dueBucket === 'today') {
    return 'Due today';
  }

  return formatted;
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
  const { contentBottomPaddingNoFab } = useBottomChromeMetrics();
  const todayQuery = useTodayWorkspaceQuery();
  const updateTaskMutation = useUpdateTaskMutation();
  const statusMutation = useUpdateTodayTaskStatusMutation();
  const addTaskMutation = useAddTaskToTodayMutation();
  const removeTaskMutation = useRemoveTaskFromTodayMutation();
  const clearCompletedMutation = useClearTodayCompletedMutation();

  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);

  const { data, error, isError, isFetched, isPending, isRefetching, refetch } = todayQuery;
  const today = data ?? null;

  const allSectionTasks = useMemo(
    () =>
      today
        ? [
            ...today.sections.planned,
            ...today.sections.inProgress,
            ...today.sections.blocked,
            ...today.sections.completed,
          ]
        : [],
    [today],
  );

  const activeTask = useMemo(
    () => allSectionTasks.find((task) => task.id === selectedTaskId) ?? null,
    [allSectionTasks, selectedTaskId],
  );

  const todayIso = useMemo(() => getLocalIsoDate(new Date()), []);
  const tomorrowIso = useMemo(() => getLocalIsoDate(addLocalDays(new Date(), 1)), []);

  useFocusEffect(
    useCallback(() => {
      if (!isFetched) {
        return;
      }

      refetch().catch(() => {
        // Keep existing data visible if focus refresh fails.
      });
    }, [isFetched, refetch]),
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

  const onRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const runStatusAction = useCallback(
    async (task: MobileTodayTask, status: MobileTaskStatus) => {
      setActionError(null);
      setActiveTaskId(task.id);

      try {
        await statusMutation.mutateAsync({ taskId: task.id, status });
      } catch (mutationError) {
        setActionError(formatMessage(mutationError, 'Unable to update task status.'));
      } finally {
        setActiveTaskId(null);
      }
    },
    [statusMutation],
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
        await updateTaskMutation.mutateAsync({ taskId: task.id, input });
      } catch (mutationError) {
        setActionError(formatMessage(mutationError, 'Unable to update task.'));
      } finally {
        setActiveTaskId(null);
      }
    },
    [updateTaskMutation],
  );

  const runRemoveFromToday = useCallback(
    async (task: MobileTodayTask) => {
      setActionError(null);
      setActiveTaskId(task.id);

      try {
        await removeTaskMutation.mutateAsync(task.id);
      } catch (mutationError) {
        setActionError(formatMessage(mutationError, 'Unable to remove task from Today.'));
      } finally {
        setActiveTaskId(null);
      }
    },
    [removeTaskMutation],
  );

  const runAddSuggestion = useCallback(
    async (task: MobileTodayTask) => {
      setActionError(null);
      setActiveSuggestionId(task.id);

      try {
        await addTaskMutation.mutateAsync(task.id);
      } catch (mutationError) {
        setActionError(formatMessage(mutationError, 'Unable to add task to Today.'));
      } finally {
        setActiveSuggestionId(null);
      }
    },
    [addTaskMutation],
  );

  const runClearCompleted = useCallback(async () => {
    setActionError(null);

    try {
      await clearCompletedMutation.mutateAsync();
    } catch (clearError) {
      setActionError(formatMessage(clearError, 'Unable to clear completed tasks from Today.'));
    }
  }, [clearCompletedMutation]);

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

  const renderTodayItem = useCallback(
    ({ item }: { item: MobileTodayTask }) => {
      const isMutating = activeTaskId === item.id;
      const statusActions = getStatusActions(item);
      const primaryAction = statusActions[0] ?? { label: 'Open', status: item.status };

      return (
        <View style={styles.pagePadding}>
          <TodayTaskCard
            blockedReason={item.status === 'blocked' ? item.blockedReason : null}
            busy={isMutating}
            dueLabel={formatDueDate(item)}
            goal={item.goalTitle}
            muted={item.status === 'done'}
            onActions={() => setSelectedTaskId(item.id)}
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
      );
    },
    [activeTaskId, runStatusAction],
  );

  const isLoading = isPending && !today;

  if (isLoading) {
    return (
      <AppScreen testID="today-loading">
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.subtitle}>Loading Today...</Text>
        </View>
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </AppScreen>
    );
  }

  if (isError && !today) {
    const loadError =
      error instanceof Error ? error.message : 'Unable to load Today right now.';

    return (
      <AppScreen testID="today-error">
        <View style={styles.centered}>
          <Text style={styles.title}>Today</Text>
          <Text style={styles.errorTextCentered}>{loadError}</Text>
          <Button
            title="Retry"
            variant="secondary"
            onPress={() => {
              onRefresh().catch(() => {
                // handled in query state
              });
            }}
            style={styles.retryButton}
          />
        </View>
      </AppScreen>
    );
  }

  if (!today) {
    return null;
  }

  const todayCount = getTodayTaskCount(today);
  const completedRatio =
    todayCount > 0 ? Math.round((today.summary.completedCount / todayCount) * 100) : 0;
  const isRefreshing = isRefetching && !isLoading;
  const weekday = new Date(`${today.date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
  });

  return (
    <AppScreen padded={false} testID="today-screen">
      <SectionList
        contentContainerStyle={[styles.listContent, { paddingBottom: contentBottomPaddingNoFab }]}
        keyExtractor={(item) => item.id}
        sections={sections}
        stickySectionHeadersEnabled={false}
        initialNumToRender={10}
        windowSize={5}
        maxToRenderPerBatch={10}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.pagePadding}>
            <ScreenHeader
              eyebrow={weekday}
              title="Today"
              description={`${today.summary.trackedTodayLabel} tracked · ${today.summary.selectedCount} selected`}
              rightSlot={<HeaderActions />}
            />

            <DailyMomentum
              date={today.date}
              summary={today.summary}
              todayCount={todayCount}
              completedRatio={completedRatio}
              isClearing={clearCompletedMutation.isPending}
              onClearCompleted={runClearCompleted}
            />

            {actionError ? (
              <FeedbackBanner message={actionError} tone="danger" style={styles.feedback} />
            ) : null}
          </View>
        }
        ListFooterComponent={
          <View style={styles.pagePadding}>
            <Card style={styles.suggestionsCard}>
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
                          <Button
                            title={isMutating ? 'Adding...' : 'Add'}
                            variant="secondary"
                            size="sm"
                            disabled={isMutating}
                            loading={isMutating}
                            onPress={() => {
                              runAddSuggestion(task).catch(() => {
                                // handled in runAddSuggestion state
                              });
                            }}
                            testID={`add-suggestion-${task.id}`}
                          />
                        </View>
                      );
                    })}
                  </View>
                ) : null,
              )}
            </Card>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.pagePadding}>
            <TodaySectionHeader title={section.title} count={section.data.length} />
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0 ? (
            <View style={styles.pagePadding}>
              <TodaySectionEmpty emptyText={section.emptyText} />
            </View>
          ) : null
        }
        renderItem={renderTodayItem}
      />

      <ActionSheet
        footer={activeTaskId ? <Text style={styles.sheetFooter}>Running update...</Text> : null}
        items={actionSheetItems}
        onClose={() => setSelectedTaskId(null)}
        subtitle={
          activeTask
            ? `${activeTask.projectName}${activeTask.goalTitle ? ` · ${activeTask.goalTitle}` : ''}`
            : undefined
        }
        title={activeTask?.title ?? 'Task actions'}
        visible={Boolean(activeTask)}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  errorTextCentered: {
    color: mobileTheme.colors.danger,
    marginTop: mobileTheme.spacing.sm,
    textAlign: 'center',
  },
  feedback: {
    marginTop: mobileTheme.spacing.md,
  },
  listContent: {
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingTop: mobileTheme.spacing.sm,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingTop: mobileTheme.spacing.xxl,
  },
  pagePadding: {
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  retryButton: {
    marginTop: mobileTheme.spacing.lg,
  },
  sectionEmpty: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginBottom: 12,
    marginTop: mobileTheme.spacing.sm,
  },
  sheetFooter: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  skeletonWrap: {
    marginTop: mobileTheme.spacing.lg,
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
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 12,
  },
  suggestionsCard: {
    marginTop: mobileTheme.spacing.md,
  },
  suggestionsTitle: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0,
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
  title: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.black,
  },
});
