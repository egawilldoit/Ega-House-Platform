import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  leftIconName?: IconName;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

function variantColors(variant: ButtonVariant) {
  switch (variant) {
    case 'primary':
      return { bg: mobileTheme.colors.accent, text: mobileTheme.colors.textOnAccent, border: mobileTheme.colors.accentDark };
    case 'danger':
      return { bg: mobileTheme.colors.danger, text: mobileTheme.colors.textOnAccent, border: mobileTheme.colors.dangerBorder };
    case 'ghost':
      return { bg: 'transparent', text: mobileTheme.colors.text, border: 'transparent' };
    case 'secondary':
    default:
      return { bg: mobileTheme.colors.surface, text: mobileTheme.colors.text, border: mobileTheme.glass.border };
  }
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  leftIconName,
  leftIcon,
  rightIcon,
  fullWidth = false,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const colors = variantColors(variant);
  const resolvedLeft = leftIcon ?? (leftIconName ? <Ionicons name={leftIconName} size={16} color={colors.text} /> : null);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        { backgroundColor: colors.bg, borderColor: colors.border },
        variant === 'ghost' ? styles.ghostBorder : styles.bordered,
        fullWidth ? styles.fullWidth : null,
        isDisabled ? styles.disabled : null,
        pressed && !isDisabled ? styles.pressed : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} size="small" />
      ) : (
        <>
          {resolvedLeft}
          <Text style={[styles.text, styles[`${size}Text`], { color: colors.text }, textStyle]}>{title}</Text>
          {rightIcon}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bordered: {
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.48,
  },
  fullWidth: {
    width: '100%',
  },
  ghostBorder: {
    borderColor: 'transparent',
    borderWidth: 0,
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
    transform: [{ scale: 0.98 }],
  },
  sm: {
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: mobileTheme.spacing.md,
  },
  smText: {
    fontSize: 13,
  },
  text: {
    ...mobileTheme.typography.button,
  },
});
