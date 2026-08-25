import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { mobileTheme, statusTone } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';
import { Chip } from '@/components/mobile/ui/Chip';
import { Button } from '@/components/mobile/ui/Button';
import { IconButton } from '@/components/mobile/ui/IconButton';

function formatStatus(value: string) {
  return value.replaceAll('_', ' ');
}

function getPrimaryVariant(label: string): 'primary' | 'secondary' | 'ghost' {
  const normalized = label.toLowerCase();
  if (normalized === 'start') return 'primary';
  if (normalized === 'done') return 'secondary';
  return 'ghost';
}

export type TodayTaskCardProps = {
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
};

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
}: TodayTaskCardProps) {
  const statusColors = statusTone(status);
  const hasDueDate = dueLabel.toLowerCase() !== 'no due date';
  const primaryVariant = getPrimaryVariant(primaryActionLabel);

  return (
    <View style={styles.shell}>
      <Card
        style={[styles.card, muted ? styles.mutedCard : null]}
        contentStyle={styles.cardContent}
        accentColor={muted ? mobileTheme.colors.neutralMid : statusColors.color}
        testID="today-task-card"
      >
        {muted ? <Text style={styles.watermark}>✓</Text> : null}

        <Text numberOfLines={2} style={[styles.title, muted ? styles.titleMuted : null]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {project.toUpperCase()}
          {goal ? ` · ${goal}` : ''}
        </Text>

        <View style={styles.metaRow}>
          <Chip kind="status" value={status} label={formatStatus(status)} muted={muted} style={styles.chip} />
          <Chip kind="priority" value={priority} style={styles.chip} showDot />
          <View style={styles.rowSpacer} />
          <View style={[styles.duePill, hasDueDate ? styles.duePillHasDue : styles.duePillNoDue]}>
            <Ionicons
              color={hasDueDate ? mobileTheme.colors.accent : mobileTheme.colors.textSubtle}
              name="calendar-outline"
              size={13}
            />
            <Text style={[styles.dueText, hasDueDate ? styles.dueTextHasDue : null]}>{dueLabel}</Text>
          </View>
        </View>

        {blockedReason ? (
          <View style={styles.blockedBox}>
            <Text numberOfLines={2} style={styles.blockedText}>
              {blockedReason}
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={primaryActionLabel}
            variant={primaryVariant}
            size="sm"
            disabled={busy}
            loading={busy}
            onPress={onPrimaryAction}
            style={styles.primary}
            testID="today-task-primary-action"
          />
          <Button
            title="Open"
            variant="secondary"
            size="sm"
            disabled={busy}
            onPress={onOpen}
            style={styles.secondary}
            testID="today-task-open"
          />
          <IconButton
            icon="ellipsis-horizontal"
            accessibilityLabel="Open task actions"
            disabled={busy}
            onPress={onActions}
            variant="ghost"
            size={44}
            iconSize={18}
            style={styles.iconBtn}
            testID="today-task-actions"
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: 10,
  },
  blockedBox: {
    backgroundColor: mobileTheme.colors.dangerBg,
    borderLeftColor: mobileTheme.colors.blocked,
    borderLeftWidth: 3,
    borderRadius: mobileTheme.radius.sm,
    marginTop: mobileTheme.spacing.sm,
    paddingHorizontal: 9,
    paddingVertical: 7,
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
    padding: 12,
    paddingLeft: 16,
  },
  chip: {
    minHeight: 26,
    paddingHorizontal: 7,
  },
  duePill: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 4,
    minHeight: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  duePillHasDue: {
    backgroundColor: mobileTheme.colors.infoBg,
  },
  duePillNoDue: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
  },
  dueText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
  },
  dueTextHasDue: {
    color: mobileTheme.colors.info,
  },
  iconBtn: {
    width: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: 0,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
    letterSpacing: 0.4,
    marginTop: 5,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  mutedCard: {
    opacity: 0.72,
  },
  primary: {
    flex: 1,
  },
  rowSpacer: {
    flex: 1,
  },
  secondary: {
    minWidth: 66,
  },
  shell: {
    borderRadius: mobileTheme.radius.card,
    ...mobileTheme.shadow.card,
    marginBottom: mobileTheme.spacing.sm,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0,
    lineHeight: 19,
  },
  titleMuted: {
    color: mobileTheme.colors.neutralStrong,
  },
  watermark: {
    bottom: 6,
    color: mobileTheme.colors.successBg,
    fontSize: 52,
    fontWeight: mobileTheme.font.black,
    position: 'absolute',
    right: 12,
  },
});
