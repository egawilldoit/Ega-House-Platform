import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { TimerActiveSession, TimerSessionSummary } from '@ega/contracts/mobile';
import type { MobileTaskListItem } from '@/types/tasks';
import { mobileTheme } from '@/components/mobile/theme';
import { useReducedMotion } from '@/components/mobile/motion/ReducedMotion';
import { Button } from '@/components/mobile/ui/Button';

import { FocusQueue } from './FocusQueue';
import { TimerClock } from './TimerClock';
import { TrackedTimeSummary } from './TrackedTimeSummary';

export type TimerScreenContentProps = {
  activeSession: TimerActiveSession | null;
  candidateTasks: MobileTaskListItem[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onStart: () => void;
  onStop: () => void;
  isStarting: boolean;
  isStopping: boolean;
  summary: TimerSessionSummary | null;
};

function FadeScaleBranch({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(reducedMotion ? 0 : 8);
  const scale = useSharedValue(reducedMotion ? 1 : 0.96);

  useEffect(() => {
    const dur = reducedMotion ? 0 : 200;
    opacity.value = withTiming(1, { duration: dur });
    if (!reducedMotion) {
      translateY.value = withTiming(0, { duration: dur });
      scale.value = withTiming(1, { duration: dur });
    }
  }, [opacity, translateY, scale, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

export function TimerScreenContent({
  activeSession,
  candidateTasks,
  selectedTaskId,
  onSelectTask,
  onStart,
  onStop,
  isStarting,
  isStopping,
  summary,
}: TimerScreenContentProps) {
  const activeProjectName = useMemo(() => {
    if (!activeSession) return null;
    const match = candidateTasks.find((task) => task.id === activeSession.taskId);
    return match?.project.name ?? null;
  }, [activeSession, candidateTasks]);

  return (
    <View style={styles.stack}>
      {activeSession ? (
        <FadeScaleBranch key="running">
          <View style={styles.runningHero} testID="timer-active-card">
            <Text style={styles.focusEyebrow}>FOCUS</Text>

            <Text style={styles.taskTitle} numberOfLines={2} testID="timer-task-title">
              {activeSession.taskTitle}
            </Text>

            {activeProjectName ? (
              <Text style={styles.projectName} numberOfLines={1}>
                {activeProjectName}
              </Text>
            ) : null}

            <TimerClock startedAt={activeSession.startedAt} fallbackLabel={activeSession.elapsedLabel} />

            <View style={styles.runningRow}>
              <View style={styles.runningDot} />
              <Text style={styles.runningLabel}>RUNNING</Text>
            </View>

            <Button
              title="Stop session"
              variant="danger"
              leftIcon={<Ionicons color={mobileTheme.colors.textOnAccent} name="stop" size={22} />}
              onPress={onStop}
              disabled={isStopping}
              loading={isStopping}
              style={styles.stopButton}
              testID="timer-stop-button"
            />
          </View>
        </FadeScaleBranch>
      ) : (
        <FadeScaleBranch key="idle">
          <FocusQueue
            tasks={candidateTasks}
            selectedTaskId={selectedTaskId}
            onSelect={onSelectTask}
            onStart={onStart}
            isStarting={isStarting}
          />
        </FadeScaleBranch>
      )}

      {summary ? <TrackedTimeSummary summary={summary} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  focusEyebrow: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  projectName: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    letterSpacing: 0.3,
    marginTop: 2,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  runningDot: {
    backgroundColor: mobileTheme.colors.successMid,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  runningHero: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.primaryContainer,
    borderRadius: mobileTheme.radius.hero,
    gap: 8,
    overflow: 'hidden',
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingVertical: 28,
  },
  runningLabel: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  runningRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  stack: {
    gap: mobileTheme.spacing.md,
  },
  stopButton: {
    marginTop: mobileTheme.spacing.md,
    minHeight: 54,
    width: '100%',
  },
  taskTitle: {
    color: mobileTheme.colors.text,
    fontSize: 20,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
});
