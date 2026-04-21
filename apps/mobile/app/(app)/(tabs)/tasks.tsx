import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { MobileScreen, MobileScreenHeader, PrimaryFab } from '@/components/mobile/primitives';
import { TaskCard } from '@/components/mobile/TaskCard';
import { mobileTheme } from '@/components/mobile/theme';
import { listMobileTasks, updateMobileTask } from '@/lib/api/tasks';
import { useTasksVersion } from '@/lib/tasks/store';
import type {
  MobileTaskListItem,
  MobileTaskPriority,
  MobileTaskStatus,
  UpdateTaskInput,
} from '@/types/tasks';

const STATUS_OPTIONS: MobileTaskStatus[] = ['todo', 'in_progress', 'done', 'blocked'];
const PRIORITY_OPTIONS: MobileTaskPriority[] = ['low', 'medium', 'high', 'urgent'];

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
  const tasksVersion = useTasksVersion();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MobileTaskListItem[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<Record<string, boolean>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string | undefined>>({});

  const dueDateOptions = useMemo(() => buildDueDateOptions(), []);
  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  );

  const loadTasks = useCallback(async () => {
    try {
      const response = await listMobileTasks();
      setTasks(response.tasks);
      setError(null);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Unable to load tasks right now.';
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setHasLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    loadTasks().catch(() => {
      // Error state handled in loadTasks.
    });
  }, [loadTasks, tasksVersion]);

  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce) {
        return;
      }

      loadTasks().catch(() => {
        // Error state handled in loadTasks.
      });
    }, [hasLoadedOnce, loadTasks]),
  );

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadTasks().catch(() => {
      // Error state handled in loadTasks.
    });
  }, [loadTasks]);

  const mutateTask = useCallback(async (taskId: string, input: UpdateTaskInput) => {
    setUpdatingTaskIds((current) => ({ ...current, [taskId]: true }));
    setTaskErrors((current) => ({ ...current, [taskId]: undefined }));

    try {
      const response = await updateMobileTask(taskId, input);
      setTasks((current) => current.map((task) => (task.id === taskId ? response.task : task)));
    } catch (updateError) {
      const message =
        updateError instanceof Error
          ? updateError.message
          : 'Unable to update task right now.';

      setTaskErrors((current) => ({ ...current, [taskId]: message }));
    } finally {
      setUpdatingTaskIds((current) => ({ ...current, [taskId]: false }));
    }
  }, []);

  const actionSheetItems = useMemo<ActionSheetItem[]>(() => {
    if (!activeTask) {
      return [];
    }

    const statusItems = getStatusOptions(activeTask).map((status) => ({
      key: `status-${status}`,
      label: `Status: ${formatToken(status)}${status === activeTask.status ? ' (Current)' : ''}`,
      disabled: status === activeTask.status,
      onPress: () => {
        mutateTask(activeTask.id, { status }).catch(() => {
          // handled in mutateTask
        });
      },
    }));

    const priorityItems = PRIORITY_OPTIONS.map((priority) => ({
      key: `priority-${priority}`,
      label: `Priority: ${priority}${priority === activeTask.priority ? ' (Current)' : ''}`,
      disabled: priority === activeTask.priority,
      onPress: () => {
        mutateTask(activeTask.id, { priority }).catch(() => {
          // handled in mutateTask
        });
      },
    }));

    const dueItems = dueDateOptions.map((option) => ({
      key: `due-${option.label}`,
      label: option.label,
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
        label: 'Open task details',
        onPress: () => {
          router.push({ pathname: '/(app)/tasks/[id]', params: { id: activeTask.id } });
        },
      },
      ...statusItems,
      ...priorityItems,
      ...dueItems,
    ];
  }, [activeTask, dueDateOptions, mutateTask]);

  if (isLoading) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.subtitle}>Loading tasks...</Text>
        </View>
      </MobileScreen>
    );
  }

  if (error) {
    return (
      <MobileScreen>
        <MobileScreenHeader
          eyebrow="Execution"
          title="Tasks"
          description="Everything synced from your workspace"
        />
        <View style={styles.centeredContent}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => {
              setIsLoading(true);
              loadTasks().catch(() => {
                // handled in loadTasks
              });
            }}
            style={styles.primaryButton}
          >
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
          <View style={styles.emptyState}>
            <Text style={styles.subtitle}>No tasks found for your current workspace.</Text>
            <Pressable onPress={onRefresh} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Refresh</Text>
            </Pressable>
          </View>
        }
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <MobileScreenHeader
              eyebrow="Execution"
              title="Tasks"
              description={
                tasks.length > 0
                  ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} ready for action`
                  : 'Track and capture your next execution step'
              }
            />
          </View>
        }
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
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

      <PrimaryFab label="Create Task" onPress={() => router.push('../tasks/create')} />

      <ActionSheet
        footer={
          activeTask && updatingTaskIds[activeTask.id] ? (
            <Text style={styles.sheetMessage}>Updating task...</Text>
          ) : null
        }
        items={actionSheetItems}
        onClose={() => setActiveTaskId(null)}
        subtitle={activeTask ? `${activeTask.project.name}${activeTask.goal ? ` · ${activeTask.goal.title}` : ''}` : undefined}
        title={activeTask ? activeTask.title : 'Task actions'}
        visible={Boolean(activeTask)}
      />
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    marginBottom: 10,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  centeredContent: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 64,
    paddingHorizontal: 20,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    textAlign: 'center',
  },
  headerWrap: {
    paddingHorizontal: 14,
  },
  inlineErrorText: {
    color: mobileTheme.colors.danger,
    marginTop: 8,
    paddingHorizontal: 6,
  },
  listContent: {
    paddingBottom: 96,
    paddingTop: 14,
  },
  primaryButton: {
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 12,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  sheetMessage: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  subtitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
    textAlign: 'center',
  },
});
