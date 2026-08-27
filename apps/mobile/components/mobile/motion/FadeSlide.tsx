import { ReactNode, useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from './ReducedMotion';

export type FadeSlideProps = {
  children: ReactNode;
  visible?: boolean;
  durationMs?: number;
  offsetY?: number;
  style?: StyleProp<ViewStyle>;
};

export function FadeSlide({ children, visible = true, durationMs = 180, offsetY = 8, style }: FadeSlideProps) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(visible ? 1 : 0);
  const translateY = useSharedValue(visible ? 0 : offsetY);

  useEffect(() => {
    const dur = reducedMotion ? 80 : durationMs;
    opacity.value = withTiming(visible ? 1 : 0, { duration: dur });
    // Skip translate when reduced motion prefers minimal movement
    if (reducedMotion) {
      translateY.value = 0;
    } else {
      translateY.value = withTiming(visible ? 0 : offsetY, { duration: dur });
    }
  }, [visible, durationMs, offsetY, reducedMotion, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
