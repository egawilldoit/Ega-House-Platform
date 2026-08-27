import { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mobileTheme } from '@/components/mobile/theme';

export type AppScreenProps = {
  children: ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

export function AppScreen({ children, padded = true, style, contentContainerStyle, testID }: AppScreenProps) {
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, style]} testID={testID}>
      <View style={styles.bgTopGlow} pointerEvents="none" />
      <View style={styles.accentStrip} pointerEvents="none">
        <View style={styles.accentStripStart} />
        <View style={styles.accentStripEnd} />
      </View>
      <View style={[styles.content, !padded ? styles.contentUnpadded : null, contentContainerStyle]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

export const appScreenContentPaddingBottom = mobileTheme.layout.floatingTabClearance;

const styles = StyleSheet.create({
  accentStrip: {
    flexDirection: 'row',
    height: 3,
    opacity: 0.6,
  },
  accentStripEnd: {
    backgroundColor: mobileTheme.colors.accentBarEnd,
    flex: 1,
  },
  accentStripStart: {
    backgroundColor: mobileTheme.colors.accent,
    flex: 1,
  },
  bgTopGlow: {
    backgroundColor: mobileTheme.colors.overlayLight,
    height: 34,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  content: {
    flex: 1,
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  contentUnpadded: {
    paddingHorizontal: 0,
  },
  screen: {
    backgroundColor: mobileTheme.colors.background,
    flex: 1,
  },
});
