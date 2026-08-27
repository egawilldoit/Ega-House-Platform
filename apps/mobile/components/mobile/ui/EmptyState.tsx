import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type EmptyStateProps = {
  icon: string;
  iconSize?: number;
  title: string;
  description: string;
  action?: ReactNode;
  testID?: string;
};

export function EmptyState({ icon, iconSize = 36, title, description, action, testID }: EmptyStateProps) {
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon as never} size={iconSize} color={mobileTheme.colors.textSubtle} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    marginTop: mobileTheme.spacing.md,
  },
  container: {
    alignItems: 'center',
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingVertical: mobileTheme.spacing.xl,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.xl,
    height: 64,
    justifyContent: 'center',
    marginBottom: 10,
    width: 64,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
  },
});
