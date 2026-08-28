import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectCardReadModel } from '@ega/api-client';
import { mobileTheme, statusTone } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';
import { Chip } from '@/components/mobile/ui/Chip';
import { ProgressBar } from '@/components/mobile/ui/ProgressBar';
import { IconButton } from '@/components/mobile/ui/IconButton';

function formatProjectStatus(value: string) {
  return value.replaceAll('_', ' ');
}

export type ProjectCardProps = {
  project: ProjectCardReadModel;
  saving?: boolean;
  onOpen: () => void;
  onActions: () => void;
};
export function ProjectCard({ project, saving, onOpen, onActions }: ProjectCardProps) {
  const isDone = project.status === 'done';
  const progress = Math.max(0, Math.min(100, project.progressPercent ?? 0));

  const statusValue = project.status;
  const statusColors = statusTone(statusValue as never);

  return (
    <View style={styles.shell}>
      <Card
        variant="plain"
        style={styles.card}
        contentStyle={styles.cardContent}
        accentColor={statusColors.color}
        testID="project-card"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={project.name}
          accessibilityHint="Open project details"
          disabled={saving}
          onPress={onOpen}
          style={({ pressed }) => [styles.mainTapArea, pressed && !saving ? styles.pressed : null]}
        >
          {/* name + status */}
          <View style={styles.titleRow}>
            <Text numberOfLines={2} style={[styles.title, isDone ? styles.titleMuted : null]}>
              {project.name}
            </Text>
            <Chip kind="status" value={statusValue} label={formatProjectStatus(project.status)} style={styles.statusChip} testID="project-status-chip" />
          </View>

          {project.description ? (
            <Text numberOfLines={2} style={styles.description}>
              {project.description}
            </Text>
          ) : null}

          {/* progress bar + fraction only (6/7 not 86%) */}
          <View style={styles.progressRow}>
            <ProgressBar value={progress} max={100} trackColor={mobileTheme.colors.surfaceMid} style={styles.progressTrack} testID="project-progress-bar" />
            <Text style={styles.progressLabel}>{`${project.completedTaskCount} / ${project.taskCount} tasks`}</Text>
          </View>
        </Pressable>

        <IconButton
          icon="ellipsis-horizontal"
          accessibilityLabel="Project actions"
          disabled={saving}
          onPress={onActions}
          variant="ghost"
          size={44}
          iconSize={18}
          style={styles.actionsButton}
          testID="project-card-actions"
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
  card: {
    overflow: 'hidden',
    position: 'relative',
  },
  cardContent: {
    paddingBottom: mobileTheme.spacing.md,
    paddingTop: mobileTheme.spacing.md,
    paddingRight: mobileTheme.spacing.xxl,
    paddingLeft: mobileTheme.spacing.lg,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  mainTapArea: {
    borderRadius: mobileTheme.radius.sm,
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
  shell: {
    borderRadius: mobileTheme.radius.card,
    marginBottom: mobileTheme.spacing.sm,
    // plain — no shadow
  },
  statusChip: {
    minHeight: 26,
    paddingHorizontal: 7,
  },
  title: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
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
