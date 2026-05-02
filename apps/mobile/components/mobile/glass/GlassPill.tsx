import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { mobileTheme } from '../theme';

type GlassPillTone = 'default' | 'primary' | 'success' | 'danger' | 'warning';

export type GlassPillProps = {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  tone?: GlassPillTone;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

const toneColor: Record<GlassPillTone, string> = {
  default: mobileTheme.colors.textSecondary,
  primary: mobileTheme.colors.accent,
  success: mobileTheme.colors.success,
  danger: mobileTheme.colors.danger,
  warning: mobileTheme.colors.warning,
};

export function GlassPill({
  label,
  selected = false,
  disabled = false,
  onPress,
  leftIcon,
  rightIcon,
  tone = 'default',
  style,
  textStyle,
}: GlassPillProps) {
  const isPrimarySelected = selected || tone === 'primary';
  const colors: [string, string] = selected
    ? [mobileTheme.colors.accent, mobileTheme.colors.accentDark]
    : [mobileTheme.glass.surfaceStrong, mobileTheme.glass.fakeBackground];

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.default,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
      <LinearGradient colors={colors} pointerEvents="none" style={StyleSheet.absoluteFill} />
      {leftIcon}
      <Text
        numberOfLines={1}
        style={[
          styles.text,
          { color: selected ? mobileTheme.colors.textOnAccent : toneColor[tone] },
          isPrimarySelected ? styles.textSelected : null,
          textStyle,
        ]}
      >
        {label}
      </Text>
      {rightIcon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    justifyContent: 'center',
    minHeight: 42,
    overflow: 'hidden',
    paddingHorizontal: mobileTheme.spacing.md,
  },
  default: {
    borderColor: mobileTheme.glass.border,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.8,
  },
  selected: {
    borderColor: 'rgba(255,255,255,0.62)',
    ...mobileTheme.shadow.control,
  },
  text: {
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
  },
  textSelected: {
    fontWeight: mobileTheme.font.extrabold,
  },
});
