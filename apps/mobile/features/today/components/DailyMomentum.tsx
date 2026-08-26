import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

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

export function DailyMomentum({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- date kept for API compat, not rendered (hero uses trackedTodayLabel)
  date: _date,
  summary,
  todayCount,
  completedRatio,
  isClearing = false,
  onClearCompleted,
}: DailyMomentumProps) {
  const progress = todayCount > 0 ? summary.completedCount / todayCount : 0;
  const isComplete = progress >= 1 && todayCount > 0;

  return (
    <Card style={styles.card} contentStyle={styles.cardContent} testID="daily-momentum-card">
      <View style={styles.heroRow}>
        <View style={styles.heroCopy}>
          <Text style={styles.heroNumber} accessibilityRole="header">
            {summary.trackedTodayLabel}
          </Text>
          <Text style={styles.heroLabel}>tracked today</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Planned {summary.plannedCount}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>Doing {summary.inProgressCount}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>Blocked {summary.blockedCount}</Text>
      </View>

      <View style={styles.completionWrap}>
        <Text
          style={styles.completionText}
          accessibilityLabel={
            todayCount > 0
              ? `${summary.completedCount} of ${todayCount} completed, ${completedRatio} percent`
              : '0 of 0 completed'
          }
        >
          {todayCount > 0 ? `${summary.completedCount} of ${todayCount} completed` : '0 of 0 completed'}
        </Text>
        <ProgressBar
          value={summary.completedCount}
          max={todayCount > 0 ? todayCount : 1}
          color={isComplete ? mobileTheme.colors.success : mobileTheme.colors.accent}
          trackColor={mobileTheme.colors.surfaceMid}
          style={styles.progress}
          testID="daily-momentum-progress"
        />
      </View>

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
  cardContent: {
    padding: mobileTheme.spacing.md,
  },
  clearButton: {
    alignSelf: 'flex-start',
    marginTop: mobileTheme.spacing.md,
  },
  completionText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    letterSpacing: 0.2,
  },
  completionWrap: {
    gap: 6,
    marginTop: mobileTheme.spacing.md,
  },
  emptyText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: mobileTheme.spacing.sm,
  },
  heroCopy: {
    flex: 1,
  },
  heroLabel: {
    color: mobileTheme.colors.textSubtle,
    ...mobileTheme.typography.heroLabel,
    marginTop: 2,
  },
  heroNumber: {
    color: mobileTheme.colors.text,
    ...mobileTheme.typography.heroNumber,
  },
  heroRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaDot: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  metaText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  progress: {
    height: 6,
  },
});
