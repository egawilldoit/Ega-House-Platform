import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type FloatingActionButtonProps = {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
  testID?: string;
};

export function FloatingActionButton({
  label,
  onPress,
  icon = 'add',
  accessibilityLabel,
  testID,
}: FloatingActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.fab, pressed ? styles.pressed : null]}
    >
      <View style={styles.toneLayer} pointerEvents="none" />
      <Ionicons color={mobileTheme.colors.textOnAccent} name={icon} size={16} />
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    bottom: mobileTheme.spacing.lg,
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    overflow: 'hidden',
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingVertical: 14,
    position: 'absolute',
    right: 18,
    ...mobileTheme.shadow.fab,
    minHeight: mobileTheme.layout.minTouchTarget,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  text: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 14,
    fontWeight: mobileTheme.font.black,
    letterSpacing: 0.2,
  },
  toneLayer: {
    backgroundColor: mobileTheme.colors.accentDark,
    borderRadius: mobileTheme.radius.pill,
    bottom: 0,
    left: 0,
    opacity: 0.2,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
