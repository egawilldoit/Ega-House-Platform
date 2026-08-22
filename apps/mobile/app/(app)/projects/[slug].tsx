import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { ProjectStatus } from '@ega/api-client';
import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { EmptyState, MobileScreen, MobileScreenHeader, SkeletonCard } from '@/components/mobile/primitives';
import { GlassButton, GlassCard, GlassPill } from '@/components/mobile/glass';
import { mobileTheme } from '@/components/mobile/theme';
import { formatProjectToken, projectStatusTone } from '@/components/mobile/ProjectCard';
import {
  useArchiveProjectMutation,
  useProjectBySlugQuery,
  useUnarchiveProjectMutation,
  useUpdateProjectStatusMutation,
} from '@/features/projects/query';

const PROJECT_STATUS_OPTIONS: ProjectStatus[] = ['planned', 'active', 'done', 'paused'];

export default function ProjectDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const projectQuery = useProjectBySlugQuery(slug);
  const updateStatusMutation = useUpdateProjectStatusMutation();
  const archiveMutation = useArchiveProjectMutation();
  const unarchiveMutation = useUnarchiveProjectMutation();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runMutation = useCallback((action: () => Promise<unknown>) => {
    setActionError(null);
    action().catch((error: unknown) => {
      setActionError(
        error instanceof Error ? error.message : 'Unable to update the project right now.',
      );
    });
  }, []);

  const isMutating =
    updateStatusMutation.isPending || archiveMutation.isPending || unarchiveMutation.isPending;

  const sheetItems = useMemo((): ActionSheetItem[] => {
    const project = projectQuery.data?.project;
    if (!project) {
      return [];
    }

    const statusItems: ActionSheetItem[] = PROJECT_STATUS_OPTIONS.map((status) => ({
      key: `status-${status}`,
      label: formatProjectToken(status),
      disabled: isMutating || project.status === status,
      onPress: () => {
        if (project.status !== status) {
          runMutation(() => updateStatusMutation.mutateAsync({ projectId: project.id, status }));
        }
      },
    }));

    const archiveItems: ActionSheetItem[] =
      project.status === 'archived'
        ? [
            {
              key: 'unarchive',
              label: 'Unarchive project',
              disabled: isMutating,
              onPress: () => {
                runMutation(() => unarchiveMutation.mutateAsync(project.id));
              },
            },
          ]
        : [
            {
              key: 'archive',
              label: 'Archive project',
              destructive: true,
              disabled: isMutating,
              onPress: () => {
                runMutation(() => archiveMutation.mutateAsync(project.id));
              },
            },
          ];

    return [...statusItems, ...archiveItems];
  }, [
    archiveMutation,
    isMutating,
    projectQuery.data,
    runMutation,
    unarchiveMutation,
    updateStatusMutation,
  ]);

  if (projectQuery.isLoading) {
    return (
      <MobileScreen>
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </MobileScreen>
    );
  }

  if (projectQuery.isError || !projectQuery.data) {
    const loadError =
      projectQuery.error instanceof Error
        ? projectQuery.error.message
        : 'Unable to load this project.';
    return (
      <MobileScreen>
        <GlassCard variant="fake" style={styles.errorCard} contentStyle={styles.errorCardContent}>
          <Ionicons name="alert-circle-outline" size={22} color={mobileTheme.colors.danger} />
          <Text style={styles.errorText}>{loadError}</Text>
        </GlassCard>
        <View style={styles.centeredContent}>
          <GlassButton title="Retry" onPress={() => projectQuery.refetch()} />
        </View>
      </MobileScreen>
    );
  }

  const { project, goals } = projectQuery.data;
  const tone = projectStatusTone(project.status);

  return (
    <MobileScreen padded={false}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={goals}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <MobileScreenHeader
              eyebrow={project.slug}
              title={project.name}
              description={project.description ?? 'No description yet'}
            />
            <View style={styles.badgeRow}>
              <GlassPill
                label={formatProjectToken(project.status)}
                leftIcon={<View style={[styles.pillDot, { backgroundColor: tone.dot }]} />}
                tone={project.status === 'done' ? 'success' : 'primary'}
              />
              <View style={styles.actionsSpacer} />
              <GlassButton
                disabled={isMutating}
                size="sm"
                title="Actions"
                variant="ghost"
                onPress={() => setSheetVisible(true)}
              />
            </View>
            {actionError ? (
              <View style={styles.feedbackError}>
                <Ionicons name="alert-circle" size={16} color={mobileTheme.colors.danger} />
                <Text style={styles.feedbackErrorText}>{actionError}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="flag-outline"
            iconSize={56}
            title="No goals linked"
            description="Create a goal from the Goals tab and link it to this project."
          />
        }
        renderItem={({ item }) => (
          <View style={styles.goalRow}>
            <View style={[styles.goalAccent, { backgroundColor: tone.color }]} />
            <View style={styles.goalCopy}>
              <Text numberOfLines={2} style={styles.goalTitle}>
                {item.title}
              </Text>
            </View>
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />

      <ActionSheet
        items={sheetItems}
        onClose={() => setSheetVisible(false)}
        subtitle={project.name}
        title="Project actions"
        visible={sheetVisible}
      />
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  actionsSpacer: {
    flex: 1,
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginBottom: mobileTheme.spacing.md,
    marginTop: mobileTheme.spacing.sm,
  },
  centeredContent: {
    alignItems: 'center',
    marginTop: mobileTheme.spacing.lg,
  },
  errorCard: {
    marginHorizontal: mobileTheme.spacing.lg,
    marginTop: mobileTheme.spacing.lg,
  },
  errorCardContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
  errorText: {
    color: mobileTheme.colors.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  feedbackError: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.dangerBg,
    borderRadius: mobileTheme.radius.md,
    flexDirection: 'row',
    gap: 8,
    marginBottom: mobileTheme.spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  feedbackErrorText: {
    color: mobileTheme.colors.danger,
    flex: 1,
    fontWeight: mobileTheme.font.semibold,
  },
  goalAccent: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 3,
  },
  goalCopy: {
    flex: 1,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: mobileTheme.spacing.md,
  },
  goalRow: {
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: mobileTheme.radius.lg,
    marginBottom: mobileTheme.spacing.sm,
    overflow: 'hidden',
  },
  goalStatus: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 2,
  },
  goalTitle: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  listContent: {
    paddingBottom: 40,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.md,
  },
  pillDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  skeletonWrap: {
    gap: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.lg,
  },
});
