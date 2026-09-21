import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/components/mobile/motion/ReducedMotion';
import { mobileTheme } from '@/components/mobile/theme';

const SHIMMER_DURATION_MS = 1400;
const SHIMMER_COLORS = ['rgba(255,255,255,0)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0)'] as const;

function ShimmerSurface({
  children,
  style,
  testID,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);
  const bandWidth = Math.max(48, width * 0.4);
  const shimmering = !reducedMotion && width > 0;

  useEffect(() => {
    if (!shimmering) {
      progress.value = 0;
      return;
    }

    progress.value = 0;
    progress.value = withRepeat(withTiming(1, { duration: SHIMMER_DURATION_MS, easing: Easing.linear }), -1, false);

    return () => cancelAnimation(progress);
  }, [shimmering, progress]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -bandWidth + progress.value * (width + bandWidth) }],
  }));

  function handleLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={handleLayout}
      style={style}
      testID={testID}
    >
      {children}
      {shimmering ? (
        <Animated.View
          pointerEvents="none"
          style={[skStyles.shimmer, { width: bandWidth }, shimmerStyle]}
          testID={testID ? `${testID}-shimmer` : undefined}
        >
          <LinearGradient colors={SHIMMER_COLORS} end={{ x: 1, y: 0 }} start={{ x: 0, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
    </View>
  );
}

export function SkeletonCard({ style, testID }: { style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <ShimmerSurface style={[skStyles.card, style]} testID={testID}>
      <View style={[skStyles.line, { width: '60%', height: 16 }]} />
      <View style={[skStyles.line, { width: '35%', height: 12, marginTop: 8 }]} />
      <View style={skStyles.badgeRow}>
        <View style={[skStyles.badge, { width: 56 }]} />
        <View style={[skStyles.badge, { width: 48 }]} />
      </View>
    </ShimmerSurface>
  );
}

export function SkeletonLine({
  width = '100%',
  height = 14,
  style,
  testID,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <ShimmerSurface
      style={[skStyles.line, { width: width as unknown as number, height } as ViewStyle, style]}
      testID={testID}
    />
  );
}

const skStyles = StyleSheet.create({
  badge: {
    backgroundColor: mobileTheme.colors.backgroundDeep,
    borderRadius: mobileTheme.radius.pill,
    height: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  card: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    marginBottom: mobileTheme.spacing.sm,
    overflow: 'hidden',
    padding: mobileTheme.spacing.lg,
  },
  line: {
    backgroundColor: mobileTheme.colors.skeleton,
    borderRadius: mobileTheme.radius.sm,
    overflow: 'hidden',
  },
  shimmer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
});
