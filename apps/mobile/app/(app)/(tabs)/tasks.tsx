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

import { fetchMobileTasks } from '@/lib/api/tasks';
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

export default function TasksScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MobileTaskListItem[]>([]);

  const loadTasks = useCallback(async () => {
    try {
      const response = await fetchMobileTasks();
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
      // error state handled in loadTasks.
    });
  }, [loadTasks]);

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
      <View style={styles.centered}>
        <Text style={styles.title}>Tasks</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => {
          setIsLoading(true);
          loadTasks().catch(() => {
            // handled in loadTasks
          });
        }} style={styles.button}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (tasks.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Tasks</Text>
        <Text style={styles.subtitle}>No tasks found for your current workspace.</Text>
        <Pressable onPress={() => {
          setIsRefreshing(true);
          loadTasks().catch(() => {
            // handled in loadTasks
          });
        }} style={styles.button}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={tasks}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => {
            setIsRefreshing(true);
            loadTasks().catch(() => {
              // handled in loadTasks
            });
          }}
        />
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardMeta}>
            {item.project.name}
            {item.goal ? ` · ${item.goal.title}` : ''}
          </Text>
          <Text style={styles.cardMeta}>
            {item.status.replace('_', ' ')} · {item.priority}
          </Text>
          <Text style={styles.cardMeta}>
            {formatDueDate(item.dueDate)}
            {item.estimateMinutes ? ` · ${item.estimateMinutes}m` : ''}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#111827',
    borderRadius: 10,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
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
  errorText: {
    color: '#dc2626',
    marginTop: 10,
    textAlign: 'center',
  },
  listContent: {
    backgroundColor: '#f8fafc',
    gap: 10,
    padding: 14,
    paddingBottom: 24,
  },
  subtitle: {
    color: '#475569',
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  title: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '700',
  },
});
