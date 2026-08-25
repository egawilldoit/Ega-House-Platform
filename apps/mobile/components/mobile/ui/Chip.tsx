import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { chipTone, type ChipKind } from '@/components/mobile/theme';
import { mobileTheme } from '@/components/mobile/theme';

export type ChipProps = {
  kind: ChipKind;
  value: string | null;
  label?: string;
  showDot?: boolean;
  muted?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

function formatValue(value: string | null) {
  if (!value) return '—';
  return value.replaceAll('_', ' ');
}

export function Chip({ kind, value, label, showDot = true, muted = false, style, textStyle, testID }: ChipProps) {
  const tone = chipTone(kind, value);
  const displayLabel = label ?? formatValue(value);

  return (
    <View
      testID={testID}
      style={[
        styles.base,
        { backgroundColor: tone.background },
        muted ? styles.muted : null,
        style,
      ]}
    >
      {showDot ? <View style={[styles.dot, { backgroundColor: tone.dot }]} /> : null}
      <Text style={[styles.text, { color: tone.color }, textStyle]}>{displayLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 26,
  },
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  muted: {
    opacity: 0.55,
  },
  text: {
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.2,
    textTransform: 'capitalize',
  },
});
