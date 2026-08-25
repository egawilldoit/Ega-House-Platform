import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { mobileTheme } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';
import { Button } from '@/components/mobile/ui/Button';
import { ProgressBar } from '@/components/mobile/ui/ProgressBar';
import type { MobileTodaySummary } from '@/types/today';

export type DailyMomentumProps = {
  date: string;
  summary: MobileTodaySummary;
  todayCount: number;
  completedRatio: number;
  isClearing?: boolean;
  onClearCompleted?: () => void;
};

function formatDateLabel(date: string) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    return date;
  }
  return d.toDateString();
}

function ProgressRing({ progress, size = 56 }: { progress: number; size?: number }) {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);
  const isComplete = clamped >= 1 && progress > 0;

  return (
    <View
      accessibilityLabel={`${Math.round(clamped * 100)} percent completed`}
      accessibilityRole="progressbar"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={mobileTheme.colors.backgroundDeep}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={isComplete ? mobileTheme.colors.successMid : mobileTheme.colors.accent}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <Text style={[ringStyles.value, isComplete ? { color: mobileTheme.colors.success } : null]}>
        {Math.round(clamped * 100)}%
      </Text>
    </View>
  );
}

const ringStyles = StyleSheet.create({
  value: {
    color: mobileTheme.colors.text,
    fontSize: 12,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.2,
  },
});

export function DailyMomentum({
  date,
  summary,
  todayCount,
  completedRatio,
  isClearing = false,
  onClearCompleted,
}: DailyMomentumProps) {
  const progress = todayCount > 0 ? summary.completedCount / todayCount : 0;

  return (
    <Card style={styles.card} testID="daily-momentum-card">
      <View style={styles.headerRow}>
        <View style={styles.copy}>
          <Text style={styles.title}>Daily momentum</Text>
          <Text style={styles.meta}>{formatDateLabel(date)}</Text>
        </View>
        <ProgressRing progress={progress} size={58} />
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>{summary.inProgressCount}</Text>
          <Text style={styles.statLabel}>In progress</Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>{summary.completedCount}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>{summary.overdueCount}</Text>
          <Text style={styles.statLabel}>Overdue</Text>
        </View>
      </View>

      <ProgressBar
        value={summary.completedCount}
        max={todayCount > 0 ? todayCount : 100}
        color={mobileTheme.colors.accent}
        trackColor={mobileTheme.colors.backgroundDeep}
        style={styles.progress}
        testID="daily-momentum-progress"
      />
      <Text style={styles.progressCaption} accessibilityLabel={`${completedRatio} percent completed`}>
        {todayCount > 0 ? `${completedRatio}% completed · ${summary.completedCount} of ${todayCount}` : '0% completed'}
      </Text>

      {todayCount === 0 ? (
        <Text style={styles.emptyText}>Nothing in Today yet. Add tasks from suggestions below.</Text>
      ) : null}

      {summary.clearableCompletedCount > 0 && onClearCompleted ? (
        <Button
          title={isClearing ? 'Clearing...' : 'Clear completed'}
          variant="danger"
          size="sm"
          loading={isClearing}
          disabled={isClearing}
          leftIcon={<Ionicons name="trash-outline" size={16} color={mobileTheme.colors.textOnAccent} />}
          onPress={onClearCompleted}
          style={styles.clearButton}
          testID="clear-completed-button"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  clearButton: {
    alignSelf: 'flex-start',
    marginTop: mobileTheme.spacing.md,
  },
  copy: {
    flex: 1,
    paddingRight: mobileTheme.spacing.md,
  },
  emptyText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: mobileTheme.spacing.sm,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  progress: {
    marginTop: mobileTheme.spacing.md,
  },
  progressCaption: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
    letterSpacing: 0.2,
    marginTop: 6,
  },
  statBlock: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.3,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  statValue: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.black,
    letterSpacing: 0,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: mobileTheme.spacing.md,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0,
  },
});
