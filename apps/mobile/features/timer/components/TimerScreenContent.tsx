import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { TimerActiveSession, TimerSessionSummary } from '@ega/contracts/mobile';
import type { MobileTaskListItem } from '@/types/tasks';
import { mobileTheme } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';

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

function formatStartedAtLabel(startedAt: string): string | null {
  try {
    return new Date(startedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
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
  const startedAtLabel = activeSession ? formatStartedAtLabel(activeSession.startedAt) : null;

  return (
    <View style={styles.stack}>
      {activeSession ? (
        <Card style={styles.activeCard} contentStyle={styles.activeContent} testID="timer-active-card">
          <View style={styles.runningRow}>
            <View style={styles.runningDot} />
            <Text style={styles.runningLabel}>Running</Text>
          </View>

          <Text style={styles.taskTitle} numberOfLines={2} testID="timer-task-title">
            {activeSession.taskTitle}
          </Text>

          <TimerClock startedAt={activeSession.startedAt} fallbackLabel={activeSession.elapsedLabel} />

          {startedAtLabel ? <Text style={styles.startedAt}>Started at {startedAtLabel}</Text> : null}

          <Button
            title="Stop timer"
            variant="danger"
            leftIcon={<Ionicons color={mobileTheme.colors.textOnAccent} name="stop" size={22} />}
            onPress={onStop}
            disabled={isStopping}
            loading={isStopping}
            style={styles.stopButton}
            testID="timer-stop-button"
          />
        </Card>
      ) : (
        <FocusQueue
          tasks={candidateTasks}
          selectedTaskId={selectedTaskId}
          onSelect={onSelectTask}
          onStart={onStart}
          isStarting={isStarting}
        />
      )}

      {summary ? <TrackedTimeSummary summary={summary} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  activeCard: {
    borderColor: mobileTheme.colors.border,
  },
  activeContent: {
    alignItems: 'center',
    paddingVertical: mobileTheme.spacing.xl,
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
  stack: {
    gap: mobileTheme.spacing.md,
  },
  startedAt: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  stopButton: {
    marginTop: mobileTheme.spacing.lg,
    minHeight: 54,
    width: '100%',
  },
  taskTitle: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.bold,
    marginTop: mobileTheme.spacing.sm,
    textAlign: 'center',
  },
});
