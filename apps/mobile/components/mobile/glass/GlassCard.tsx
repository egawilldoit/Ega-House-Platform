import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { glassConfig, mobileTheme } from '../theme';

export type GlassCardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  intensity?: number;
  radius?: number;
  variant?: 'real' | 'fake' | 'auto';
};

function shouldUseRealBlur(variant: GlassCardProps['variant']) {
  if (variant === 'fake') {
    return false;
  }

  if (variant === 'real') {
    return Platform.OS !== 'android' || glassConfig.useRealBlurOnAndroid;
  }

  return Platform.OS !== 'android' || glassConfig.useRealBlurOnAndroid;
}

export function GlassCard({
  children,
  style,
  contentStyle,
  intensity = mobileTheme.glass.blurIntensity.medium,
  radius = mobileTheme.radius.card,
  variant = 'auto',
}: GlassCardProps) {
  const useRealBlur = shouldUseRealBlur(variant);
  const radiusStyle = { borderRadius: radius };

  const content = (
    <>
      <LinearGradient
        colors={['rgba(255,255,255,0.74)', 'rgba(255,255,255,0.36)']}
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.gradient, radiusStyle]}
      />
      <View pointerEvents="none" style={[styles.highlight, radiusStyle]} />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </>
  );

  if (useRealBlur) {
    return (
      <BlurView intensity={intensity} tint="light" style={[styles.base, radiusStyle, style]}>
        {content}
      </BlurView>
    );
  }

  return <View style={[styles.base, styles.fake, radiusStyle, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: mobileTheme.glass.surface,
    borderColor: mobileTheme.glass.border,
    borderWidth: 1,
    overflow: 'hidden',
    ...mobileTheme.glass.shadow,
  },
  content: {
    padding: mobileTheme.spacing.lg,
    position: 'relative',
    zIndex: 2,
  },
  fake: {
    backgroundColor: mobileTheme.glass.fakeBackground,
  },
  gradient: {
    opacity: 0.82,
  },
  highlight: {
    borderColor: mobileTheme.glass.highlight,
    borderTopWidth: 1,
    left: 1,
    opacity: 0.8,
    position: 'absolute',
    right: 1,
    top: 1,
  },
});
