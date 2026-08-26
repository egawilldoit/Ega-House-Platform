import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GoalReadModel } from '@ega/api-client';
import { healthTone, mobileTheme, statusTone } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { Chip } from '@/components/mobile/ui/Chip';
import { IconButton } from '@/components/mobile/ui/IconButton';
import { ProgressBar } from '@/components/mobile/ui/ProgressBar';

function formatToken(value: string) {
  return value.replaceAll('_', ' ');
}

export type GoalCardProps = {
  goal: GoalReadModel;
  saving?: boolean;
  onPress: () => void;
  onActions: () => void;
  onAddNextStep?: () => void;
};

export function GoalCard({ goal, saving, onPress, onActions, onAddNextStep }: GoalCardProps) {
  const isDone = goal.status === 'done';
  const progress = Math.max(0, Math.min(100, goal.progressPercent ?? 0));
  const total = goal.linkedTasks.length;
  const completed = goal.linkedTasks.filter((task) => task.status === 'done').length;

  const health = goal.health;
  const hasNextStep = Boolean(goal.nextStep && goal.nextStep.trim().length > 0);

  // Left accent: health hierarchy primary (on_track success, at_risk warning, off_track danger, null neutral)
  const accentColor = health
    ? healthTone(health).color
    : statusTone(goal.status as never).color;

  const healthToneResolved = healthTone(health);

  return (
    <View style={styles.shell}>
      <Card
        variant="plain"
        style={styles.card}
        contentStyle={styles.cardContent}
        accentColor={accentColor}
        testID="goal-card"
      >
        <Pressable
          accessibilityRole="button"
          focusable
          disabled={saving}
          onPress={onPress}
          style={({ pressed }) => [styles.mainTapArea, pressed && !saving ? styles.pressed : null]}
        >
          {/* 1 — What outcome? Title 16/800 */}
          <Text numberOfLines={2} style={[styles.title, isDone ? styles.titleMuted : null]}>
            {goal.title}
          </Text>

          {goal.projectName ? (
            <Text numberOfLines={1} style={styles.projectName}>
              {goal.projectName.toUpperCase()}
            </Text>
          ) : null}

          {/* 2 — Is it healthy? Health primary, status secondary */}
          <View style={styles.badgeRow}>
            <Chip
              kind="health"
              value={health}
              label={health ? formatToken(health) : 'No health'}
              muted={!health}
              style={styles.chip}
              testID="goal-health-chip"
            />
            <Chip
              kind="status"
              value={goal.status}
              label={formatToken(goal.status)}
              style={styles.chipSecondary}
              testID="goal-status-chip"
            />
          </View>

          {/* 3 — What is next move? */}
          {hasNextStep ? (
            <View style={styles.nextStepRow}>
              <Ionicons color={mobileTheme.colors.accent} name="arrow-forward-circle-outline" size={14} />
              <Text numberOfLines={2} style={styles.nextStepText}>
                {goal.nextStep}
              </Text>
            </View>
          ) : (
            <View style={styles.addNextStepWrap}>
              <Button
                title="+ Add next step"
                variant="secondary"
                size="sm"
                leftIconName="add"
                onPress={onAddNextStep ?? onActions}
                disabled={saving}
                testID="goal-add-next-step"
              />
            </View>
          )}

          {/* 4 — Progress: bar + fraction only (no percent duplication) */}
          <View style={styles.progressRow}>
            <ProgressBar
              value={progress}
              max={100}
              color={healthToneResolved.color}
              trackColor={mobileTheme.colors.surfaceMid}
              style={styles.progressTrack}
              testID="goal-progress-bar"
            />
            <Text style={styles.progressLabel}>{`${completed} / ${total} tasks`}</Text>
          </View>
        </Pressable>

        <IconButton
          icon="ellipsis-horizontal"
          accessibilityLabel="Goal actions"
          disabled={saving}
          onPress={onActions}
          variant="ghost"
          size={44}
          iconSize={18}
          style={styles.actionsButton}
          testID="goal-card-actions"
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsButton: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 2,
  },
  addNextStepWrap: {
    alignSelf: 'flex-start',
    marginTop: mobileTheme.spacing.sm,
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
    position: 'relative',
  },
  cardContent: {
    paddingBottom: mobileTheme.spacing.md,
    paddingTop: mobileTheme.spacing.md,
    paddingLeft: mobileTheme.spacing.lg,
    paddingRight: mobileTheme.spacing.xxl,
  },
  chip: {
    minHeight: 26,
    paddingHorizontal: 7,
  },
  chipSecondary: {
    minHeight: 26,
    paddingHorizontal: 7,
    opacity: 0.9,
  },
  mainTapArea: {
    borderRadius: mobileTheme.radius.sm,
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
  pressed: {
    opacity: 0.72,
  },
  progressLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    marginLeft: mobileTheme.spacing.md,
  },
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: mobileTheme.spacing.md,
  },
  progressTrack: {
    flex: 1,
  },
  projectName: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  shell: {
    borderRadius: mobileTheme.radius.card,
    marginBottom: mobileTheme.spacing.sm,
    // plain — no shadow (tonal separation + hairline via Card)
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
    lineHeight: 22,
  },
  titleMuted: {
    color: mobileTheme.colors.textSubtle,
  },
});
