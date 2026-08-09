import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectCardReadModel, ProjectStatus } from '@ega/api-client';
import { GlassCard, GlassPill } from '@/components/mobile/glass';
import { mobileTheme } from '@/components/mobile/theme';

export function formatProjectToken(value: string) {
  return value.replaceAll('_', ' ');
}

export function projectStatusTone(status: ProjectStatus | string) {
  switch (status) {
    case 'done':
      return { background: '#dcfce7', color: '#15803d', dot: '#22c55e' };
    case 'active':
      return { background: '#dbeafe', color: '#1d4ed8', dot: '#3b82f6' };
    case 'paused':
      return { background: '#fef9c3', color: '#92400e', dot: '#eab308' };
    case 'archived':
      return { background: '#f1f5f9', color: '#64748b', dot: '#94a3b8' };
    default:
      return { background: '#f1f5f9', color: '#475569', dot: '#94a3b8' };
  }
}

export function ProjectCard({
  project,
  saving,
  onOpen,
  onActions,
}: {
  project: ProjectCardReadModel;
  saving?: boolean;
  onOpen: () => void;
  onActions: () => void;
}) {
  const tone = projectStatusTone(project.status);
  const isArchived = project.status === 'archived';
  const isDone = project.status === 'done';
  const progress = Math.max(0, Math.min(100, project.progressPercent ?? 0));

  return (
    <View style={styles.cardShell}>
      <GlassCard variant="fake" style={styles.card} contentStyle={styles.cardContent}>
        <View style={[styles.leftAccent, { backgroundColor: tone.color }]} />
        <Pressable
          disabled={saving}
          onPress={onOpen}
          style={({ pressed }) => [styles.mainTapArea, pressed && !saving ? styles.pressed : null]}
        >
          <View style={styles.titleRow}>
            <Text numberOfLines={2} style={[styles.title, isDone ? styles.titleMuted : null]}>
              {project.name}
            </Text>
            <GlassPill
              label={formatProjectToken(project.status)}
              leftIcon={<View style={[styles.pillDot, { backgroundColor: tone.dot }]} />}
              tone={isDone ? 'success' : isArchived ? 'default' : 'primary'}
            />
          </View>

          {project.description ? (
            <Text numberOfLines={2} style={styles.description}>
              {project.description}
            </Text>
          ) : null}

          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: tone.color, width: `${progress}%` },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>{`${project.completedTaskCount} / ${project.taskCount} tasks`}</Text>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <Ionicons color={mobileTheme.colors.textSubtle} name="git-branch-outline" size={13} />
              <Text style={styles.metaText}>{project.taskCount} tasks</Text>
            </View>
            <View style={styles.metaPill}>
              <Ionicons
                color={mobileTheme.colors.textSubtle}
                name="trending-up-outline"
                size={13}
              />
              <Text style={styles.metaText}>{Math.round(progress)}%</Text>
            </View>
          </View>
        </Pressable>

        <Pressable
          accessibilityLabel="Project actions"
          accessibilityRole="button"
          disabled={saving}
          hitSlop={8}
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
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: 10,
    top: 10,
    width: 36,
    zIndex: 2,
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
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
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
  metaPill: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.lg,
    marginTop: mobileTheme.spacing.sm,
  },
  metaText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
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
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.md,
    marginTop: mobileTheme.spacing.md,
  },
  progressTrack: {
    backgroundColor: 'rgba(100,116,139,0.14)',
    borderRadius: 3,
    flex: 1,
    height: 6,
    overflow: 'hidden',
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
