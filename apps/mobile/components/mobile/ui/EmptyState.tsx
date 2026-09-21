import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type EmptyStateVariant = 'first-use' | 'no-results' | 'error' | 'offline';

export type EmptyStateProps = {
  icon: string;
  iconSize?: number;
  title: string;
  description: string;
  variant?: EmptyStateVariant;
  illustration?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  testID?: string;
};

const variantTone: Record<EmptyStateVariant, { tileBackground: string; iconColor: string }> = {
  'first-use': {
    tileBackground: mobileTheme.colors.primaryContainer,
    iconColor: mobileTheme.colors.onPrimaryContainer,
  },
  'no-results': {
    tileBackground: mobileTheme.colors.neutralContainer,
    iconColor: mobileTheme.colors.onNeutralContainer,
  },
  error: {
    tileBackground: mobileTheme.colors.dangerContainer,
    iconColor: mobileTheme.colors.onDangerContainer,
  },
  offline: {
    tileBackground: mobileTheme.colors.warningContainer,
    iconColor: mobileTheme.colors.onWarningContainer,
  },
};

export function EmptyState({
  icon,
  iconSize = 36,
  title,
  description,
  variant = 'first-use',
  illustration,
  action,
  secondaryAction,
  testID,
}: EmptyStateProps) {
  const tone = variantTone[variant];

  return (
    <View style={styles.container} testID={testID}>
      <View
        accessibilityElementsHidden={!illustration}
        importantForAccessibility={illustration ? 'auto' : 'no-hide-descendants'}
        style={styles.mediaWrap}
      >
        {illustration ?? (
          <>
            <View
              pointerEvents="none"
              style={[styles.backTile, styles.backTileLeft, { backgroundColor: tone.tileBackground }]}
            />
            <View
              pointerEvents="none"
              style={[styles.backTile, styles.backTileRight, { backgroundColor: tone.tileBackground }]}
            />
            <View style={[styles.iconTile, { backgroundColor: tone.tileBackground }]}>
              <Ionicons name={icon as never} size={iconSize} color={tone.iconColor} />
            </View>
          </>
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {action || secondaryAction ? (
        <View style={styles.actions}>
          {action}
          {secondaryAction}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  backTile: {
    borderRadius: mobileTheme.radius.xl,
    height: 58,
    opacity: 0.45,
    position: 'absolute',
    top: 15,
    width: 58,
  },
  backTileLeft: {
    left: 10,
    transform: [{ rotate: '-9deg' }],
  },
  backTileRight: {
    right: 10,
    transform: [{ rotate: '8deg' }],
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
  iconTile: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.xl,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  mediaWrap: {
    alignItems: 'center',
    height: 88,
    justifyContent: 'center',
    marginBottom: 10,
    width: 112,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
  },
});
