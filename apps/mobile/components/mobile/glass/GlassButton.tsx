import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { mobileTheme } from '../theme';

type GlassButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type GlassButtonSize = 'sm' | 'md' | 'lg';

export type GlassButtonProps = {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

const gradientColors: Record<GlassButtonVariant, [string, string]> = {
  primary: [mobileTheme.colors.accent, mobileTheme.colors.accentDark],
  secondary: ['#ffffff', '#f8fafc'],
  danger: [mobileTheme.colors.danger, '#b91c1c'],
  ghost: ['rgba(255,255,255,0)', 'rgba(255,255,255,0)'],
};

export function GlassButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  fullWidth = false,
  style,
  textStyle,
}: GlassButtonProps) {
  const isDisabled = disabled || loading;
  const textColor =
    variant === 'primary' || variant === 'danger'
      ? mobileTheme.colors.textOnAccent
      : mobileTheme.colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        variant === 'ghost' ? styles.ghost : styles.bordered,
        fullWidth ? styles.fullWidth : null,
        isDisabled ? styles.disabled : null,
        pressed && !isDisabled ? styles.pressed : null,
        style,
      ]}
    >
      <LinearGradient
        colors={gradientColors[variant]}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {leftIcon}
          <Text style={[styles.text, styles[`${size}Text`], { color: textColor }, textStyle]}>
            {title}
          </Text>
          {rightIcon}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bordered: {
    borderColor: mobileTheme.glass.border,
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.48,
  },
  fullWidth: {
    width: '100%',
  },
  ghost: {
    borderColor: 'transparent',
    borderWidth: 1,
  },
  lg: {
    minHeight: 50,
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  lgText: {
    fontSize: 15,
  },
  md: {
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: mobileTheme.spacing.md,
  },
  mdText: {
    fontSize: 14,
  },
  pressed: {
    opacity: 0.82,
  },
  sm: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
  smText: {
    fontSize: 13,
  },
  text: {
    fontWeight: mobileTheme.font.extrabold,
  },
});
