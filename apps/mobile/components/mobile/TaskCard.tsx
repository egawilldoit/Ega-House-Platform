import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassButton, GlassCard, GlassPill } from '@/components/mobile/glass';
import { mobileTheme, priorityTone, statusTone } from '@/components/mobile/theme';

function formatStatus(value: string) {
  return value.replace(/_/g, ' ');
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
}: {
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
}) {
  const statusColors = statusTone(status);
  const priorityColors = priorityTone(priority);
  const hasDueDate = dueLabel.toLowerCase() !== 'no due date';
  const completed = status === 'done';

  return (
    <View style={[styles.cardShell, completed ? styles.cardShellComplete : null]}>
      <GlassCard variant="fake" style={styles.card} contentStyle={styles.cardContent}>
        <View style={[styles.leftAccent, { backgroundColor: statusColors.color }]} />
        <Pressable
          disabled={saving}
          onPress={onOpen}
          style={({ pressed }) => [styles.mainTapArea, pressed && !saving ? styles.pressed : null]}
        >
          <View style={styles.titleRow}>
            <View
              style={[
                styles.statusCircle,
                { borderColor: statusColors.color },
                completed ? { backgroundColor: statusColors.color } : null,
              ]}
            >
              {completed ? (
                <Ionicons color={mobileTheme.colors.textOnAccent} name="checkmark" size={13} />
              ) : null}
            </View>
            <Text numberOfLines={2} style={[styles.title, completed ? styles.titleComplete : null]}>
              {title}
            </Text>
          </View>
          <Text numberOfLines={1} style={styles.meta}>
            {project}
            {goal ? ` · ${goal}` : ''}
          </Text>

          <View style={styles.indicatorsRow}>
            <GlassPill
              label={formatStatus(status)}
              leftIcon={<View style={[styles.pillDot, { backgroundColor: statusColors.dot }]} />}
              tone={status === 'done' ? 'success' : status === 'blocked' ? 'danger' : 'primary'}
            />
            <GlassPill
              label={priority}
              leftIcon={<View style={[styles.pillDot, { backgroundColor: priorityColors.dot }]} />}
              tone={priority === 'urgent' ? 'danger' : priority === 'high' ? 'warning' : 'default'}
            />
          </View>

          <View style={styles.metaPillRow}>
            <View style={styles.metaPill}>
              <Ionicons
                color={hasDueDate ? mobileTheme.colors.text : mobileTheme.colors.textSubtle}
                name="calendar-outline"
                size={13}
              />
              <Text
                numberOfLines={1}
                style={[styles.metaStrong, !hasDueDate ? styles.metaQuiet : null]}
              >
                {dueLabel}
              </Text>
            </View>
            {estimateLabel ? (
              <View style={styles.metaPill}>
                <Ionicons color={mobileTheme.colors.textSubtle} name="timer-outline" size={13} />
                <Text numberOfLines={1} style={styles.metaQuiet}>
                  {estimateLabel}
                </Text>
              </View>
            ) : null}
          </View>

          {blockedReason ? (
            <View style={styles.blockedBox}>
              <Ionicons
                color={mobileTheme.colors.blocked}
                name="alert-circle-outline"
                size={14}
              />
              <Text numberOfLines={2} style={styles.blockedText}>
                {blockedReason}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <View style={styles.actionsRow}>
          <GlassButton
            disabled={saving}
            leftIcon={
              saving ? undefined : (
                <Ionicons color={mobileTheme.colors.accentDark} name="open-outline" size={15} />
              )
            }
            loading={saving}
            onPress={onOpen}
            size="md"
            style={styles.secondaryAction}
            textStyle={styles.secondaryActionText}
            title="Edit"
            variant="secondary"
          />
          <Pressable
            accessibilityLabel="Open task actions"
            disabled={saving}
            onPress={onActions}
            style={({ pressed }) => [
              styles.iconAction,
              pressed && !saving ? styles.pressed : null,
              saving ? styles.disabled : null,
            ]}
          >
            <Ionicons color={mobileTheme.colors.textMuted} name="ellipsis-horizontal" size={18} />
          </Pressable>
        </View>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  blockedBox: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(237,233,254,0.72)',
    borderColor: 'rgba(124,58,237,0.18)',
    borderWidth: 1,
    borderRadius: mobileTheme.radius.sm,
    flexDirection: 'row',
    gap: 7,
    marginTop: mobileTheme.spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
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
    paddingLeft: mobileTheme.spacing.xl,
  },
  cardShell: {
    borderRadius: mobileTheme.radius.card,
    ...mobileTheme.shadow.cardHover,
  },
  cardShellComplete: {
    opacity: 0.72,
  },
  iconAction: {
    alignItems: 'center',
    backgroundColor: mobileTheme.glass.surfaceStrong,
    borderColor: mobileTheme.glass.border,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1,
    height: mobileTheme.layout.minTouchTarget,
    justifyContent: 'center',
    width: mobileTheme.layout.minTouchTarget,
  },
  indicatorsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: mobileTheme.spacing.sm,
  },
  disabled: {
    opacity: 0.48,
  },
  mainTapArea: {
    borderRadius: mobileTheme.radius.sm,
  },
  pressed: {
    opacity: 0.78,
  },
  leftAccent: {
    borderRadius: mobileTheme.radius.pill,
    bottom: 0,
    left: mobileTheme.spacing.sm,
    opacity: 0.7,
    position: 'absolute',
    top: mobileTheme.spacing.lg,
    width: 5,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 6,
  },
  metaQuiet: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  metaPill: {
    alignItems: 'center',
    backgroundColor: mobileTheme.glass.fakeBackground,
    borderColor: mobileTheme.glass.border,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  metaPillRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: mobileTheme.spacing.sm,
  },
  metaStrong: {
    color: mobileTheme.colors.text,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  secondaryAction: {
    flex: 1,
  },
  secondaryActionText: {
    color: mobileTheme.colors.accentDark,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.2,
  },
  pillDot: {
    borderRadius: mobileTheme.radius.pill,
    height: 7,
    width: 7,
  },
  statusCircle: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    marginTop: 1,
    width: 22,
  },
  title: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  titleComplete: {
    color: mobileTheme.colors.textMuted,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
});
