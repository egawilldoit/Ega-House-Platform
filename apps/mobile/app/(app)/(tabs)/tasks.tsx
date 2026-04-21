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

import { listMobileTasks } from '@/lib/api/tasks';
import { useTasksVersion } from '@/lib/tasks/store';
import type { MobileTaskListItem } from '@/types/tasks';

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

function formatTaskToken(value: string) {
  return value.replace(/_/g, ' ');
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
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MobileTaskListItem[]>([]);

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
    }
  }, []);

  useEffect(() => {
    loadTasks().catch(() => {
      // Error state handled in loadTasks.
    });
  }, [loadTasks, tasksVersion]);

  function onRefresh() {
    setIsRefreshing(true);
    loadTasks().catch(() => {
      // Error state handled in loadTasks.
    });
  }

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

  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={tasks}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<ListHeader taskCount={tasks.length} />}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardMeta}>
            {item.project.name}
            {item.goal ? ` · ${item.goal.title}` : ''}
          </Text>
          <Text style={styles.cardMeta}>
            {formatTaskToken(item.status)} · {item.priority}
          </Text>
          <Text style={styles.cardMeta}>
            {formatDueDate(item.dueDate)}
            {item.estimateMinutes !== null ? ` · ${item.estimateMinutes}m` : ''}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
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
  listContent: {
    backgroundColor: '#f8fafc',
    gap: 10,
    padding: 14,
    paddingBottom: 24,
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
  screen: {
    backgroundColor: '#f8fafc',
    flex: 1,
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
});
