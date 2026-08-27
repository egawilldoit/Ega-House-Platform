import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type FeedbackBannerProps = {
  message: string;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const toneMap = {
  info: { bg: mobileTheme.colors.infoBg, color: mobileTheme.colors.info, icon: 'information-circle-outline' as const },
  success: { bg: mobileTheme.colors.successBg, color: mobileTheme.colors.success, icon: 'checkmark-circle-outline' as const },
  warning: { bg: mobileTheme.colors.warningBg, color: mobileTheme.colors.warning, icon: 'warning-outline' as const },
  danger: { bg: mobileTheme.colors.dangerBg, color: mobileTheme.colors.danger, icon: 'alert-circle-outline' as const },
  neutral: { bg: mobileTheme.colors.surfaceMuted, color: mobileTheme.colors.textSubtle, icon: 'ellipse-outline' as const },
};

export function FeedbackBanner({ message, tone = 'info', style, testID }: FeedbackBannerProps) {
  const t = toneMap[tone];
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      style={[styles.base, { backgroundColor: t.bg, borderColor: t.color }, style]}
      testID={testID}
    >
      <Ionicons name={t.icon} size={16} color={t.color} />
      <Text style={[styles.text, { color: t.color }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 10,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    lineHeight: 18,
  },
});
