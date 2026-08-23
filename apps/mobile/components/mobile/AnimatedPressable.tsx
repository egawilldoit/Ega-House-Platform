import { ReactNode, useState } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useReducedMotionEnabled } from './use-reduced-motion';

export function AnimatedPressable({
  children,
  onPress,
  style,
  disabled,
  scaleTo = 0.97,
}: {
  children: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  scaleTo?: number;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  const reducedMotion = useReducedMotionEnabled();

  function animateTo(value: number) {
    if (reducedMotion) {
      scale.setValue(1);
      return;
    }

    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      friction: 7,
      tension: 120,
    }).start();
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => animateTo(scaleTo)}
      onPressOut={() => animateTo(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
