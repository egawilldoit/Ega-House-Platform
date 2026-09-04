import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';

export type TodayWorkspaceInsightsProps = {
  onOpenReview: () => void;
  onOpenFriction: () => void;
};

export function TodayWorkspaceInsights({ onOpenReview, onOpenFriction }: TodayWorkspaceInsightsProps) {
  return (
    <Card style={styles.card} testID="today-workspace-insights">
      <Text style={styles.title}>Workspace check-in</Text>
      <Text style={styles.description}>Keep the loop moving beyond today&apos;s task list.</Text>

      <Pressable
        accessibilityHint="Opens your weekly review"
        accessibilityLabel="Open Weekly Review"
        accessibilityRole="button"
        onPress={onOpenReview}
        style={({ pressed }: { pressed: boolean }) => [styles.link, pressed ? styles.pressed : null]}
        testID="today-weekly-review-link"
      >
        <View style={styles.iconWrap}>
          <Ionicons name="calendar-outline" size={18} color={mobileTheme.colors.accent} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.linkTitle}>Weekly Review</Text>
          <Text style={styles.linkDescription}>See what moved and choose next steps.</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={mobileTheme.colors.textSubtle} />
      </Pressable>

      <Pressable
        accessibilityHint="Opens friction signals"
        accessibilityLabel="Open Friction Radar"
        accessibilityRole="button"
        onPress={onOpenFriction}
        style={({ pressed }: { pressed: boolean }) => [styles.link, styles.linkBorder, pressed ? styles.pressed : null]}
        testID="today-friction-link"
      >
        <View style={styles.iconWrap}>
          <Ionicons name="warning-outline" size={18} color={mobileTheme.colors.warning} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.linkTitle}>Friction Radar</Text>
          <Text style={styles.linkDescription}>Clear blockers and stale work.</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={mobileTheme.colors.textSubtle} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: mobileTheme.spacing.md,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  link: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
  },
  linkBorder: {
    borderTopColor: mobileTheme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  linkDescription: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
  },
  linkTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
  },
  pressed: {
    opacity: 0.72,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
  },
});
