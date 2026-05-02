import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { mobileTheme } from '../theme';

export type GlassSegmentOption<T extends string = string> = {
  label: string;
  value: T;
};

export type GlassSegmentedControlProps<T extends string = string> = {
  options: GlassSegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function GlassSegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  disabled = false,
  style,
}: GlassSegmentedControlProps<T>) {
  return (
    <View style={[styles.container, disabled ? styles.disabled : null, style]}>
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              selected ? styles.segmentActive : null,
              pressed && !disabled ? styles.segmentPressed : null,
            ]}
          >
            <Text style={[styles.text, selected ? styles.textActive : null]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.glass.border,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    minHeight: 42,
    padding: 3,
  },
  disabled: {
    opacity: 0.5,
  },
  segment: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 4,
  },
  segmentActive: {
    backgroundColor: mobileTheme.colors.surface,
  },
  segmentPressed: {
    opacity: 0.72,
  },
  text: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
  },
  textActive: {
    color: mobileTheme.colors.accent,
    fontWeight: mobileTheme.font.extrabold,
  },
});
