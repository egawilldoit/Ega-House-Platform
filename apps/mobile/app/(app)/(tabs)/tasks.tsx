import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import {
  EmptyState,
  MobileScreen,
  MobileScreenHeader,
  SegmentedControl,
  PrimaryFab,
  SkeletonCard,
  SurfaceCard,
} from '@/components/mobile/primitives';
import { TaskCard } from '@/components/mobile/TaskCard';
import { mobileTheme } from '@/components/mobile/theme';
import { useTaskListQuery, useUpdateTaskMutation } from '@/features/tasks/query';
import type {
  MobileTaskDueFilter,
  MobileTaskListItem,
  MobileTaskPriority,
  MobileTaskStatus,
  UpdateTaskInput,
} from '@/types/tasks';

const STATUS_OPTIONS: MobileTaskStatus[] = ['todo', 'in_progress', 'done', 'blocked'];
const PRIORITY_OPTIONS: MobileTaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const EMPTY_TASKS: MobileTaskListItem[] = [];
const STATUS_FILTER_OPTIONS: Array<{ label: string; value: MobileTaskStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'To do', value: 'todo' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Done', value: 'done' },
];
const DUE_FILTER_OPTIONS: Array<{ label: string; value: MobileTaskDueFilter }> = [
  { label: 'All dates', value: 'all' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Due today', value: 'due_today' },
  { label: 'Due soon', value: 'due_soon' },
  { label: 'No due date', value: 'no_due_date' },
];

function formatToken(value: string) {
  return value.replace(/_/g, ' ');
}

function formatDueDate(value: string | null) {
  if (!value) {
    return 'No due date';
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
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
    { label: 'Clear due date', value: null },
  ];
}

function getStatusOptions(task: MobileTaskListItem) {
  if (task.status === 'blocked') {
    return STATUS_OPTIONS;
  }

  return STATUS_OPTIONS.filter((status) => status !== 'blocked');
}

export default function TasksScreen() {
  const [statusFilter, setStatusFilter] = useState<MobileTaskStatus | 'all'>('all');
  const [dueFilter, setDueFilter] = useState<MobileTaskDueFilter>('all');
  const tasksQuery = useTaskListQuery({
    due: dueFilter,
    status: statusFilter === 'all' ? null : statusFilter,
  });
  const updateTaskMutation = useUpdateTaskMutation();
  const { refetch } = tasksQuery;

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<Record<string, boolean>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string | undefined>>({});

  const tasks: MobileTaskListItem[] = tasksQuery.data?.tasks ?? EMPTY_TASKS;
  const totalTaskCount = tasksQuery.data?.counters.total ?? 0;
  const hasFilters = statusFilter !== 'all' || dueFilter !== 'all';
  const taskSummary = useMemo(() => {
    const visible = tasks.length;
    const inProgress = tasks.filter((task) => task.status === 'in_progress').length;
    const blocked = tasks.filter((task) => task.status === 'blocked').length;
    const urgent = tasks.filter((task) => task.priority === 'urgent').length;

    return { visible, inProgress, blocked, urgent };
  }, [tasks]);
  const dueDateOptions = useMemo(() => buildDueDateOptions(), []);
  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  );

  const loadError =
    tasksQuery.error instanceof Error ? tasksQuery.error.message : 'Unable to load tasks right now.';

  useFocusEffect(
    useCallback(() => {
      refetch().catch(() => {
        // Error state handled by query.
      });
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
        const message =
          updateError instanceof Error ? updateError.message : 'Unable to update task right now.';

        setTaskErrors((current) => ({ ...current, [taskId]: message }));
      } finally {
        setUpdatingTaskIds((current) => ({ ...current, [taskId]: false }));
      }
    },
    [updateTaskMutation],
  );

  const actionSheetItems = useMemo<ActionSheetItem[]>(() => {
    if (!activeTask) {
      return [];
    }

    const statusItems = getStatusOptions(activeTask).map((status) => ({
      key: `status-${status}`,
      label:
        status === 'todo'
          ? 'Move to To do'
          : status === 'in_progress'
            ? 'Move to In progress'
            : status === 'done'
              ? 'Mark done'
              : 'Mark blocked',
      description: status === activeTask.status ? 'Current status' : undefined,
      disabled: status === activeTask.status,
      onPress: () => {
        mutateTask(activeTask.id, { status }).catch(() => {
          // handled in mutateTask
        });
      },
    }));

    const priorityItems = PRIORITY_OPTIONS.map((priority) => ({
      key: `priority-${priority}`,
      label: `Set priority: ${formatToken(priority)}`,
      description: priority === activeTask.priority ? 'Current priority' : undefined,
      disabled: priority === activeTask.priority,
      onPress: () => {
        mutateTask(activeTask.id, { priority }).catch(() => {
          // handled in mutateTask
        });
      },
    }));

    const dueItems = dueDateOptions.map((option) => ({
      key: `due-${option.label}`,
      label: option.label === 'Today' ? 'Due: Today' : `Due: ${option.label}`,
      description: option.value ? `Set due to ${formatDueDate(option.value)}` : 'Remove due date',
      disabled: option.value === activeTask.dueDate,
      onPress: () => {
        mutateTask(activeTask.id, { dueDate: option.value }).catch(() => {
          // handled in mutateTask
        });
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

  if (tasksQuery.isPending) {
    return (
      <MobileScreen>
        <View style={styles.headerWrap}>
          <MobileScreenHeader
            eyebrow="Execution"
            title="Tasks"
            description="Everything synced from your workspace"
            rightAction={
              <View style={styles.headerPill}>
                <Ionicons color={mobileTheme.colors.accentDark} name="list-outline" size={14} />
                <Text style={styles.headerPillText}>0 / {totalTaskCount}</Text>
              </View>
            }
          />
        </View>
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </MobileScreen>
    );
  }

  if (tasksQuery.isError) {
    return (
      <MobileScreen>
        <MobileScreenHeader
          eyebrow="Execution"
          title="Tasks"
          description="Everything synced from your workspace"
        />
        <SurfaceCard style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={22} color={mobileTheme.colors.danger} />
          <Text style={styles.errorText}>{loadError}</Text>
        </SurfaceCard>
        <View style={styles.centeredContent}>
          <Pressable onPress={onRefresh} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
        </View>
      </MobileScreen>
    );
  }

  return (
    <MobileScreen padded={false}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={tasks}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <EmptyState
            icon="clipboard-outline"
            iconSize={64}
            title={hasFilters ? 'No tasks match this view' : 'Create your first task'}
            description={
              hasFilters
                ? 'Try a different status or due-date filter.'
                : 'Capture the next execution step and keep momentum visible.'
            }
            action={
              hasFilters ? (
                <View style={styles.emptyActions}>
                  <Pressable
                    onPress={() => {
                      setStatusFilter('all');
                      setDueFilter('all');
                    }}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>Clear filters</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push('/(app)/tasks/create')}
                    style={styles.primaryButton}
                  >
                    <Text style={styles.primaryButtonText}>Create task</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => router.push('/(app)/tasks/create')}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>Create task</Text>
                </Pressable>
              )
            }
          />
        }
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <MobileScreenHeader
              eyebrow="Execution"
              title="Tasks"
              description={
                tasks.length > 0
                  ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} ready for action`
                  : hasFilters
                    ? 'No tasks match the current filters'
                    : 'Track and capture your next execution step'
              }
              rightAction={
                <View style={styles.headerPill}>
                  <Ionicons color={mobileTheme.colors.accentDark} name="list-outline" size={14} />
                  <Text style={styles.headerPillText}>
                    {tasks.length} / {totalTaskCount}
                  </Text>
                </View>
              }
            />
            <View style={styles.summaryGrid}>
              <SurfaceCard style={styles.summaryCard}>
                <Ionicons name="list-outline" size={16} color={mobileTheme.colors.accent} />
                <Text style={styles.summaryValue}>{taskSummary.visible}</Text>
                <Text style={styles.summaryLabel}>Visible</Text>
              </SurfaceCard>

              <SurfaceCard style={styles.summaryCard}>
                <Ionicons name="flash-outline" size={16} color={mobileTheme.colors.info} />
                <Text style={styles.summaryValue}>{taskSummary.inProgress}</Text>
                <Text style={styles.summaryLabel}>Active</Text>
              </SurfaceCard>

              <SurfaceCard style={styles.summaryCard}>
                <Ionicons
                  name="alert-circle-outline"
                  size={16}
                  color={mobileTheme.colors.blocked}
                />
                <Text style={styles.summaryValue}>{taskSummary.blocked}</Text>
                <Text style={styles.summaryLabel}>Blocked</Text>
              </SurfaceCard>

              <SurfaceCard style={styles.summaryCard}>
                <Ionicons name="flame-outline" size={16} color={mobileTheme.colors.danger} />
                <Text style={styles.summaryValue}>{taskSummary.urgent}</Text>
                <Text style={styles.summaryLabel}>Urgent</Text>
              </SurfaceCard>
            </View>
            <View style={styles.filterSection}>
              <View style={styles.filterTitleRow}>
                <View style={styles.filterTitleLeft}>
                  <Ionicons
                    color={mobileTheme.colors.textMuted}
                    name="filter-outline"
                    size={16}
                  />
                  <Text style={styles.filterTitle}>Task filters</Text>
                </View>
                {hasFilters ? (
                  <Pressable
                    onPress={() => {
                      setStatusFilter('all');
                      setDueFilter('all');
                    }}
                    style={styles.clearFiltersButton}
                  >
                    <Text style={styles.clearFiltersText}>Reset</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.filterLabel}>Status</Text>
              <SegmentedControl
                onChange={setStatusFilter}
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
              />
              <Text style={styles.filterLabel}>Due date</Text>
              <SegmentedControl
                onChange={setDueFilter}
                options={DUE_FILTER_OPTIONS}
                value={dueFilter}
              />
              <Text style={styles.filterCountText}>
                Showing {tasks.length} of {totalTaskCount} task{totalTaskCount === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={tasksQuery.isRefetching && !tasksQuery.isPending}
            onRefresh={onRefresh}
          />
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
                onOpen={() =>
                  router.push({ pathname: '/(app)/tasks/[id]', params: { id: item.id } })
                }
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

      <PrimaryFab label="Create Task" onPress={() => router.push('/(app)/tasks/create')} />

      <ActionSheet
        footer={
          activeTask && updatingTaskIds[activeTask.id] ? (
            <Text style={styles.sheetMessage}>Updating task...</Text>
          ) : null
        }
        items={actionSheetItems}
        onClose={() => setActiveTaskId(null)}
        subtitle={
          activeTask
            ? `${activeTask.project.name}${activeTask.goal ? ` · ${activeTask.goal.title}` : ''}`
            : undefined
        }
        title={activeTask ? activeTask.title : 'Task actions'}
        visible={Boolean(activeTask)}
      />
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    marginBottom: mobileTheme.spacing.sm,
  },
  centeredContent: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: mobileTheme.spacing.lg,
  },
  errorCard: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.dangerBg,
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.sm,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    flex: 1,
    fontWeight: mobileTheme.font.semibold,
  },
  filterCountText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: mobileTheme.spacing.sm,
  },
  filterTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
  },
  filterTitleLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  filterTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: mobileTheme.spacing.xs,
  },
  filterLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
    marginTop: mobileTheme.spacing.sm,
    textTransform: 'uppercase',
  },
  filterSection: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    marginTop: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.sm,
  },
  headerWrap: {
    paddingHorizontal: 16,
  },
  headerPill: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accentSoft,
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  headerPillText: {
    color: mobileTheme.colors.accentDark,
    fontSize: 12,
    fontWeight: mobileTheme.font.black,
  },
  inlineErrorText: {
    color: mobileTheme.colors.danger,
    marginTop: mobileTheme.spacing.sm,
    paddingHorizontal: 6,
  },
  listContent: {
    paddingBottom: 110,
    paddingHorizontal: 16,
    paddingTop: mobileTheme.spacing.sm,
  },
  clearFiltersButton: {
    borderRadius: mobileTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearFiltersText: {
    color: mobileTheme.colors.accentDark,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  primaryButton: {
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    marginTop: mobileTheme.spacing.md,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: mobileTheme.colors.textOnAccent,
    fontWeight: mobileTheme.font.extrabold,
  },
  secondaryButton: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    marginTop: mobileTheme.spacing.md,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  secondaryButtonText: {
    color: mobileTheme.colors.text,
    fontWeight: mobileTheme.font.extrabold,
  },
  sheetMessage: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  skeletonWrap: {
    marginTop: mobileTheme.spacing.sm,
  },
  emptyActions: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
  summaryCard: {
    alignItems: 'flex-start',
    flex: 1,
    gap: 4,
    padding: mobileTheme.spacing.sm,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginBottom: mobileTheme.spacing.sm,
  },
  summaryLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: mobileTheme.font.bold,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: mobileTheme.colors.text,
    fontSize: 20,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.5,
  },
});
