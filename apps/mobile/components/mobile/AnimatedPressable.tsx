import { ReactNode, useState } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

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
  // Animated.Value is mutable by design. Lazy state keeps one stable value per
  // component instance without reading a React ref during render.
  const [scale] = useState(() => new Animated.Value(1));

  function animateTo(value: number) {
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      friction: 7,
      tension: 120,
    }).start();
  }

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => animateTo(scaleTo)}
      onPressOut={() => animateTo(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
