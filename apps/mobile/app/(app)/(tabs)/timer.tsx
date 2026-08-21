import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlassButton, GlassCard } from '@/components/mobile/glass';
import { MobileScreen, MobileScreenHeader } from '@/components/mobile/primitives';
import { mobileTheme } from '@/components/mobile/theme';
import { getMobileTimerState, startMobileTimer, stopMobileTimer } from '@/lib/api/timer';
import { listMobileTasks } from '@/lib/api/tasks';
import type { TimerWorkspaceState } from '@ega/contracts';
import type { MobileTaskListItem } from '@ega/contracts';

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');

  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`;
}

function elapsedSecondsSince(startedAt: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
}

export default function TimerScreen() {
  const [tasks, setTasks] = useState<MobileTaskListItem[]>([]);
  const [timerState, setTimerState] = useState<TimerWorkspaceState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const activeSession = timerState?.activeSession ?? null;

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const interval = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  const refreshTimerState = useCallback(async () => {
    try {
      const response = await getMobileTimerState();
      setTimerState(response.timer);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load the timer.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      setIsLoading(true);
      const [tasksResult] = await Promise.allSettled([
        listMobileTasks({ limit: 50 }),
        refreshTimerState(),
      ]);

      if (cancelled) {
        return;
      }

      if (tasksResult.status === 'fulfilled') {
        setTasks(tasksResult.value.tasks);
      }
      setIsLoading(false);
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [refreshTimerState]);

  async function handleStart(taskId: string) {
    setIsMutating(true);
    try {
      const response = await startMobileTimer({ taskId });
      setTimerState(response.timer);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to start the timer.');
    } finally {
      setIsMutating(false);
    }
  }

  async function handleStop() {
    if (!activeSession) {
      return;
    }

    setIsMutating(true);
    try {
      const response = await stopMobileTimer({ sessionId: activeSession.sessionId });
      setTimerState(response.timer);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to stop the timer.');
    } finally {
      setIsMutating(false);
    }
  }

  const elapsedLabel = activeSession
    ? formatElapsed(elapsedSecondsSince(activeSession.startedAt))
    : formatElapsed(0);

  return (
    <MobileScreen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MobileScreenHeader
          eyebrow="Focus"
          title="Timer"
          description={activeSession ? 'Session running' : 'Pick a task to track'}
        />

        {errorMessage ? (
          <GlassCard variant="fake" style={styles.errorCard}>
            <View style={styles.errorRow}>
              <Ionicons color={mobileTheme.colors.danger} name="warning-outline" size={18} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          </GlassCard>
        ) : null}

        <GlassCard variant="fake" style={styles.activeCard}>
          {activeSession ? (
            <>
              <Text style={styles.activeTaskTitle}>{activeSession.taskTitle}</Text>
              {/* `tick` re-renders this component every second while a session runs. */}
              <Text style={styles.elapsedDisplay}>{elapsedLabel}</Text>
              <GlassButton
                disabled={isMutating}
                loading={isMutating}
                onPress={handleStop}
                style={styles.actionButton}
                title="Stop"
                variant="danger"
              />
            </>
          ) : (
            <>
              <Text style={styles.idleTitle}>No active session</Text>
              <Text style={styles.idleHint}>
                {isLoading ? 'Loading tasks…' : 'Choose a task below to start tracking.'}
              </Text>
            </>
          )}
        </GlassCard>

        {!activeSession && !isLoading ? (
          <View style={styles.taskList}>
            {tasks.length === 0 ? (
              <Text style={styles.emptyText}>No active tasks available.</Text>
            ) : (
              tasks.map((task) => (
                <GlassCard key={task.id} variant="fake" style={styles.taskRow}>
                  <View style={styles.taskInfo}>
                    <Text style={styles.taskTitle} numberOfLines={1}>
                      {task.title}
                    </Text>
                    <Text style={styles.taskProject}>{task.project.name}</Text>
                  </View>
                  <GlassButton
                    disabled={isMutating}
                    onPress={() => void handleStart(task.id)}
                    size="sm"
                    title="Start"
                  />
                </GlassCard>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    minHeight: 54,
    marginTop: mobileTheme.spacing.lg,
    width: '100%',
  },
  activeCard: {
    alignItems: 'center',
    borderColor: mobileTheme.glass.border,
    paddingVertical: mobileTheme.spacing.xl,
  },
  activeTaskTitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
    textAlign: 'center',
  },
  content: {
    gap: mobileTheme.spacing.md,
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  elapsedDisplay: {
    color: mobileTheme.colors.text,
    fontSize: 56,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -1,
    marginTop: mobileTheme.spacing.sm,
  },
  emptyText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorCard: {
    borderColor: mobileTheme.colors.danger,
  },
  errorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    flex: 1,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
  },
  idleHint: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: mobileTheme.spacing.xs,
  },
  idleTitle: {
    color: mobileTheme.colors.text,
    fontSize: 18,
    fontWeight: mobileTheme.font.extrabold,
  },
  taskInfo: {
    flex: 1,
    marginRight: mobileTheme.spacing.sm,
  },
  taskList: {
    gap: mobileTheme.spacing.sm,
  },
  taskProject: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  taskRow: {
    alignItems: 'center',
    flexDirection: 'row',
    padding: mobileTheme.spacing.md,
  },
  taskTitle: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.bold,
  },
});
