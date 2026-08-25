import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileTheme, statusTone } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';
import { Chip } from '@/components/mobile/ui/Chip';
import { Button } from '@/components/mobile/ui/Button';
import { IconButton } from '@/components/mobile/ui/IconButton';

export type TaskCardProps = {
  title: string;
  project: string;
  goal?: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueLabel: string;
  estimateLabel?: string;
  blockedReason?: string | null;
  saving?: boolean;
  onOpen: () => void;
  onActions: () => void;
};

function formatStatus(value: string) {
  return value.replaceAll('_', ' ');
}

export function TaskCard({
  title,
  project,
  goal,
  status,
  priority,
  dueLabel,
  estimateLabel,
  blockedReason,
  saving,
  onOpen,
  onActions,
}: TaskCardProps) {
  const statusColors = statusTone(status);
  const hasDueDate = dueLabel.toLowerCase() !== 'no due date';
  const completed = status === 'done';

  return (
    <View style={[styles.shell, completed ? styles.shellComplete : null]}>
      <Card
        style={styles.card}
        contentStyle={styles.cardContent}
        accentColor={completed ? mobileTheme.colors.neutralMid : statusColors.color}
        testID="task-card"
      >
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={onOpen}
          style={({ pressed }) => [styles.mainTapArea, pressed && !saving ? styles.pressed : null]}
        >
          <Text numberOfLines={2} style={[styles.title, completed ? styles.titleComplete : null]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={styles.meta}>
            {project.toUpperCase()}
            {goal ? ` · ${goal}` : ''}
          </Text>

          <View style={styles.chipRow}>
            <Chip kind="status" value={status} label={formatStatus(status)} style={styles.chip} />
            <Chip kind="priority" value={priority} style={styles.chip} showDot />
            <View style={styles.spacer} />
            <View style={[styles.duePill, hasDueDate ? styles.duePillHasDue : styles.duePillNoDue]}>
              <Ionicons
                color={hasDueDate ? mobileTheme.colors.accent : mobileTheme.colors.textSubtle}
                name="calendar-outline"
                size={13}
              />
              <Text style={[styles.dueText, hasDueDate ? styles.dueTextHasDue : null]}>{dueLabel}</Text>
            </View>
            {estimateLabel ? (
              <View style={styles.metaPill}>
                <Ionicons color={mobileTheme.colors.textSubtle} name="timer-outline" size={13} />
                <Text style={styles.metaPillText}>{estimateLabel}</Text>
              </View>
            ) : null}
          </View>

          {blockedReason ? (
            <View style={styles.blockedBox}>
              <Ionicons color={mobileTheme.colors.blocked} name="alert-circle-outline" size={14} />
              <Text numberOfLines={2} style={styles.blockedText}>
                {blockedReason}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <View style={styles.actionsRow}>
          <Button
            title="Edit"
            variant="secondary"
            size="sm"
            disabled={saving}
            loading={saving}
            onPress={onOpen}
            style={styles.editBtn}
            testID="task-card-edit"
          />
          <IconButton
            icon="ellipsis-horizontal"
            accessibilityLabel="Open task actions"
            disabled={saving}
            onPress={onActions}
            variant="ghost"
            size={44}
            iconSize={18}
            testID="task-card-actions"
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: 10,
  },
  blockedBox: {
    alignItems: 'flex-start',
    backgroundColor: mobileTheme.colors.dangerBg,
    borderColor: mobileTheme.colors.blocked,
    borderLeftWidth: 3,
    borderRadius: mobileTheme.radius.sm,
    flexDirection: 'row',
    gap: 7,
    marginTop: mobileTheme.spacing.sm,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  blockedText: {
    color: mobileTheme.colors.blocked,
    flex: 1,
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
  chipRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
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
  editBtn: {
    flex: 1,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
    letterSpacing: 0.4,
    marginTop: 5,
  },
  metaPill: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.glass.border,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  metaPillText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
  },
  shell: {
    borderRadius: mobileTheme.radius.card,
    ...mobileTheme.shadow.card,
  },
  shellComplete: {
    opacity: 0.72,
  },
  mainTapArea: {
    borderRadius: mobileTheme.radius.sm,
  },
  pressed: {
    opacity: 0.78,
  },
  spacer: {
    flex: 1,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0,
    lineHeight: 19,
  },
  titleComplete: {
    color: mobileTheme.colors.textMuted,
  },
});
