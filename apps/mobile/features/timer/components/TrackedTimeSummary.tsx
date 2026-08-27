import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { TimerSessionSummary } from '@ega/contracts/mobile';
import { mobileTheme } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';

export type TrackedTimeSummaryProps = {
  summary: TimerSessionSummary;
  testID?: string;
};

export function TrackedTimeSummary({ summary, testID }: TrackedTimeSummaryProps) {
  return (
    <Card style={styles.card} testID={testID ?? 'tracked-summary'}>
      <View style={styles.titleRow}>
        <Ionicons color={mobileTheme.colors.accent} name="timer-outline" size={18} />
        <Text style={styles.title}>Tracked time</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text style={styles.statValue} testID="summary-today">
            {summary.trackedTodayLabel}
          </Text>
          <Text style={styles.statLabel}>Today</Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statValue} testID="summary-sessions">
            {String(summary.sessionsTodayCount)}
          </Text>
          <Text style={styles.statLabel}>Sessions</Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statValue} testID="summary-longest">
            {summary.longestSessionLabel ?? '—'}
          </Text>
          <Text style={styles.statLabel}>Longest</Text>
        </View>
      </View>

      <Text style={styles.totalMeta} testID="summary-all-time">
        All time · {summary.trackedTotalLabel}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: mobileTheme.spacing.xs,
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
  statsRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: mobileTheme.spacing.sm,
  },
  totalMeta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: mobileTheme.spacing.sm,
    textAlign: 'center',
  },
});
