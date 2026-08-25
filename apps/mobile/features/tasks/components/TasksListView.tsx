import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { mobileTheme } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { EmptyState } from '@/components/mobile/ui/EmptyState';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { SearchField } from '@/components/mobile/ui/SearchField';
import { SkeletonCard } from '@/components/mobile/ui/Skeleton';
import { useTaskListQuery, useUpdateTaskMutation } from '@/features/tasks/query';
import { matchTaskViewPreset, TASK_VIEW_PRESETS, type TaskViewId, type TaskViewPriority } from '@/features/tasks/views';
import type { MobileTaskDueFilter, MobileTaskListItem, MobileTaskPriority, MobileTaskSortValue, MobileTaskStatus, UpdateTaskInput } from '@/types/tasks';

import { TaskCard } from './TaskCard';
import { TaskFilters } from './TaskFilters';
import { TaskQuickFilters } from './TaskQuickFilters';

const STATUS_OPTIONS: MobileTaskStatus[] = ['todo', 'in_progress', 'done', 'blocked'];
const PRIORITY_OPTIONS: MobileTaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const EMPTY_TASKS: MobileTaskListItem[] = [];

function formatToken(value: string) {
  return value.replaceAll('_', ' ');
}

function formatDueDate(value: string | null) {
  if (!value) return 'No due date';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function buildDueDateOptions() {
  const now = new Date();
  return [
    { label: 'Today', value: toIsoDate(now) },
    { label: 'Tomorrow', value: toIsoDate(addDays(now, 1)) },
    { label: 'Next 7 days', value: toIsoDate(addDays(now, 7)) },
    { label: 'Clear due date', value: null as string | null },
  ];
}

function getStatusOptions(task: MobileTaskListItem) {
  if (task.status === 'blocked') return STATUS_OPTIONS;
  return STATUS_OPTIONS.filter((status) => status !== 'blocked');
}

export function TasksListView() {
  const [statusFilter, setStatusFilter] = useState<MobileTaskStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskViewPriority>('all');
  const [dueFilter, setDueFilter] = useState<MobileTaskDueFilter>('all');
  const [sortFilter, setSortFilter] = useState<MobileTaskSortValue>('updated_desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState(true);

  const tasksQuery = useTaskListQuery({
    due: dueFilter,
    status: statusFilter === 'all' ? null : statusFilter,
    priority: priorityFilter === 'all' ? null : priorityFilter,
    sort: sortFilter,
  });

  const updateTaskMutation = useUpdateTaskMutation();
  const { refetch } = tasksQuery;

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<Record<string, boolean>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string | undefined>>({});

  const rawTasks: MobileTaskListItem[] = tasksQuery.data?.tasks ?? EMPTY_TASKS;
  const counters = tasksQuery.data?.counters ?? null;
  const totalTaskCount = counters?.total ?? 0;

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rawTasks;
    return rawTasks.filter((t) => {
      const hay = `${t.title} ${t.project.name} ${t.goal?.title ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rawTasks, searchQuery]);

  const activeViewId = matchTaskViewPreset({
    status: statusFilter,
    priority: priorityFilter,
    due: dueFilter,
    sort: sortFilter,
  });

  const hasFilters =
    statusFilter !== 'all' || priorityFilter !== 'all' || dueFilter !== 'all' || sortFilter !== 'updated_desc' || searchQuery.trim().length > 0;

  const activeCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (priorityFilter !== 'all' ? 1 : 0) +
    (dueFilter !== 'all' ? 1 : 0) +
    (sortFilter !== 'updated_desc' ? 1 : 0) +
    (searchQuery.trim().length > 0 ? 1 : 0);

  const selectTaskView = useCallback((viewId: TaskViewId) => {
    const preset = TASK_VIEW_PRESETS.find((item) => item.id === viewId);
    if (!preset) return;
    setStatusFilter(preset.status);
    setPriorityFilter(preset.priority);
    setDueFilter(preset.due);
    setSortFilter(preset.sort);
  }, []);

  const clearFilters = useCallback(() => {
    selectTaskView('all');
    setSearchQuery('');
  }, [selectTaskView]);

  const taskSummary = useMemo(
    () => ({
      visible: filteredTasks.length,
      inProgress: counters?.byStatus.in_progress ?? 0,
      blocked: counters?.byStatus.blocked ?? 0,
      urgent: counters?.byPriority.urgent ?? 0,
    }),
    [counters, filteredTasks.length],
  );

  const dueDateOptions = useMemo(() => buildDueDateOptions(), []);
  const activeTask = useMemo(() => filteredTasks.find((task) => task.id === activeTaskId) ?? rawTasks.find((t) => t.id === activeTaskId) ?? null, [activeTaskId, filteredTasks, rawTasks]);

  const loadError = tasksQuery.error instanceof Error ? tasksQuery.error.message : 'Unable to load tasks right now.';

  useFocusEffect(
    useCallback(() => {
      refetch().catch(() => {});
    }, [refetch]),
  );

  const onRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const mutateTask = useCallback(
    async (taskId: string, input: UpdateTaskInput) => {
      setUpdatingTaskIds((current) => ({ ...current, [taskId]: true }));
      setTaskErrors((current) => ({ ...current, [taskId]: undefined }));
      try {
        await updateTaskMutation.mutateAsync({ taskId, input });
      } catch (updateError) {
        const message = updateError instanceof Error ? updateError.message : 'Unable to update task right now.';
        setTaskErrors((current) => ({ ...current, [taskId]: message }));
      } finally {
        setUpdatingTaskIds((current) => ({ ...current, [taskId]: false }));
      }
    },
    [updateTaskMutation],
  );

  const actionSheetItems = useMemo<ActionSheetItem[]>(() => {
    if (!activeTask) return [];
    const statusItems = getStatusOptions(activeTask).map((status) => ({
      key: `status-${status}`,
      label: status === 'todo' ? 'Move to To do' : status === 'in_progress' ? 'Move to In progress' : status === 'done' ? 'Mark done' : 'Mark blocked',
      description: status === activeTask.status ? 'Current status' : undefined,
      disabled: status === activeTask.status,
      onPress: () => {
        mutateTask(activeTask.id, { status }).catch(() => {});
      },
    }));

    const priorityItems = PRIORITY_OPTIONS.map((priority) => ({
      key: `priority-${priority}`,
      label: `Set priority: ${formatToken(priority)}`,
      description: priority === activeTask.priority ? 'Current priority' : undefined,
      disabled: priority === activeTask.priority,
      onPress: () => {
        mutateTask(activeTask.id, { priority }).catch(() => {});
      },
    }));

    const dueItems = dueDateOptions.map((option) => ({
      key: `due-${option.label}`,
      label: option.label === 'Today' ? 'Due: Today' : `Due: ${option.label}`,
      description: option.value ? `Set due to ${formatDueDate(option.value)}` : 'Remove due date',
      disabled: option.value === activeTask.dueDate,
      onPress: () => {
        mutateTask(activeTask.id, { dueDate: option.value }).catch(() => {});
      },
    }));

    return [
      {
        key: 'open',
        label: 'Open details',
        onPress: () => {
          router.push({ pathname: '/(app)/tasks/[id]', params: { id: activeTask.id } });
        },
      },
      ...statusItems,
      ...priorityItems,
      ...dueItems,
    ];
  }, [activeTask, dueDateOptions, mutateTask]);

  const isPending = tasksQuery.isPending && !tasksQuery.data;
  const isRefetching = tasksQuery.isRefetching && !!tasksQuery.data;
  const isError = tasksQuery.isError && !tasksQuery.data;

  if (isPending) {
    return (
      <View style={styles.skeletonWrap} testID="tasks-loading">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.errorWrap} testID="tasks-error">
        <Card style={styles.errorCard}>
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={22} color={mobileTheme.colors.danger} />
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        </Card>
        <View style={styles.centered}>
          <Button title="Retry" variant="secondary" onPress={onRefresh} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="tasks-list-view">
      <FlatList
        data={filteredTasks}
        keyExtractor={(item) => item.id}
        initialNumToRender={10}
        windowSize={5}
        maxToRenderPerBatch={10}
        removeClippedSubviews={false}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={!!isRefetching} onRefresh={onRefresh} colors={[mobileTheme.colors.accent]} tintColor={mobileTheme.colors.accent} />}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <SearchField value={searchQuery} onChangeText={setSearchQuery} placeholder="Search tasks" testID="tasks-search-field" />

            <View style={styles.quickWrap}>
              <TaskQuickFilters activeViewId={activeViewId} onSelect={selectTaskView} />
            </View>

            <TaskFilters
              statusFilter={statusFilter}
              priorityFilter={priorityFilter}
              dueFilter={dueFilter}
              activeCount={activeCount}
              hasFilters={hasFilters}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((v) => !v)}
              onChangeStatus={setStatusFilter}
              onChangePriority={setPriorityFilter}
              onChangeDue={setDueFilter}
              onClear={clearFilters}
            />

            <View style={styles.counterRow}>
              <Text style={styles.counterText}>
                Showing {filteredTasks.length} of {totalTaskCount} task{totalTaskCount === 1 ? '' : 's'}
                {searchQuery.trim() ? ` · filtered` : ''}
              </Text>
              {hasFilters ? (
                <Text style={styles.counterHint} onPress={clearFilters}>
                  Clear
                </Text>
              ) : null}
            </View>

            {activeCount > 0 && collapsed ? (
              <Text style={styles.activeHint}>
                {activeCount} filter{activeCount === 1 ? '' : 's'} active · tap Filters to edit
              </Text>
            ) : null}

            <View style={styles.summaryGrid}>
              <Card style={styles.summaryCard} contentStyle={styles.summaryContent}>
                <Ionicons name="list-outline" size={16} color={mobileTheme.colors.accent} />
                <Text style={styles.summaryValue}>{taskSummary.visible}</Text>
                <Text style={styles.summaryLabel}>Visible</Text>
              </Card>
              <Card style={styles.summaryCard} contentStyle={styles.summaryContent}>
                <Ionicons name="flash-outline" size={16} color={mobileTheme.colors.info} />
                <Text style={styles.summaryValue}>{taskSummary.inProgress}</Text>
                <Text style={styles.summaryLabel}>Active</Text>
              </Card>
              <Card style={styles.summaryCard} contentStyle={styles.summaryContent}>
                <Ionicons name="alert-circle-outline" size={16} color={mobileTheme.colors.blocked} />
                <Text style={styles.summaryValue}>{taskSummary.blocked}</Text>
                <Text style={styles.summaryLabel}>Blocked</Text>
              </Card>
              <Card style={styles.summaryCard} contentStyle={styles.summaryContent}>
                <Ionicons name="flame-outline" size={16} color={mobileTheme.colors.danger} />
                <Text style={styles.summaryValue}>{taskSummary.urgent}</Text>
                <Text style={styles.summaryLabel}>Urgent</Text>
              </Card>
            </View>

            {isRefetching ? <Text style={styles.refreshingHint}>Refreshing…</Text> : null}
            {taskErrors[activeTaskId ?? ''] ? <FeedbackBanner message={taskErrors[activeTaskId ?? ''] ?? ''} tone="danger" style={styles.inlineErrorBanner} /> : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Card contentStyle={styles.emptyCardContent}>
              <EmptyState
                icon="clipboard-outline"
                iconSize={36}
                title={hasFilters ? 'No tasks match this view' : 'Create your first task'}
                description={hasFilters ? 'Try a different status, priority, or due-date filter.' : 'Capture the next execution step and keep momentum visible.'}
                action={
                  hasFilters ? (
                    <View style={styles.emptyActions}>
                      <Button title="Clear filters" variant="secondary" size="sm" onPress={clearFilters} />
                      <Button title="Create task" size="sm" onPress={() => router.push('/(app)/tasks/create')} />
                    </View>
                  ) : (
                    <Button title="Create task" onPress={() => router.push('/(app)/tasks/create')} />
                  )
                }
              />
            </Card>
          </View>
        }
        renderItem={({ item }) => {
          const isUpdating = Boolean(updatingTaskIds[item.id]);
          const itemError = taskErrors[item.id];
          return (
            <View style={styles.cardWrap}>
              <TaskCard
                blockedReason={item.status === 'blocked' ? item.blockedReason : null}
                dueLabel={formatDueDate(item.dueDate)}
                estimateLabel={item.estimateMinutes !== null ? `${item.estimateMinutes}m est` : undefined}
                goal={item.goal?.title}
                onActions={() => setActiveTaskId(item.id)}
                onOpen={() => router.push({ pathname: '/(app)/tasks/[id]', params: { id: item.id } })}
                priority={item.priority}
                project={item.project.name}
                saving={isUpdating}
                status={item.status}
                title={item.title}
              />
              {itemError ? <Text style={styles.inlineErrorText}>{itemError}</Text> : null}
            </View>
          );
        }}
      />

      <ActionSheet
        footer={activeTask && updatingTaskIds[activeTask.id] ? <Text style={styles.sheetMessage}>Updating task…</Text> : null}
        items={actionSheetItems}
        onClose={() => setActiveTaskId(null)}
        subtitle={activeTask ? `${activeTask.project.name}${activeTask.goal ? ` · ${activeTask.goal.title}` : ''}` : undefined}
        title={activeTask ? activeTask.title : 'Task actions'}
        visible={Boolean(activeTask)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  activeHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: mobileTheme.spacing.sm,
  },
  cardWrap: {
    marginBottom: mobileTheme.spacing.sm,
  },
  centered: {
    alignItems: 'center',
    marginTop: mobileTheme.spacing.lg,
  },
  container: {
    flex: 1,
  },
  counterHint: {
    color: mobileTheme.colors.accent,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  counterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: mobileTheme.spacing.sm,
  },
  counterText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  emptyActions: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    justifyContent: 'center',
  },
  emptyCardContent: {
    padding: 0,
  },
  emptyWrap: {
    marginTop: mobileTheme.spacing.sm,
  },
  errorCard: {
    marginTop: mobileTheme.spacing.sm,
  },
  errorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    flex: 1,
    fontWeight: mobileTheme.font.semibold,
  },
  errorWrap: {
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  headerWrap: {
    marginBottom: mobileTheme.spacing.sm,
  },
  inlineErrorBanner: {
    marginTop: mobileTheme.spacing.sm,
  },
  inlineErrorText: {
    color: mobileTheme.colors.danger,
    fontSize: 12,
    marginTop: 6,
    paddingHorizontal: 6,
  },
  listContent: {
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  quickWrap: {
    marginTop: mobileTheme.spacing.md,
  },
  refreshingHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 6,
  },
  sheetMessage: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  skeletonWrap: {
    gap: mobileTheme.spacing.sm,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.md,
  },
  summaryCard: {
    flex: 1,
  },
  summaryContent: {
    alignItems: 'flex-start',
    gap: 2,
    minHeight: 76,
    padding: 10,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  summaryLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: mobileTheme.font.bold,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: mobileTheme.colors.text,
    fontSize: 18,
    fontWeight: mobileTheme.font.black,
  },
});
