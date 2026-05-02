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

export type GlassBottomSheetProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  showHandle?: boolean;
  intensity?: number;
};

export function GlassBottomSheet({
  children,
  style,
  contentStyle,
  showHandle = true,
  intensity = mobileTheme.glass.blurIntensity.strong,
}: GlassBottomSheetProps) {
  const useRealBlur = Platform.OS !== 'android' || glassConfig.useRealBlurOnAndroid;
  const content = (
    <>
      <LinearGradient
        colors={['rgba(255,255,255,0.86)', 'rgba(255,255,255,0.54)']}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.highlight} />
      <View style={[styles.content, contentStyle]}>
        {showHandle ? <View style={styles.handle} /> : null}
        {children}
      </View>
    </>
  );

  if (useRealBlur) {
    return (
      <BlurView intensity={intensity} tint="light" style={[styles.sheet, style]}>
        {content}
      </BlurView>
    );
  }

  return <View style={[styles.sheet, styles.fake, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: mobileTheme.spacing.xl,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.md,
    position: 'relative',
    zIndex: 2,
  },
  fake: {
    backgroundColor: mobileTheme.glass.surfaceStrong,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(13,17,23,0.22)',
    borderRadius: mobileTheme.radius.pill,
    height: 5,
    marginBottom: mobileTheme.spacing.md,
    width: 44,
  },
  highlight: {
    borderColor: mobileTheme.glass.highlight,
    borderTopLeftRadius: mobileTheme.radius.sheet,
    borderTopRightRadius: mobileTheme.radius.sheet,
    borderTopWidth: 1,
    left: 1,
    opacity: 0.85,
    position: 'absolute',
    right: 1,
    top: 1,
  },
  sheet: {
    backgroundColor: mobileTheme.glass.surface,
    borderColor: mobileTheme.glass.border,
    borderTopLeftRadius: mobileTheme.radius.sheet,
    borderTopRightRadius: mobileTheme.radius.sheet,
    borderWidth: 1,
    overflow: 'hidden',
    ...mobileTheme.shadow.sheet,
  },
});
