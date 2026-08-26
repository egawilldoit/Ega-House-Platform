import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { FadeSlide } from '@/components/mobile/motion/FadeSlide';
import { useReducedMotion } from '@/components/mobile/motion/ReducedMotion';
import { useBottomChromeMetrics } from '@/components/mobile/navigation/bottomChrome';
import { mobileTheme } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { EmptyState } from '@/components/mobile/ui/EmptyState';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { SearchField } from '@/components/mobile/ui/SearchField';
import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';
import { SkeletonCard } from '@/components/mobile/ui/Skeleton';
import { useTaskListQuery, useUpdateTaskMutation } from '@/features/tasks/query';
import { matchTaskViewPreset, TASK_VIEW_PRESETS, type TaskViewId, type TaskViewPriority } from '@/features/tasks/views';
import type { MobileTaskDueFilter, MobileTaskListItem, MobileTaskPriority, MobileTaskSortValue, MobileTaskStatus, UpdateTaskInput } from '@/types/tasks';

import { TaskCard } from './TaskCard';
import { TaskQuickFilters } from './TaskQuickFilters';

const STATUS_OPTIONS: MobileTaskStatus[] = ['todo', 'in_progress', 'done', 'blocked'];
const PRIORITY_OPTIONS: MobileTaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const FILTER_STATUS_OPTIONS: Array<{ label: string; value: MobileTaskStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Todo', value: 'todo' },
  { label: 'Doing', value: 'in_progress' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Done', value: 'done' },
];

const FILTER_PRIORITY_OPTIONS: Array<{ label: string; value: MobileTaskPriority | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
];

const FILTER_DUE_OPTIONS: Array<{ label: string; value: MobileTaskDueFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Today', value: 'due_today' },
  { label: 'Soon', value: 'due_soon' },
  { label: 'None', value: 'no_due_date' },
];

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
  const { contentBottomPadding } = useBottomChromeMetrics();
  const reducedMotion = useReducedMotion();
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

  const renderTaskItem = useCallback(
    ({ item }: { item: MobileTaskListItem }) => {
      const isUpdating = Boolean(updatingTaskIds[item.id]);
      const itemError = taskErrors[item.id];
      return (
        <View style={styles.cardWrap}>
          <TaskCard
            blockedReason={item.status === 'blocked' ? item.blockedReason : null}
            dueLabel={formatDueDate(item.dueDate)}
            estimateLabel={item.estimateMinutes !== null && item.estimateMinutes > 0 ? `${item.estimateMinutes}m est` : undefined}
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
    },
    [updatingTaskIds, taskErrors],
  );

  // Perceived performance: skeleton only on cold start (no cached data); stale list stays visible otherwise.
  // `isPending && !data` — cold skeleton, not blank spinner on refetch.
  // `isFetching && data` — inline “Refreshing…” banner, not full-screen spinner.
  const isPending = tasksQuery.isPending && !tasksQuery.data;
  const isRefetching = tasksQuery.isFetching && !!tasksQuery.data;
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
        // FlatList tuning (Wave 10.11): React Native defaults are the safer baseline.
        // - `initialNumToRender={10}` — default 10; first viewport ~6 rows + buffer, reasonable for first paint without blank.
        // - `maxToRenderPerBatch={10}` — default 10; keeps JS slice small, avoids freezing during tab press/scroll.
        // - `windowSize` omitted → default 21 (10 viewports each side). Chosen over 5: row height wraps
        //   (title 2 lines + meta + chips + blockedReason, ~90-150) not deterministic → no getItemLayout (would mis-measure).
        //   Fast-fling down/up benchmark with 5 showed blank gap; 21 keeps buffered window without O(N) cost for
        //   typical 20-100 tasks. Verified tap-during-rendering stays responsive.
        // - `removeClippedSubviews` omitted → default (Android true, iOS false) enables recycling. `false` disabled
        //   recycling (O(N) mounts) and not needed — press scale 0.985 stays inside bounds, no transform outside clip.
        //   Tested: no clipping bug with plain Card (no shadow) rows.
        data={filteredTasks}
        keyExtractor={(item) => item.id}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        contentContainerStyle={[styles.listContent, { paddingBottom: contentBottomPadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={!!isRefetching} onRefresh={onRefresh} colors={[mobileTheme.colors.accent]} tintColor={mobileTheme.colors.accent} />}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <View style={styles.searchRow}>
              <SearchField value={searchQuery} onChangeText={setSearchQuery} placeholder="Search tasks" testID="tasks-search-field" style={styles.searchField} />
              <Pressable
                accessibilityLabel={collapsed ? 'Expand filters' : 'Collapse filters'}
                accessibilityRole="button"
                onPress={() => setCollapsed((v) => !v)}
                style={({ pressed }) => [styles.filterTrigger, pressed ? styles.filterTriggerPressed : null]}
                testID="tasks-filter-trigger"
              >
                <Ionicons color={mobileTheme.colors.textMuted} name="filter-outline" size={16} />
                <Text style={styles.filterTriggerText}>Filters</Text>
                {activeCount > 0 ? (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>•{activeCount}</Text>
                  </View>
                ) : null}
                <Ionicons color={mobileTheme.colors.textSubtle} name={collapsed ? 'chevron-down' : 'chevron-up'} size={14} />
              </Pressable>
            </View>

            <View style={styles.quickWrap}>
              <TaskQuickFilters activeViewId={activeViewId} onSelect={selectTaskView} />
            </View>

            {!collapsed ? (
              <FadeSlide visible={!collapsed} durationMs={reducedMotion ? 0 : 200} offsetY={reducedMotion ? 0 : 8} style={styles.filterExpandedWrap}>
                <View style={styles.filterBody}>
                  <Text style={styles.filterLabel}>Status</Text>
                  <SegmentedControl value={statusFilter} options={FILTER_STATUS_OPTIONS} onChange={setStatusFilter} testID="task-status-filter" />

                  <Text style={styles.filterLabel}>Priority</Text>
                  <SegmentedControl
                    value={priorityFilter}
                    options={FILTER_PRIORITY_OPTIONS}
                    onChange={setPriorityFilter}
                    testID="task-priority-filter"
                  />

                  <Text style={styles.filterLabel}>Due date</Text>
                  <SegmentedControl value={dueFilter} options={FILTER_DUE_OPTIONS} onChange={setDueFilter} testID="task-due-filter" />
                </View>
              </FadeSlide>
            ) : null}

            <View style={styles.summaryRow}>
              <View style={styles.summaryLeft}>
                <Text style={styles.summaryText}>
                  {taskSummary.visible} {taskSummary.visible === 1 ? 'task' : 'tasks'}
                </Text>
                {taskSummary.inProgress > 0 ? <Text style={styles.summaryMuted}> · {taskSummary.inProgress} active</Text> : null}
                {taskSummary.urgent > 0 ? <Text style={styles.summaryUrgent}> · {taskSummary.urgent} urgent</Text> : null}
                {taskSummary.blocked > 0 ? <Text style={styles.summaryBlocked}> · {taskSummary.blocked} blocked</Text> : null}
                {searchQuery.trim() ? <Text style={styles.summaryMuted}> · filtered</Text> : null}
              </View>
              {hasFilters ? (
                <Pressable onPress={clearFilters} hitSlop={8} style={styles.summaryClearWrap}>
                  <Text style={styles.summaryClear}>Clear</Text>
                </Pressable>
              ) : null}
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
        renderItem={renderTaskItem}
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
  filterBadge: {
    backgroundColor: mobileTheme.colors.accentSoft,
    borderRadius: mobileTheme.radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  filterBadgeText: {
    color: mobileTheme.colors.accentDark,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
  },
  filterBody: {
    gap: 0,
  },
  filterExpandedWrap: {
    marginTop: 6,
  },
  filterLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: mobileTheme.spacing.sm,
    textTransform: 'uppercase',
  },
  filterTrigger: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: mobileTheme.spacing.md,
  },
  filterTriggerPressed: {
    opacity: 0.78,
  },
  filterTriggerText: {
    color: mobileTheme.colors.text,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
  },
  headerWrap: {
    marginBottom: 4,
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
    paddingTop: 4,
  },
  quickWrap: {
    marginTop: 6,
  },
  refreshingHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 6,
  },
  searchField: {
    flex: 1,
  },
  searchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
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
  summaryBlocked: {
    color: mobileTheme.colors.danger,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  summaryClear: {
    color: mobileTheme.colors.accent,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  summaryClearWrap: {
    paddingLeft: mobileTheme.spacing.sm,
  },
  summaryLeft: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  summaryMuted: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  summaryText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  summaryUrgent: {
    color: mobileTheme.colors.danger,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
});
