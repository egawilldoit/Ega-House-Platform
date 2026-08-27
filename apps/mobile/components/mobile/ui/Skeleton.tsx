import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export function SkeletonCard({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[skStyles.card, style]}>
      <View style={[skStyles.line, { width: '60%', height: 16 }]} />
      <View style={[skStyles.line, { width: '35%', height: 12, marginTop: 8 }]} />
      <View style={skStyles.badgeRow}>
        <View style={[skStyles.badge, { width: 56 }]} />
        <View style={[skStyles.badge, { width: 48 }]} />
      </View>
    </View>
  );
}

export function SkeletonLine({
  width = '100%',
  height = 14,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[skStyles.line, { width: width as unknown as number, height } as ViewStyle, style]} />;
}

const skStyles = StyleSheet.create({
  badge: {
    backgroundColor: mobileTheme.colors.backgroundDeep,
    borderRadius: mobileTheme.radius.pill,
    height: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  card: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    marginBottom: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.lg,
  },
  line: {
    backgroundColor: mobileTheme.colors.skeleton,
    borderRadius: mobileTheme.radius.sm,
  },
});
