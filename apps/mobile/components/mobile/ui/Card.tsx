import { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  accentColor?: string;
  padded?: boolean;
  testID?: string;
};

export function Card({ children, style, contentStyle, accentColor, padded = true, testID }: CardProps) {
  return (
    <View
      testID={testID}
      style={[
        styles.card,
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
  card: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    overflow: 'hidden',
    ...mobileTheme.shadow.card,
  },
  content: {
    padding: mobileTheme.spacing.lg,
  },
  contentUnpadded: {
    padding: 0,
  },
});
