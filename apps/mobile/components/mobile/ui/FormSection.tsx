import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

import { Card } from './Card';

export type FormSectionProps = {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function FormSection({ title, description, icon, children, style, testID }: FormSectionProps) {
  return (
    <Card style={[styles.section, style]} testID={testID}>
      <View style={styles.headerRow}>
        {icon ? <Ionicons name={icon} size={16} color={mobileTheme.colors.textMuted} /> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      <View style={styles.content}>{children}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.sm,
  },
  description: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  section: {
    marginTop: mobileTheme.spacing.md,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
  },
});
