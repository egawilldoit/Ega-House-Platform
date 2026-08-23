import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GoalHealth, GoalReadModel } from '@ega/api-client';
import { GlassCard, GlassPill } from '@/components/mobile/glass';
import { mobileTheme } from '@/components/mobile/theme';

export function formatGoalToken(value: string) {
  return value.replaceAll('_', ' ');
}

export function goalHealthTone(health: GoalHealth | null) {
  switch (health) {
    case 'on_track':
      return { background: '#dcfce7', color: '#15803d', dot: '#22c55e' };
    case 'at_risk':
      return { background: '#fef9c3', color: '#92400e', dot: '#eab308' };
    case 'off_track':
      return { background: '#fee2e2', color: '#dc2626', dot: '#ef4444' };
    default:
      return { background: '#f1f5f9', color: '#64748b', dot: '#94a3b8' };
  }
}

export function goalStatusTone(status: string) {
  switch (status) {
    case 'done':
      return { background: '#dcfce7', color: '#15803d', dot: '#22c55e' };
    case 'active':
      return { background: '#dbeafe', color: '#1d4ed8', dot: '#3b82f6' };
    case 'paused':
      return { background: '#fef9c3', color: '#92400e', dot: '#eab308' };
    default:
      return { background: '#f1f5f9', color: '#475569', dot: '#94a3b8' };
  }
}

export function GoalCard({
  goal,
  saving,
  onPress,
  onActions,
}: {
  goal: GoalReadModel;
  saving?: boolean;
  onPress?: () => void;
  onActions: () => void;
}) {
  const healthTone = goalHealthTone(goal.health);
  const statusTone = goalStatusTone(goal.status);
  const isDone = goal.status === 'done';
  const progress = Math.max(0, Math.min(100, goal.progressPercent ?? 0));

  return (
    <View style={styles.cardShell}>
      <GlassCard variant="fake" style={styles.card} contentStyle={styles.cardContent}>
        <View style={[styles.leftAccent, { backgroundColor: healthTone.color }]} />
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={onPress ?? onActions}
          style={({ pressed }) => [styles.mainTapArea, pressed && !saving ? styles.pressed : null]}
        >
          <View style={styles.titleRow}>
            <Text numberOfLines={2} style={[styles.title, isDone ? styles.titleMuted : null]}>
              {goal.title}
            </Text>
          </View>

          {goal.projectName ? (
            <Text numberOfLines={1} style={styles.projectName}>
              {goal.projectName.toUpperCase()}
            </Text>
          ) : null}

          <View style={styles.badgeRow}>
            <GlassPill
              label={formatGoalToken(goal.status)}
              leftIcon={<View style={[styles.pillDot, { backgroundColor: statusTone.dot }]} />}
              tone={isDone ? 'success' : 'primary'}
            />
            <GlassPill
              label={goal.health ? formatGoalToken(goal.health) : 'No health set'}
              leftIcon={<View style={[styles.pillDot, { backgroundColor: healthTone.dot }]} />}
              tone={
                goal.health === 'off_track'
                  ? 'danger'
                  : goal.health === 'at_risk'
                    ? 'warning'
                    : 'default'
              }
            />
          </View>

          {goal.nextStep ? (
            <View style={styles.nextStepRow}>
              <Ionicons color={mobileTheme.colors.accent} name="arrow-forward-circle-outline" size={14} />
              <Text numberOfLines={2} style={styles.nextStepText}>
                {goal.nextStep}
              </Text>
            </View>
          ) : null}

          <View style={styles.footerRow}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: healthTone.color, width: `${progress}%` },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>{`${Math.round(progress)}% · ${goal.linkedTasks.length} tasks`}</Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityLabel="Goal actions"
          accessibilityRole="button"
          disabled={saving}
          onPress={onActions}
          style={({ pressed }) => [styles.actionsButton, pressed ? styles.pressed : null]}
        >
          <Ionicons color={mobileTheme.colors.textSubtle} name="ellipsis-horizontal" size={18} />
        </Pressable>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsButton: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    height: mobileTheme.layout.minTouchTarget,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
    width: mobileTheme.layout.minTouchTarget,
    zIndex: 2,
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.sm,
  },
  card: {
    overflow: 'hidden',
  },
  cardContent: {
    paddingBottom: mobileTheme.spacing.md,
    paddingTop: mobileTheme.spacing.md,
  },
  cardShell: {
    marginBottom: mobileTheme.spacing.sm,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.md,
    marginTop: mobileTheme.spacing.md,
  },
  leftAccent: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 3,
  },
  mainTapArea: {
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingRight: mobileTheme.spacing.xxl,
  },
  nextStepRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 6,
    marginTop: mobileTheme.spacing.sm,
  },
  nextStepText: {
    color: mobileTheme.colors.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  pillDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  pressed: {
    opacity: 0.72,
  },
  progressFill: {
    borderRadius: 3,
    height: '100%',
  },
  progressLabel: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
  },
  progressTrack: {
    backgroundColor: 'rgba(100,116,139,0.14)',
    borderRadius: 3,
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
  projectName: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  title: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  titleMuted: {
    color: mobileTheme.colors.textSubtle,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
});
