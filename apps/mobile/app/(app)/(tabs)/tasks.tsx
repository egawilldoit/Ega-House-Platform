import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

type InlineEditorField = 'status' | 'priority' | 'dueDate';

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
    { label: 'Clear', value: null },
  ];
}

function getStatusOptions(task: MobileTaskListItem) {
  if (task.status === 'blocked') {
    return STATUS_OPTIONS;
  }

  return STATUS_OPTIONS.filter((status) => status !== 'blocked');
}

function ListHeader({ taskCount }: { taskCount: number }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.title}>Tasks</Text>
        <Text style={styles.subtitle}>
          {taskCount > 0
            ? `${taskCount} task${taskCount === 1 ? '' : 's'} synced from your workspace`
            : 'Track and capture your next execution step'}
        </Text>
      </View>
      <Pressable onPress={() => router.push('../tasks/create')} style={styles.createButton}>
        <Text style={styles.createButtonText}>Create</Text>
      </Pressable>
    </View>
  );
}

export default function TasksScreen() {
  const tasksVersion = useTasksVersion();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MobileTaskListItem[]>([]);
  const [activeEditor, setActiveEditor] = useState<{
    taskId: string;
    field: InlineEditorField;
  } | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<Record<string, boolean>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string | undefined>>({});

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

  const toggleEditor = useCallback((taskId: string, field: InlineEditorField) => {
    setActiveEditor((current) => {
      if (current && current.taskId === taskId && current.field === field) {
        return null;
      }

      return { taskId, field };
    });
  }, []);

  const mutateTask = useCallback(async (taskId: string, input: UpdateTaskInput) => {
    setUpdatingTaskIds((current) => ({ ...current, [taskId]: true }));
    setTaskErrors((current) => ({ ...current, [taskId]: undefined }));

    try {
      const response = await updateMobileTask(taskId, input);
      setTasks((current) => current.map((task) => (task.id === taskId ? response.task : task)));
      setActiveEditor((current) => (current?.taskId === taskId ? null : current));
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

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.subtitle}>Loading tasks...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.screen}>
        <ListHeader taskCount={tasks.length} />
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
      </View>
    );
  }

  if (tasks.length === 0) {
    return (
      <View style={styles.screen}>
        <ListHeader taskCount={0} />
        <View style={styles.centeredContent}>
          <Text style={styles.subtitle}>No tasks found for your current workspace.</Text>
          <Pressable onPress={onRefresh} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Refresh</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const dueDateOptions = buildDueDateOptions();

  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={tasks}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<ListHeader taskCount={tasks.length} />}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      renderItem={({ item }) => {
        const isUpdating = Boolean(updatingTaskIds[item.id]);
        const itemError = taskErrors[item.id];
        const showStatusEditor =
          activeEditor?.taskId === item.id && activeEditor?.field === 'status';
        const showPriorityEditor =
          activeEditor?.taskId === item.id && activeEditor?.field === 'priority';
        const showDueDateEditor =
          activeEditor?.taskId === item.id && activeEditor?.field === 'dueDate';

        return (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>
              {item.project.name}
              {item.goal ? ` · ${item.goal.title}` : ''}
            </Text>
            <Text style={styles.cardMeta}>
              {formatToken(item.status)} · {item.priority}
            </Text>
            <Text style={styles.cardMeta}>
              {formatDueDate(item.dueDate)}
              {item.estimateMinutes !== null ? ` · ${item.estimateMinutes}m` : ''}
            </Text>
            {item.status === 'blocked' && item.blockedReason ? (
              <Text style={styles.blockedText}>Blocked: {item.blockedReason}</Text>
            ) : null}

            <View style={styles.quickActionsRow}>
              <Pressable
                disabled={isUpdating}
                onPress={() =>
                  router.push({ pathname: '/(app)/tasks/[id]', params: { id: item.id } })
                }
                style={[styles.quickActionButton, isUpdating && styles.buttonDisabled]}
              >
                <Text style={styles.quickActionText}>Open</Text>
              </Pressable>
              <Pressable
                disabled={isUpdating}
                onPress={() => toggleEditor(item.id, 'status')}
                style={[styles.quickActionButton, isUpdating && styles.buttonDisabled]}
              >
                <Text style={styles.quickActionText}>Status</Text>
              </Pressable>
              <Pressable
                disabled={isUpdating}
                onPress={() => toggleEditor(item.id, 'priority')}
                style={[styles.quickActionButton, isUpdating && styles.buttonDisabled]}
              >
                <Text style={styles.quickActionText}>Priority</Text>
              </Pressable>
              <Pressable
                disabled={isUpdating}
                onPress={() => toggleEditor(item.id, 'dueDate')}
                style={[styles.quickActionButton, isUpdating && styles.buttonDisabled]}
              >
                <Text style={styles.quickActionText}>Due date</Text>
              </Pressable>
            </View>

            {showStatusEditor ? (
              <View style={styles.inlineOptionsRow}>
                {getStatusOptions(item).map((status) => (
                  <Pressable
                    key={status}
                    disabled={isUpdating}
                    onPress={() => mutateTask(item.id, { status })}
                    style={[styles.optionChip, item.status === status && styles.optionChipSelected]}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        item.status === status && styles.optionChipTextSelected,
                      ]}
                    >
                      {formatToken(status)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {showPriorityEditor ? (
              <View style={styles.inlineOptionsRow}>
                {PRIORITY_OPTIONS.map((priority) => (
                  <Pressable
                    key={priority}
                    disabled={isUpdating}
                    onPress={() => mutateTask(item.id, { priority })}
                    style={[
                      styles.optionChip,
                      item.priority === priority && styles.optionChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        item.priority === priority && styles.optionChipTextSelected,
                      ]}
                    >
                      {priority}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {showDueDateEditor ? (
              <View style={styles.inlineOptionsRow}>
                {dueDateOptions.map((option) => (
                  <Pressable
                    key={option.label}
                    disabled={isUpdating}
                    onPress={() => mutateTask(item.id, { dueDate: option.value })}
                    style={[
                      styles.optionChip,
                      item.dueDate === option.value && styles.optionChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        item.dueDate === option.value && styles.optionChipTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {isUpdating ? <Text style={styles.updatingText}>Saving...</Text> : null}
            {itemError ? <Text style={styles.inlineErrorText}>{itemError}</Text> : null}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  blockedText: {
    color: '#b91c1c',
    marginTop: 6,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  cardMeta: {
    color: '#475569',
    marginTop: 6,
  },
  cardTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
  },
  centered: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
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
  createButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
  },
  createButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: '#dc2626',
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  inlineErrorText: {
    color: '#dc2626',
    marginTop: 10,
  },
  inlineOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  listContent: {
    backgroundColor: '#f8fafc',
    gap: 10,
    padding: 14,
    paddingBottom: 24,
  },
  optionChip: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  optionChipSelected: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  optionChipText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  optionChipTextSelected: {
    color: '#ffffff',
  },
  primaryButton: {
    backgroundColor: '#111827',
    borderRadius: 10,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  quickActionButton: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  quickActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  quickActionText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '700',
  },
  screen: {
    backgroundColor: '#f8fafc',
    flex: 1,
    padding: 14,
  },
  subtitle: {
    color: '#475569',
    fontSize: 16,
    lineHeight: 22,
    marginTop: 8,
    textAlign: 'center',
  },
  title: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '700',
  },
  updatingText: {
    color: '#475569',
    marginTop: 10,
  },
});
