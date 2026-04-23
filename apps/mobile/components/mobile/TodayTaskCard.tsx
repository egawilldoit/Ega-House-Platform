import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { InfoBadge, SurfaceCard } from '@/components/mobile/primitives';
import { mobileTheme, priorityTone, statusTone } from '@/components/mobile/theme';

function formatStatus(value: string) {
  return value.replace(/_/g, ' ');
}

function getPrimaryActionTone(label: string) {
  const normalized = label.toLowerCase();

  if (normalized === 'start') {
    return { backgroundColor: mobileTheme.colors.infoBg, textColor: mobileTheme.colors.info };
  }

  if (normalized === 'done') {
    return { backgroundColor: mobileTheme.colors.successBg, textColor: mobileTheme.colors.success };
  }

  return { backgroundColor: mobileTheme.colors.slateBg, textColor: mobileTheme.colors.slate };
}

export function TodayTaskCard({
  title,
  project,
  goal,
  status,
  priority,
  dueLabel,
  blockedReason,
  primaryActionLabel,
  muted,
  busy,
  onPrimaryAction,
  onOpen,
  onActions,
}: {
  title: string;
  project: string;
  goal?: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueLabel: string;
  blockedReason?: string | null;
  primaryActionLabel: string;
  muted?: boolean;
  busy?: boolean;
  onPrimaryAction: () => void;
  onOpen: () => void;
  onActions: () => void;
}) {
  const statusColors = statusTone(status);
  const priorityColors = priorityTone(priority);
  const hasDueDate = dueLabel.toLowerCase() !== 'no due date';
  const primaryTone = getPrimaryActionTone(primaryActionLabel);

  return (
    <View style={styles.cardShell}>
      <SurfaceCard style={[styles.card, muted ? styles.mutedCard : null]}>
        <View style={[styles.leftAccent, { backgroundColor: muted ? mobileTheme.colors.neutralMid : statusColors.color }]} />
        {muted ? <Text style={styles.watermark}>✓</Text> : null}

        <Text numberOfLines={2} style={[styles.title, muted ? styles.titleMuted : null]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {project}
          {goal ? ` · ${goal}` : ''}
        </Text>

        <View style={styles.metaRow}>
          <InfoBadge
            backgroundColor={muted ? mobileTheme.colors.surfaceMuted : statusColors.background}
            dot={muted ? mobileTheme.colors.neutralMid : statusColors.dot}
            label={formatStatus(status)}
            textColor={muted ? mobileTheme.colors.textSubtle : statusColors.color}
          />
          <InfoBadge
            backgroundColor={priorityColors.background}
            dot={priorityColors.dot}
            label={priority}
            textColor={priorityColors.color}
          />
          <View style={styles.rowSpacer} />
          <Text style={[styles.due, !hasDueDate ? styles.dueMuted : null]}>{`📅 ${dueLabel}`}</Text>
        </View>

        {blockedReason ? (
          <View style={styles.blockedBox}>
            <Text numberOfLines={2} style={styles.blockedText}>
              {blockedReason}
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            disabled={busy}
            onPress={onPrimaryAction}
            style={[styles.primary, { backgroundColor: primaryTone.backgroundColor }]}
          >
            {busy ? (
              <ActivityIndicator color={primaryTone.textColor} size="small" />
            ) : (
              <Text style={[styles.primaryText, { color: primaryTone.textColor }]}>{primaryActionLabel}</Text>
            )}
          </Pressable>
          <Pressable disabled={busy} onPress={onOpen} style={styles.secondary}>
            <Text style={styles.secondaryText}>Open</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={onActions} style={styles.icon}>
            <Ionicons color={mobileTheme.colors.textMuted} name="ellipsis-horizontal" size={18} />
          </Pressable>
        </View>
      </SurfaceCard>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  blockedBox: {
    backgroundColor: mobileTheme.colors.dangerBg,
    borderLeftColor: mobileTheme.colors.blocked,
    borderLeftWidth: 3,
    borderRadius: mobileTheme.radius.sm,
    marginTop: mobileTheme.spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  blockedText: {
    color: mobileTheme.colors.blocked,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    lineHeight: 17,
  },
  card: {
    overflow: 'hidden',
    paddingLeft: mobileTheme.spacing.xl,
    position: 'relative',
  },
  cardShell: {
    borderRadius: mobileTheme.radius.card,
    ...mobileTheme.shadow.cardHover,
  },
  due: {
    color: mobileTheme.colors.text,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  dueMuted: {
    color: mobileTheme.colors.textSubtle,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  leftAccent: {
    borderBottomLeftRadius: mobileTheme.radius.card,
    borderTopLeftRadius: mobileTheme.radius.card,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 4,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 6,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: mobileTheme.spacing.sm,
  },
  mutedCard: {
    opacity: 0.65,
  },
  primary: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: mobileTheme.spacing.md,
  },
  primaryText: {
    fontSize: 13,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0.2,
  },
  rowSpacer: {
    flex: 1,
  },
  secondary: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 66,
    paddingHorizontal: 12,
  },
  secondaryText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  titleMuted: {
    color: mobileTheme.colors.neutralStrong,
  },
  watermark: {
    bottom: 6,
    color: mobileTheme.colors.successBg,
    fontSize: 64,
    fontWeight: mobileTheme.font.black,
    position: 'absolute',
    right: 12,
  },
});
