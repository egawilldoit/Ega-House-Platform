import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GlassButton, GlassCard } from '@/components/mobile/glass';
import {
  EmptyState,
  MobileScreen,
  MobileScreenHeader,
  SkeletonCard,
} from '@/components/mobile/primitives';
import { mobileTheme } from '@/components/mobile/theme';
import { useTaskListQuery } from '@/features/tasks/query';
import {
  useStartTimerMutation,
  useStopTimerMutation,
  useTimerWorkspaceQuery,
} from '@/features/timer/query';
import { formatElapsedClock, projectElapsedSeconds } from '@/features/timer/runtime';

const MAX_PICKER_TASKS = 12;

function formatMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}

export default function TimerScreen() {
  const workspaceQuery = useTimerWorkspaceQuery();
  const startMutation = useStartTimerMutation();
  const stopMutation = useStopTimerMutation();
  const tasksQuery = useTaskListQuery({ limit: 50 });

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const workspace = workspaceQuery.data ?? null;
  const activeSession = workspace?.activeSession ?? null;

  const candidateTasks = useMemo(
    () =>
      (tasksQuery.data?.tasks ?? [])
        .filter((task) => task.status !== 'done')
        .slice(0, MAX_PICKER_TASKS),
    [tasksQuery.data],
  );

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const immediate = setTimeout(() => setNowMs(Date.now()), 0);
    const interval = setInterval(() => setNowMs(Date.now()), 1000);

    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [activeSession]);

  const projectedSeconds = activeSession
    ? projectElapsedSeconds(activeSession.startedAt, nowMs)
    : null;
  const elapsedLabel = activeSession
    ? projectedSeconds === null
      ? activeSession.elapsedLabel
      : formatElapsedClock(projectedSeconds)
    : formatElapsedClock(0);
  const startedAtLabel = activeSession
    ? new Date(activeSession.startedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  async function handleStart() {
    if (!selectedTaskId || activeSession) {
      return;
    }

    setActionError(null);

    try {
      await startMutation.mutateAsync(selectedTaskId);
    } catch (error) {
      setActionError(formatMessage(error, 'Unable to start the timer.'));
    }
  }

  async function handleStop() {
    if (!activeSession) {
      return;
    }

    setActionError(null);

    try {
      await stopMutation.mutateAsync(activeSession.sessionId);
    } catch (error) {
      setActionError(formatMessage(error, 'Unable to stop the timer.'));
    }
  }

  const summary = workspace?.summary ?? null;

  if (workspaceQuery.isPending && !workspace) {
    return (
      <MobileScreen>
        <MobileScreenHeader description="Loading your timer..." eyebrow="Focus" title="Timer" />
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </MobileScreen>
    );
  }

  if (workspaceQuery.isError && !workspace) {
    const loadError =
      workspaceQuery.error instanceof Error
        ? workspaceQuery.error.message
        : 'Unable to load the timer right now.';

    return (
      <MobileScreen>
        <MobileScreenHeader
          description="Server unavailable"
          eyebrow="Focus"
          title="Timer"
        />
        <GlassCard variant="fake" style={styles.offlineCard} contentStyle={styles.offlineContent}>
          <Ionicons color={mobileTheme.colors.danger} name="cloud-offline-outline" size={20} />
          <Text style={styles.offlineText}>{loadError}</Text>
          <Text style={styles.offlineHint}>
            Nothing is running locally. The timer only runs on the server, so reconnect and retry.
          </Text>
          <GlassButton
            onPress={() => {
              workspaceQuery.refetch().catch(() => {
                // handled by query error state
              });
            }}
            title="Retry"
            variant="secondary"
          />
        </GlassCard>
      </MobileScreen>
    );
  }

  const showStaleBanner = workspaceQuery.isError && !workspaceQuery.isFetching;

  return (
    <MobileScreen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={workspaceQuery.isRefetching}
            onRefresh={() => {
              workspaceQuery.refetch().catch(() => {
                // handled by query error state
              });
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <MobileScreenHeader
          description={
            activeSession ? 'Session running' : showStaleBanner ? 'Offline' : 'Ready when you are'
          }
          eyebrow="Focus"
          title="Timer"
        />

        {showStaleBanner ? (
          <View style={styles.staleBanner}>
            <Ionicons color={mobileTheme.colors.textMuted} name="cloud-offline-outline" size={14} />
            <Text style={styles.staleBannerText}>
              Can&apos;t reach the server — showing the last synced state.
            </Text>
          </View>
        ) : null}

        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

        {activeSession ? (
          <GlassCard variant="fake" style={styles.activeCard} contentStyle={styles.activeContent}>
            <View style={styles.runningRow}>
              <View style={styles.runningDot} />
              <Text style={styles.runningLabel}>Running</Text>
            </View>
            <Text style={styles.taskTitle} numberOfLines={2}>
              {activeSession.taskTitle}
            </Text>
            <Text style={styles.clock}>{elapsedLabel}</Text>
            {startedAtLabel ? (
              <Text style={styles.startedAt}>Started at {startedAtLabel}</Text>
            ) : null}
            <GlassButton
              disabled={stopMutation.isPending}
              leftIcon={
                <Ionicons color={mobileTheme.colors.textOnAccent} name="stop" size={22} />
              }
              loading={stopMutation.isPending}
              onPress={() => {
                handleStop().catch(() => {
                  // handled in handleStop state
                });
              }}
              style={styles.stopButton}
              title="Stop timer"
              variant="danger"
            />
          </GlassCard>
        ) : (
          <GlassCard variant="fake" style={styles.pickCard} contentStyle={styles.pickContent}>
            {candidateTasks.length === 0 ? (
              <EmptyState
                icon="list-outline"
                title="No open tasks"
                description="Add a task first, then start timing it here."
              />
            ) : (
              <>
                <Text style={styles.pickTitle}>Pick a task to time</Text>
                {candidateTasks.map((task) => {
                  const isSelected = task.id === selectedTaskId;

                  return (
                    <Pressable
                      accessibilityRole="button"
                      key={task.id}
                      onPress={() => setSelectedTaskId(task.id)}
                      style={[styles.taskRow, isSelected ? styles.taskRowSelected : null]}
                    >
                      <View style={styles.taskRowCopy}>
                        <Text style={styles.taskRowTitle} numberOfLines={1}>
                          {task.title}
                        </Text>
                        <Text style={styles.taskRowMeta}>
                          {task.project.name} · {task.status.replace('_', ' ')}
                        </Text>
                      </View>
                      {isSelected ? (
                        <Ionicons
                          color={mobileTheme.colors.accent}
                          name="checkmark-circle"
                          size={20}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
                <GlassButton
                  disabled={!selectedTaskId || startMutation.isPending}
                  leftIcon={
                    <Ionicons color={mobileTheme.colors.textOnAccent} name="play" size={20} />
                  }
                  loading={startMutation.isPending}
                  onPress={() => {
                    handleStart().catch(() => {
                      // handled in handleStart state
                    });
                  }}
                  style={styles.startButton}
                  title="Start timer"
                />
              </>
            )}
          </GlassCard>
        )}

        {summary ? (
          <GlassCard variant="fake" style={styles.summaryCard}>
            <View style={styles.summaryTitleRow}>
              <Ionicons color={mobileTheme.colors.accent} name="timer-outline" size={18} />
              <Text style={styles.summaryTitle}>Tracked time</Text>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{summary.trackedTodayLabel}</Text>
                <Text style={styles.statLabel}>Today</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{summary.sessionsTodayCount}</Text>
                <Text style={styles.statLabel}>Sessions</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{summary.longestSessionLabel ?? '—'}</Text>
                <Text style={styles.statLabel}>Longest</Text>
              </View>
            </View>
            <Text style={styles.totalMeta}>All time · {summary.trackedTotalLabel}</Text>
          </GlassCard>
        ) : null}

        {tasksQuery.isFetching && !tasksQuery.data ? (
          <ActivityIndicator color={mobileTheme.colors.accent} style={styles.tasksLoading} />
        ) : null}
      </ScrollView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  activeCard: {
    borderColor: mobileTheme.glass.border,
  },
  activeContent: {
    alignItems: 'center',
    paddingVertical: mobileTheme.spacing.xl,
  },
  clock: {
    color: mobileTheme.colors.text,
    fontSize: 52,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -1,
    marginTop: mobileTheme.spacing.sm,
  },
  content: {
    gap: mobileTheme.spacing.md,
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    textAlign: 'center',
  },
  offlineCard: {
    borderColor: mobileTheme.colors.danger,
  },
  offlineContent: {
    alignItems: 'flex-start',
    gap: mobileTheme.spacing.sm,
  },
  offlineHint: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  offlineText: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.semibold,
  },
  pickCard: {
    borderColor: mobileTheme.glass.border,
  },
  pickContent: {
    gap: mobileTheme.spacing.sm,
  },
  pickTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
  },
  runningDot: {
    backgroundColor: mobileTheme.colors.successMid,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  runningLabel: {
    color: mobileTheme.colors.successMid,
    fontSize: 12,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  runningRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  skeletonWrap: {
    gap: mobileTheme.spacing.md,
    marginTop: mobileTheme.spacing.lg,
  },
  startButton: {
    minHeight: 52,
    marginTop: mobileTheme.spacing.xs,
    width: '100%',
  },
  startedAt: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
  statBlock: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  statValue: {
    color: mobileTheme.colors.text,
    fontSize: 22,
    fontWeight: mobileTheme.font.black,
  },
  summaryCard: {
    marginTop: mobileTheme.spacing.xs,
  },
  summaryTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
  },
  summaryTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: mobileTheme.spacing.sm,
  },
  staleBanner: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.md,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  staleBannerText: {
    color: mobileTheme.colors.textMuted,
    flex: 1,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  stopButton: {
    minHeight: 54,
    marginTop: mobileTheme.spacing.lg,
    width: '100%',
  },
  taskRow: {
    alignItems: 'center',
    borderColor: mobileTheme.glass.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  taskRowCopy: {
    flex: 1,
    marginRight: 8,
  },
  taskRowMeta: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 2,
  },
  taskRowSelected: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.accentMid,
  },
  taskRowTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
  },
  taskTitle: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.bold,
    marginTop: mobileTheme.spacing.sm,
    textAlign: 'center',
  },
  tasksLoading: {
    marginTop: mobileTheme.spacing.sm,
  },
  totalMeta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: mobileTheme.spacing.sm,
    textAlign: 'center',
  },
});
