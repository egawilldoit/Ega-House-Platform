import { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type CardVariant = 'plain' | 'tonal' | 'elevated' | 'semantic';
export type CardTonalTone = 'low' | 'mid' | 'high';
export type CardSemanticTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary' | 'secondary' | 'tertiary';

export type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  accentColor?: string;
  padded?: boolean;
  variant?: CardVariant;
  /** For tonal: low|mid|high. For semantic: neutral|info|success|warning|danger|primary|secondary|tertiary */
  tone?: CardTonalTone | CardSemanticTone;
  testID?: string;
};

function resolveTonalBackground(tone: string | undefined) {
  switch (tone) {
    case 'mid':
      return mobileTheme.colors.surfaceMid;
    case 'high':
      return mobileTheme.colors.surfaceHigh;
    case 'low':
    default:
      return mobileTheme.colors.surfaceLow;
  }
}

function resolveSemanticBackground(tone: string | undefined) {
  switch (tone) {
    case 'info':
      return mobileTheme.colors.infoContainer;
    case 'success':
      return mobileTheme.colors.successContainer;
    case 'warning':
      return mobileTheme.colors.warningContainer;
    case 'danger':
      return mobileTheme.colors.dangerContainer;
    case 'primary':
      return mobileTheme.colors.primaryContainer;
    case 'secondary':
      return mobileTheme.colors.secondaryContainer;
    case 'tertiary':
      return mobileTheme.colors.tertiaryContainer;
    case 'neutral':
    default:
      return mobileTheme.colors.neutralContainer;
  }
}

export function Card({
  children,
  style,
  contentStyle,
  accentColor,
  padded = true,
  variant = 'plain',
  tone,
  testID,
}: CardProps) {
  const variantStyle: ViewStyle =
    variant === 'elevated'
      ? styles.elevated
      : variant === 'tonal'
        ? { backgroundColor: resolveTonalBackground(tone), borderColor: mobileTheme.colors.border }
        : variant === 'semantic'
          ? { backgroundColor: resolveSemanticBackground(tone), borderColor: mobileTheme.colors.border }
          : styles.plain;

  return (
    <View
      testID={testID}
      style={[
        styles.base,
        variantStyle,
        accentColor
          ? { borderLeftColor: accentColor, borderLeftWidth: 3, paddingLeft: mobileTheme.spacing.lg - 3 }
          : null,
        style,
      ]}
    >
      <View style={[padded ? styles.content : styles.contentUnpadded, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: mobileTheme.radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mobileTheme.colors.border,
    overflow: 'hidden',
  },
  plain: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    // no shadow — tonal separation + hairline
  },
  elevated: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderWidth: 1,
    ...mobileTheme.shadow.card,
  },
  content: {
    padding: mobileTheme.spacing.lg,
  },
  contentUnpadded: {
    padding: 0,
  },
});
