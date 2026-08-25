import { ReactNode, useEffect } from 'react';
import { Pressable, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from './ReducedMotion';

export type AnimatedPressableProps = {
  children: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  scaleTo?: number;
  durationMs?: number;
};

export function AnimatedPressable({
  children,
  onPress,
  style,
  disabled = false,
  scaleTo = 0.97,
  durationMs = 120,
}: AnimatedPressableProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  function animateTo(value: number) {
    if (reducedMotion) {
      scale.value = 1;
      return;
    }
    if (value === 1) {
      scale.value = withSpring(1, { damping: 14, stiffness: 180 });
    } else {
      scale.value = withTiming(value, { duration: Math.min(Math.max(durationMs, 100), 140) });
    }
  }

  // Ensure reanimated worklet is initialized without mount flicker
  useEffect(() => {
    scale.value = 1;
  }, [scale]);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => animateTo(scaleTo)}
      onPressOut={() => animateTo(1)}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
