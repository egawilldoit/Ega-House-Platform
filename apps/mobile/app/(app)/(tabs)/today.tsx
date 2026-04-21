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

  return date.toLocaleDateString();
}

function formatStatus(value: MobileTaskStatus) {
  return value.replace(/_/g, ' ');
}

function formatMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}

function nextPriority(priority: MobileTaskPriority): MobileTaskPriority {
  const index = PRIORITY_ORDER.indexOf(priority);
  if (index < 0 || index === PRIORITY_ORDER.length - 1) {
    return PRIORITY_ORDER[0];
  }

  return PRIORITY_ORDER[index + 1];
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

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.subtitle}>Loading Today...</Text>
      </View>
    );
  }

  if (error && !today) {
    return (
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
    );
  }

  const todayCount = getTodayTaskCount(today);

  return (
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
          <View style={styles.headerCard}>
            <Text style={styles.title}>Today</Text>
            <Text style={styles.headerMeta}>
              {formatDueDate(today.date)} · {today.summary.trackedTodayLabel} tracked
            </Text>
            <Text style={styles.headerMeta}>
              {today.summary.plannedCount} planned · {today.summary.inProgressCount} in progress ·{' '}
              {today.summary.blockedCount} blocked · {today.summary.completedCount} completed
            </Text>
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
                style={[styles.secondaryButton, isClearingCompleted ? styles.buttonDisabled : null]}
              >
                <Text style={styles.secondaryButtonText}>
                  {isClearingCompleted ? 'Clearing...' : 'Clear completed from Today'}
                </Text>
              </Pressable>
            ) : null}
            {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
          </View>
        ) : null
      }
      ListFooterComponent={
        today ? (
          <View style={styles.suggestionsCard}>
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
                          style={[styles.quickActionButton, isMutating ? styles.buttonDisabled : null]}
                        >
                          <Text style={styles.quickActionText}>{isMutating ? 'Adding...' : 'Add'}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null,
            )}
          </View>
        ) : null
      }
      renderSectionFooter={({ section }) =>
        section.data.length === 0 ? <Text style={styles.sectionEmpty}>{section.emptyText}</Text> : null
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.sectionCount}>{section.data.length}</Text>
        </View>
      )}
      renderItem={({ item }) => {
        const isMutating = activeTaskId === item.id;
        const priorityValue = nextPriority(item.priority);
        const statusActions = getStatusActions(item);

        return (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>
              {item.projectName}
              {item.goalTitle ? ` · ${item.goalTitle}` : ''}
            </Text>
            <Text style={styles.cardMeta}>
              {formatStatus(item.status)} · {item.priority}
              {item.isDueToday ? ' · due today' : ''}
            </Text>
            <Text style={styles.cardMeta}>{formatDueDate(item.dueDate)}</Text>

            {item.status === 'blocked' && item.blockedReason ? (
              <Text style={styles.blockedText}>Blocked: {item.blockedReason}</Text>
            ) : null}

            <View style={styles.actionsRow}>
              {statusActions.map((action) => (
                <Pressable
                  key={action.label}
                  disabled={isMutating}
                  onPress={() => {
                    runStatusAction(item, action.status).catch(() => {
                      // handled in runStatusAction state
                    });
                  }}
                  style={[styles.quickActionButton, isMutating ? styles.buttonDisabled : null]}
                >
                  <Text style={styles.quickActionText}>{action.label}</Text>
                </Pressable>
              ))}
              <Pressable
                disabled={isMutating}
                onPress={() => {
                  runInlineUpdate(item, { priority: priorityValue }).catch(() => {
                    // handled in runInlineUpdate state
                  });
                }}
                style={[styles.quickActionButton, isMutating ? styles.buttonDisabled : null]}
              >
                <Text style={styles.quickActionText}>Priority: {priorityValue}</Text>
              </Pressable>
              <Pressable
                disabled={isMutating || item.dueDate === todayIso}
                onPress={() => {
                  runInlineUpdate(item, { dueDate: todayIso }).catch(() => {
                    // handled in runInlineUpdate state
                  });
                }}
                style={[
                  styles.quickActionButton,
                  isMutating || item.dueDate === todayIso ? styles.buttonDisabled : null,
                ]}
              >
                <Text style={styles.quickActionText}>Due today</Text>
              </Pressable>
              <Pressable
                disabled={isMutating || item.dueDate === tomorrowIso}
                onPress={() => {
                  runInlineUpdate(item, { dueDate: tomorrowIso }).catch(() => {
                    // handled in runInlineUpdate state
                  });
                }}
                style={[
                  styles.quickActionButton,
                  isMutating || item.dueDate === tomorrowIso ? styles.buttonDisabled : null,
                ]}
              >
                <Text style={styles.quickActionText}>Due tomorrow</Text>
              </Pressable>
              <Pressable
                disabled={isMutating || item.dueDate === null}
                onPress={() => {
                  runInlineUpdate(item, { dueDate: null }).catch(() => {
                    // handled in runInlineUpdate state
                  });
                }}
                style={[
                  styles.quickActionButton,
                  isMutating || item.dueDate === null ? styles.buttonDisabled : null,
                ]}
              >
                <Text style={styles.quickActionText}>Clear due</Text>
              </Pressable>
              {item.isPlannedForToday ? (
                <Pressable
                  disabled={isMutating}
                  onPress={() => {
                    runRemoveFromToday(item).catch(() => {
                      // handled in runRemoveFromToday state
                    });
                  }}
                  style={[styles.quickActionButton, isMutating ? styles.buttonDisabled : null]}
                >
                  <Text style={styles.quickActionText}>Remove</Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={isMutating}
                onPress={() => {
                  router.push({
                    pathname: '/(app)/tasks/[id]',
                    params: { id: item.id },
                  });
                }}
                style={[styles.quickActionButton, isMutating ? styles.buttonDisabled : null]}
              >
                <Text style={styles.quickActionText}>Open</Text>
              </Pressable>
            </View>
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
  button: {
    backgroundColor: '#111827',
    borderRadius: 10,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.45,
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
    marginBottom: 10,
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
  emptyText: {
    color: '#334155',
    marginTop: 10,
  },
  errorText: {
    color: '#dc2626',
    marginTop: 10,
  },
  headerCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  headerMeta: {
    color: '#475569',
    marginTop: 6,
  },
  listContent: {
    backgroundColor: '#f8fafc',
    padding: 14,
    paddingBottom: 24,
  },
  quickActionButton: {
    backgroundColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  quickActionText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  sectionCount: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionEmpty: {
    color: '#64748b',
    fontSize: 13,
    marginBottom: 10,
    marginTop: 4,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 6,
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: '#475569',
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  suggestionsCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    padding: 14,
  },
  suggestionCopy: {
    flex: 1,
    marginRight: 12,
  },
  suggestionGroup: {
    marginTop: 10,
  },
  suggestionGroupTitle: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  suggestionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  suggestionsTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
  },
  suggestionTaskMeta: {
    color: '#64748b',
    marginTop: 2,
  },
  suggestionTaskTitle: {
    color: '#0f172a',
    fontWeight: '600',
  },
  title: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '700',
  },
});
