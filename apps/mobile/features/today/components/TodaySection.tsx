import { StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';
import { EmptyState } from '@/components/mobile/ui/EmptyState';

export type TodaySectionHeaderProps = {
  title: string;
  count: number;
  testID?: string;
};

export function TodaySectionHeader({ title, count, testID }: TodaySectionHeaderProps) {
  return (
    <View style={styles.header} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.countWrap}>
        <Text style={styles.count}>{count}</Text>
      </View>
    </View>
  );
}

export type TodaySectionEmptyProps = {
  emptyText: string;
  testID?: string;
};

export function TodaySectionEmpty({ emptyText, testID }: TodaySectionEmptyProps) {
  return (
    <Card style={styles.emptyCard} contentStyle={styles.emptyContent} testID={testID}>
      <EmptyState
        icon="list-outline"
        iconSize={22}
        title="No tasks"
        description={emptyText}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  count: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  countWrap: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  emptyCard: {
    marginBottom: mobileTheme.spacing.sm,
  },
  emptyContent: {
    padding: 0,
  },
  header: {
    alignItems: 'center',
    borderLeftColor: mobileTheme.colors.accent,
    borderLeftWidth: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 14,
    paddingLeft: 8,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0.1,
  },
});
