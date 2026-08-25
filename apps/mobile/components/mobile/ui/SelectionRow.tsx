import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type SelectionRowProps = {
  label: string;
  selected?: boolean;
  description?: string;
  onPress?: () => void;
  disabled?: boolean;
  leftIcon?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function SelectionRow({
  label,
  selected = false,
  description,
  onPress,
  disabled = false,
  leftIcon,
  style,
  testID,
}: SelectionRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowSelected : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
      {leftIcon ? <Ionicons name={leftIcon as never} size={18} color={mobileTheme.colors.textMuted} /> : null}
      <View style={styles.copy}>
        <Text style={[styles.label, selected ? styles.labelSelected : null]}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={20} color={mobileTheme.colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
  },
  labelSelected: {
    color: mobileTheme.colors.accentDark,
    fontWeight: mobileTheme.font.bold,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  row: {
    alignItems: 'center',
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: mobileTheme.colors.surface,
  },
  rowSelected: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.accentMid,
  },
});
