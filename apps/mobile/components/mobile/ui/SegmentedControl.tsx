import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useReducedMotion } from '@/components/mobile/motion/ReducedMotion';
import { mobileTheme } from '@/components/mobile/theme';

export type SegmentedOption<T extends string> = {
  label: string;
  value: T;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type SegmentLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  style,
  testID,
}: SegmentedControlProps<T>) {
  const reducedMotion = useReducedMotion();
  const [layouts, setLayouts] = useState<Record<string, SegmentLayout>>({});
  const hasPositioned = useSharedValue(false);
  const thumbX = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);

  const selectedOption = options.find((option) => option.value === value);
  const thumbLayout = selectedOption ? layouts[selectedOption.value] : undefined;
  const thumbXTarget = thumbLayout?.x;

  useEffect(() => {
    if (thumbXTarget === undefined) {
      thumbOpacity.value = 0;
      return;
    }

    if (!hasPositioned.value) {
      thumbX.value = thumbXTarget;
      thumbOpacity.value = 1;
      hasPositioned.value = true;
      return;
    }

    thumbOpacity.value = 1;

    if (reducedMotion) {
      thumbX.value = thumbXTarget;
      return;
    }

    thumbX.value = withSpring(thumbXTarget, { damping: 18, mass: 0.7, stiffness: 190 });
  }, [thumbXTarget, reducedMotion, hasPositioned, thumbX, thumbOpacity]);

  const thumbStyle = useAnimatedStyle(() => ({
    opacity: thumbOpacity.value,
    transform: [{ translateX: thumbX.value }],
  }));

  function handleSegmentLayout(segmentValue: T, event: LayoutChangeEvent) {
    const { x, y, width, height } = event.nativeEvent.layout;

    setLayouts((current) => {
      const previous = current[segmentValue];
      if (previous && previous.x === x && previous.y === y && previous.width === width && previous.height === height) {
        return current;
      }

      return { ...current, [segmentValue]: { x, y, width, height } };
    });
  }

  return (
    <View style={[styles.container, disabled ? styles.disabled : null, style]} testID={testID}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.inner}>
        {thumbLayout ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.thumb, { height: thumbLayout.height, top: thumbLayout.y, width: thumbLayout.width }, thumbStyle]}
            testID={testID ? `${testID}-thumb` : undefined}
          />
        ) : null}
        {options.map((option) => {
          const selected = option.value === value;
          const optionDisabled = disabled || option.disabled === true;

          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: optionDisabled }}
              disabled={optionDisabled}
              onLayout={(event) => handleSegmentLayout(option.value, event)}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.segment,
                pressed && !optionDisabled ? styles.segmentPressed : null,
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
    paddingHorizontal: mobileTheme.spacing.md,
  },
  segmentPressed: {
    opacity: 0.78,
  },
  text: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    textTransform: 'capitalize',
  },
  textActive: {
    color: mobileTheme.colors.text,
    fontWeight: mobileTheme.font.extrabold,
  },
  thumb: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: mobileTheme.radius.pill,
    left: 0,
    position: 'absolute',
    ...mobileTheme.shadow.control,
  },
});
