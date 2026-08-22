import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, AppState, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlassButton, GlassCard, GlassSegmentedControl } from '@/components/mobile/glass';
import { MobileScreen, MobileScreenHeader } from '@/components/mobile/primitives';
import { mobileTheme } from '@/components/mobile/theme';
import { getMobileTimerState, startMobileTimer, stopMobileTimer } from '@/lib/api/timer';
import { listMobileTasks } from '@/lib/api/tasks';
import type { MobileTaskListItem, TimerWorkspaceState } from '@ega/contracts';
import { TIMER_MODES, type TimerMode } from '@/features/timer/modes';
import { useTimerRuntime } from '@/features/timer/useTimerRuntime';

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

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
  const [, setTick] = useState(0);

  const activeSession = timerState?.activeSession ?? null;

  const {
    mode,
    remainingSeconds,
    isRunning,
    totalSeconds,
    completedFocusSessions,
    completedFocusMinutes,
    changeMode,
    resetTimer,
    toggleTimer,
  } = useTimerRuntime();

  const [pulse] = useState(() => new Animated.Value(0));
  const [entrance] = useState(() => new Animated.Value(0));

  const progress = totalSeconds === 0 ? 0 : 1 - remainingSeconds / totalSeconds;
  const progressPercent = Math.round(progress * 100);

  const entranceStyle = useMemo(
    () => ({
      opacity: entrance,
      transform: [
        {
          translateY: entrance.interpolate({
            inputRange: [0, 1],
            outputRange: [12, 0],
          }),
        },
      ],
    }),
    [entrance],
  );

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.55],
  });

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

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const interval = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        void refreshTimerState();
      }
    });

    return () => subscription.remove();
  }, [refreshTimerState]);

  useEffect(() => {
    if (activeSession && isRunning) {
      resetTimer();
    }
  }, [activeSession, isRunning, resetTimer]);

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  useEffect(() => {
    const timerActive = isRunning || Boolean(activeSession);

    if (!timerActive) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => loop.stop();
  }, [activeSession, isRunning, pulse]);

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
          description={
            activeSession
              ? 'Session running'
              : isRunning
                ? 'Focus session running'
                : 'Ready when you are'
          }
        />

        {errorMessage ? (
          <GlassCard variant="fake" style={styles.errorCard}>
            <View style={styles.errorRow}>
              <Ionicons color={mobileTheme.colors.danger} name="warning-outline" size={18} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          </GlassCard>
        ) : null}

        <Animated.View style={[styles.animatedSection, entranceStyle]}>
          <GlassCard variant="fake" style={styles.activeCard}>
            {activeSession ? (
              <>
                <Text style={styles.activeTaskTitle}>{activeSession.taskTitle}</Text>
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
                <Text style={styles.idleTitle}>No tracked session</Text>
                <Text style={styles.idleHint}>
                  {isLoading ? 'Loading tasks…' : 'Choose a task below to track it.'}
                </Text>
              </>
            )}
          </GlassCard>
        </Animated.View>

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

        <Animated.View style={[styles.animatedSection, entranceStyle]}>
          <GlassSegmentedControl
            disabled={isRunning || Boolean(activeSession)}
            onChange={changeMode}
            options={(Object.keys(TIMER_MODES) as TimerMode[]).map((item) => ({
              label: TIMER_MODES[item].label,
              value: item,
            }))}
            value={mode}
          />
        </Animated.View>

        <Animated.View style={[styles.animatedSection, entranceStyle]}>
          <GlassCard variant="fake" style={styles.timerCard} contentStyle={styles.timerCardContent}>
            <View style={styles.clockContainer}>
              <View style={styles.clockRing}>
                <Animated.View
                  style={[
                    styles.pulseRing,
                    {
                      opacity: pulseOpacity,
                      transform: [{ scale: pulseScale }],
                    },
                  ]}
                />
                <View style={styles.progressRing}>
                  <Text style={styles.progressText}>{progressPercent}%</Text>
                </View>
                <View style={styles.clockFace}>
                  <Text style={styles.timeDisplay}>{formatTime(remainingSeconds)}</Text>
                  <View style={styles.modeLabelRow}>
                    <Ionicons
                      color={mobileTheme.colors.accent}
                      name={TIMER_MODES[mode].icon}
                      size={14}
                    />
                    <Text style={styles.timeLabel}>{TIMER_MODES[mode].label}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.timerActions}>
              <GlassButton
                disabled={Boolean(activeSession)}
                leftIcon={
                  <Ionicons
                    color={mobileTheme.colors.textOnAccent}
                    name={isRunning ? 'pause' : 'play'}
                    size={22}
                  />
                }
                onPress={toggleTimer}
                style={styles.primaryTimerButton}
                title={
                  isRunning
                    ? 'Pause'
                    : remainingSeconds > 0 && remainingSeconds < totalSeconds
                      ? 'Resume'
                      : 'Start'
                }
                variant="primary"
              />

              <GlassButton
                disabled={Boolean(activeSession)}
                leftIcon={<Ionicons color={mobileTheme.colors.text} name="refresh" size={18} />}
                onPress={resetTimer}
                style={styles.secondaryTimerButton}
                title="Reset"
                variant="secondary"
              />
            </View>
          </GlassCard>
        </Animated.View>

        <Animated.View style={[styles.animatedSection, entranceStyle]}>
          <GlassCard variant="fake" style={styles.statsCard}>
            <View style={styles.cardTitleRow}>
              <Ionicons color={mobileTheme.colors.accent} name="timer-outline" size={18} />
              <Text style={styles.statsTitle}>Current app session</Text>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{completedFocusSessions}</Text>
                <Text style={styles.statLabel}>Sessions</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{completedFocusMinutes}m</Text>
                <Text style={styles.statLabel}>Focused</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{TIMER_MODES[mode].minutes}m</Text>
                <Text style={styles.statLabel}>{TIMER_MODES[mode].label}</Text>
              </View>
            </View>
          </GlassCard>
        </Animated.View>

        <GlassCard variant="fake" style={styles.guidanceCard} contentStyle={styles.guidanceContent}>
          <Ionicons color={mobileTheme.colors.info} name="checkmark-circle-outline" size={18} />
          <Text style={styles.guidanceText}>
            Start a task session to save tracked time to your account, or run a local focus timer
            below.
          </Text>
        </GlassCard>
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
  animatedSection: {
    width: '100%',
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  clockContainer: {
    alignItems: 'center',
  },
  clockFace: {
    alignItems: 'center',
    backgroundColor: mobileTheme.glass.surfaceStrong,
    borderColor: mobileTheme.glass.border,
    borderWidth: 1,
    borderRadius: 88,
    height: 176,
    justifyContent: 'center',
    width: 176,
    ...mobileTheme.shadow.fab,
  },
  clockRing: {
    alignItems: 'center',
    height: 236,
    justifyContent: 'center',
    position: 'relative',
    width: 236,
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
  guidanceCard: {
    borderColor: mobileTheme.colors.infoMid,
  },
  guidanceContent: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 9,
  },
  guidanceText: {
    color: mobileTheme.colors.info,
    flex: 1,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    lineHeight: 19,
  },
  idleHint: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: mobileTheme.spacing.xs,
    textAlign: 'center',
  },
  idleTitle: {
    color: mobileTheme.colors.text,
    fontSize: 18,
    fontWeight: mobileTheme.font.extrabold,
  },
  modeLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  primaryTimerButton: {
    flex: 1,
    minHeight: 54,
    ...mobileTheme.shadow.fab,
  },
  progressRing: {
    alignItems: 'center',
    borderColor: mobileTheme.colors.accentSoft,
    borderRadius: 112,
    borderWidth: 10,
    height: 224,
    justifyContent: 'center',
    position: 'absolute',
    width: 224,
  },
  progressText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    position: 'absolute',
    top: 18,
  },
  pulseRing: {
    backgroundColor: mobileTheme.colors.accentSoft,
    borderRadius: 118,
    height: 236,
    position: 'absolute',
    width: 236,
  },
  secondaryTimerButton: {
    minHeight: 54,
    paddingHorizontal: 18,
  },
  statBlock: {
    alignItems: 'center',
    flex: 1,
    minWidth: 76,
  },
  statLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    marginTop: 3,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  statValue: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.5,
  },
  statsCard: {
    marginTop: mobileTheme.spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
  statsTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
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
  timeDisplay: {
    color: mobileTheme.colors.text,
    fontSize: 52,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -1,
  },
  timeLabel: {
    color: mobileTheme.colors.accent,
    fontSize: 11,
    fontWeight: mobileTheme.font.extrabold,
    textTransform: 'uppercase',
  },
  timerActions: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.xl,
    width: '100%',
  },
  timerCard: {
    borderColor: mobileTheme.glass.border,
  },
  timerCardContent: {
    alignItems: 'center',
    paddingVertical: mobileTheme.spacing.xl,
  },
});
