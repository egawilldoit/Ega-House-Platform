import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type SegmentedOption<T extends string> = {
  label: string;
  value: T;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  style,
  testID,
}: SegmentedControlProps<T>) {
  return (
    <View style={[styles.container, disabled ? styles.disabled : null, style]} testID={testID}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.inner}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.segment,
                selected ? styles.segmentActive : null,
                pressed && !disabled ? styles.segmentPressed : null,
              ]}
            >
              <Text style={[styles.text, selected ? styles.textActive : null]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: mobileTheme.colors.backgroundDeep,
    borderRadius: mobileTheme.radius.pill,
    padding: 3,
    minHeight: mobileTheme.layout.minTouchTarget + 6,
  },
  disabled: {
    opacity: 0.5,
  },
  inner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    justifyContent: 'center',
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: 14,
  },
  segmentActive: {
    backgroundColor: mobileTheme.colors.surface,
    ...mobileTheme.shadow.control,
  },
  segmentPressed: {
    opacity: 0.78,
  },
  text: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    textTransform: 'capitalize',
  },
  textActive: {
    color: mobileTheme.colors.text,
    fontWeight: mobileTheme.font.extrabold,
  },
});
