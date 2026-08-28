import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export type IconButtonProps = {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  size?: number;
  iconSize?: number;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 44,
  iconSize = 18,
  disabled = false,
  variant = 'ghost',
  style,
  testID,
}: IconButtonProps) {
  const backgroundColor =
    variant === 'primary'
      ? mobileTheme.colors.accent
      : variant === 'danger'
        ? mobileTheme.colors.danger
        : variant === 'secondary'
          ? mobileTheme.colors.surface
          : 'transparent';

  const borderColor =
    variant === 'ghost' ? 'transparent' : mobileTheme.glass.border;

  const iconColor =
    variant === 'primary' || variant === 'danger'
      ? mobileTheme.colors.textOnAccent
      : mobileTheme.colors.text;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor,
          borderColor,
          height: Math.max(size, mobileTheme.layout.minTouchTarget),
          width: Math.max(size, mobileTheme.layout.minTouchTarget),
          minHeight: Math.max(size, mobileTheme.layout.minTouchTarget),
          minWidth: Math.max(size, mobileTheme.layout.minTouchTarget),
        },
        variant === 'ghost' ? styles.ghost : styles.bordered,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
      <Ionicons name={icon} size={iconSize} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bordered: {
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.45,
  },
  ghost: {
    borderWidth: 0,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
});
