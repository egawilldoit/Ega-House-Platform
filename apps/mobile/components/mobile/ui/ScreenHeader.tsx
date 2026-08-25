import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type ScreenHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  rightSlot?: ReactNode;
  testID?: string;
};

export function ScreenHeader({ eyebrow, title, description, rightSlot, testID }: ScreenHeaderProps) {
  return (
    <View style={styles.header} testID={testID}>
      <View style={styles.copy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    paddingRight: mobileTheme.spacing.md,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  eyebrow: {
    color: mobileTheme.colors.accent,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: mobileTheme.spacing.lg,
    marginTop: mobileTheme.spacing.sm,
  },
  rightSlot: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 28,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.8,
    marginTop: 2,
  },
});
