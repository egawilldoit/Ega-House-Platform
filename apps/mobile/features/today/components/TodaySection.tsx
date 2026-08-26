import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

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
    <View style={styles.emptyWrap} testID={testID}>
      <View style={styles.iconWrap}>
        <Ionicons name="list-outline" size={20} color={mobileTheme.colors.textSubtle} />
      </View>
      <Text style={styles.emptyTitle}>No tasks</Text>
      <Text style={styles.emptyDescription}>{emptyText}</Text>
    </View>
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
  emptyDescription: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    lineHeight: 18,
    marginTop: 4,
    textAlign: 'center',
  },
  emptyTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingVertical: mobileTheme.spacing.md,
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
  iconWrap: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.xl,
    height: 64,
    justifyContent: 'center',
    marginBottom: 10,
    width: 64,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0.1,
  },
});
