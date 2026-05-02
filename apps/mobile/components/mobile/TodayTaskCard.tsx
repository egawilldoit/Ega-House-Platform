import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { GlassButton, GlassCard, GlassPill } from '@/components/mobile/glass';
import { mobileTheme, statusTone } from '@/components/mobile/theme';

function formatStatus(value: string) {
  return value.replace(/_/g, ' ');
}

function getPrimaryActionTone(label: string) {
  const normalized = label.toLowerCase();

  if (normalized === 'start') {
    return 'primary' as const;
  }

  if (normalized === 'done') {
    return 'secondary' as const;
  }

  return 'ghost' as const;
}

function getStatusTone(status: 'todo' | 'in_progress' | 'done' | 'blocked') {
  if (status === 'done') {
    return 'success' as const;
  }

  if (status === 'blocked') {
    return 'warning' as const;
  }

  if (status === 'in_progress') {
    return 'primary' as const;
  }

  return 'default' as const;
}

function getPriorityTone(priority: 'low' | 'medium' | 'high' | 'urgent') {
  if (priority === 'urgent') {
    return 'danger' as const;
  }

  if (priority === 'high' || priority === 'medium') {
    return 'warning' as const;
  }

  return 'success' as const;
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
  const hasDueDate = dueLabel.toLowerCase() !== 'no due date';
  const primaryTone = getPrimaryActionTone(primaryActionLabel);

  return (
    <View style={styles.cardShell}>
      <GlassCard
        variant="fake"
        style={[styles.card, muted ? styles.mutedCard : null]}
        contentStyle={styles.cardContent}
      >
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
          <GlassPill
            label={formatStatus(status)}
            tone={muted ? 'default' : getStatusTone(status)}
            style={styles.pill}
          />
          <GlassPill
            label={priority}
            tone={getPriorityTone(priority)}
            style={styles.pill}
          />
          <View style={styles.rowSpacer} />
          <GlassPill
            label={dueLabel}
            leftIcon={
              <Ionicons
                color={hasDueDate ? mobileTheme.colors.accent : mobileTheme.colors.textSubtle}
                name="calendar-outline"
                size={13}
              />
            }
            tone={hasDueDate ? 'primary' : 'default'}
            style={styles.duePill}
          />
        </View>

        {blockedReason ? (
          <View style={styles.blockedBox}>
            <Text numberOfLines={2} style={styles.blockedText}>
              {blockedReason}
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <GlassButton
            disabled={busy}
            loading={busy}
            onPress={onPrimaryAction}
            style={styles.primary}
            title={primaryActionLabel}
            variant={primaryTone}
          />
          <GlassButton disabled={busy} onPress={onOpen} style={styles.secondary} title="Open" />
          <GlassButton
            disabled={busy}
            onPress={onActions}
            style={styles.icon}
            title=""
            variant="ghost"
            leftIcon={<Ionicons color={mobileTheme.colors.textMuted} name="ellipsis-horizontal" size={18} />}
          />
        </View>
      </GlassCard>
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
    position: 'relative',
  },
  cardContent: {
    paddingLeft: mobileTheme.spacing.xl,
  },
  cardShell: {
    borderRadius: mobileTheme.radius.card,
    ...mobileTheme.shadow.card,
  },
  duePill: {
    minHeight: 30,
    paddingHorizontal: 10,
  },
  icon: {
    height: mobileTheme.layout.minTouchTarget,
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: 0,
    width: mobileTheme.layout.minTouchTarget,
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
    flex: 1,
    minHeight: mobileTheme.layout.minTouchTarget,
  },
  rowSpacer: {
    flex: 1,
  },
  secondary: {
    minHeight: mobileTheme.layout.minTouchTarget,
    minWidth: 66,
  },
  pill: {
    minHeight: 30,
    paddingHorizontal: 10,
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
