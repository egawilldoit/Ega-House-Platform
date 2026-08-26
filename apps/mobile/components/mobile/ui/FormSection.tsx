import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type FormSectionProps = {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * FormSection — tonal separation + divider, not card-in-card.
 * Header row (icon + title + description) + hairline divider + content gap.
 * Inner rows use tonal Views (surfaceLow/muted) with hairline + divider, not nested Cards.
 */
export function FormSection({ title, description, icon, children, style, testID }: FormSectionProps) {
  return (
    <View style={[styles.section, style]} testID={testID}>
      <View style={styles.headerRow}>
        {icon ? <Ionicons name={icon} size={16} color={mobileTheme.colors.textMuted} /> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      <View style={styles.divider} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: mobileTheme.spacing.sm,
  },
  description: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  divider: {
    backgroundColor: mobileTheme.colors.border,
    height: StyleSheet.hairlineWidth,
    marginTop: mobileTheme.spacing.sm,
    opacity: 0.9,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  section: {
    marginTop: mobileTheme.spacing.md,
    // tonal separation — no Card wrapper, no shadow, just heading + divider
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
  },
});
