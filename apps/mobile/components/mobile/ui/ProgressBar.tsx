import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type ProgressBarProps = {
  value: number;
  max?: number;
  color?: string;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function ProgressBar({
  value,
  max = 100,
  color = mobileTheme.colors.accent,
  trackColor = mobileTheme.colors.backgroundDeep,
  style,
  testID,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <View style={[styles.track, { backgroundColor: trackColor }, style]} testID={testID}>
      <View style={[styles.fill, { backgroundColor: color, width: `${clamped * 100}%` as unknown as ViewStyle['width'] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    borderRadius: 3,
    height: 6,
  },
  track: {
    borderRadius: 3,
    height: 6,
    overflow: 'hidden',
  },
});
