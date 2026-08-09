import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import type { ProjectStatus, ProjectViewFilter } from '@ega/api-client';
import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { ProjectCard } from '@/components/mobile/ProjectCard';
import { EmptyState, MobileScreen, MobileScreenHeader, PrimaryFab, SkeletonCard } from '@/components/mobile/primitives';
import { GlassButton, GlassCard, GlassSegmentedControl } from '@/components/mobile/glass';
import { mobileTheme } from '@/components/mobile/theme';
import {
  useArchiveProjectMutation,
  useProjectListQuery,
  useUnarchiveProjectMutation,
  useUpdateProjectStatusMutation,
} from '@/features/projects/query';

const VIEW_OPTIONS: Array<{ label: string; value: ProjectViewFilter }> = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All', value: 'all' },
];

const PROJECT_STATUS_OPTIONS: ProjectStatus[] = ['planned', 'active', 'done', 'paused'];

export default function ProjectsScreen() {
  const [view, setView] = useState<ProjectViewFilter>('active');
  const [sheetTargetId, setSheetTargetId] = useState<string | null>(null);

  const projectsQuery = useProjectListQuery(view);
  const updateStatusMutation = useUpdateProjectStatusMutation();
  const archiveMutation = useArchiveProjectMutation();
  const unarchiveMutation = useUnarchiveProjectMutation();

  const isMutating = useMemo(
    () =>
      updateStatusMutation.isPending ||
      archiveMutation.isPending ||
      unarchiveMutation.isPending,
    [updateStatusMutation.isPending, archiveMutation.isPending, unarchiveMutation.isPending],
  );

  const loadError =
    projectsQuery.error instanceof Error
      ? projectsQuery.error.message
      : 'Unable to load projects right now.';

  const onRefresh = useCallback(() => {
    projectsQuery.refetch().catch(() => {
      // Error state is rendered from the query result.
    });
  }, [projectsQuery]);

  const sheetTarget = useMemo(
    () => projectsQuery.data?.projects.find((project) => project.id === sheetTargetId) ?? null,
    [projectsQuery.data, sheetTargetId],
  );

  const sheetItems = useMemo((): ActionSheetItem[] => {
    if (!sheetTarget) {
      return [];
    }

    const statusItems: ActionSheetItem[] = PROJECT_STATUS_OPTIONS.map((status) => ({
      key: `status-${status}`,
      label: status.replaceAll('_', ' '),
      disabled: sheetTarget.status === status,
      onPress: () => {
        setSheetTargetId(null);
        if (sheetTarget.status !== status) {
          updateStatusMutation.mutate({ projectId: sheetTarget.id, status });
        }
      },
    }));

    const archiveItems: ActionSheetItem[] =
      sheetTarget.status === 'archived'
        ? [
            {
              key: 'unarchive',
              label: 'Unarchive project',
              onPress: () => {
                setSheetTargetId(null);
                unarchiveMutation.mutate(sheetTarget.id);
              },
            },
          ]
        : [
            {
              key: 'archive',
              label: 'Archive project',
              destructive: true,
              onPress: () => {
                setSheetTargetId(null);
                archiveMutation.mutate(sheetTarget.id);
              },
            },
          ];

    return [...statusItems, ...archiveItems];
  }, [sheetTarget, updateStatusMutation, archiveMutation, unarchiveMutation]);

  if (projectsQuery.isLoading) {
    return (
      <MobileScreen>
        <MobileScreenHeader
          eyebrow="Planning"
          title="Projects"
          description="The containers for your goals and tasks"
        />
        <View style={styles.controlsWrap}>
          <GlassSegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </MobileScreen>
    );
  }

  if (projectsQuery.isError) {
    return (
      <MobileScreen>
        <MobileScreenHeader
          eyebrow="Planning"
          title="Projects"
          description="The containers for your goals and tasks"
        />
        <GlassCard variant="fake" style={styles.errorCard} contentStyle={styles.errorCardContent}>
          <Ionicons name="alert-circle-outline" size={22} color={mobileTheme.colors.danger} />
          <Text style={styles.errorText}>{loadError}</Text>
        </GlassCard>
        <View style={styles.centeredContent}>
          <GlassButton title="Retry" onPress={onRefresh} />
        </View>
      </MobileScreen>
    );
  }

  const projects = projectsQuery.data?.projects ?? [];
  const hasProjects = projects.length > 0;

  return (
    <MobileScreen padded={false}>
      <View style={styles.headerWrap}>
        <MobileScreenHeader
          eyebrow="Planning"
          title="Projects"
          description="The containers for your goals and tasks"
        />
        <View style={styles.controlsWrap}>
          <GlassSegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={projects}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            colors={[mobileTheme.colors.accent]}
            onRefresh={onRefresh}
            refreshing={projectsQuery.isFetching && !projectsQuery.isLoading}
            tintColor={mobileTheme.colors.accent}
          />
        }
        ListEmptyComponent={
          <EmptyState
            action={
              view === 'active' ? (
                <GlassButton
                  title="Create your first project"
                  onPress={() => router.push('/projects/create')}
                />
              ) : undefined
            }
            description={
              view === 'active'
                ? 'Group goals and tasks under a shared outcome.'
                : view === 'archived'
                  ? 'Archived projects live here until you need them again.'
                  : 'Nothing to show in this view yet.'
            }
            icon={view === 'archived' ? 'archive-outline' : 'folder-open-outline'}
            iconSize={64}
            title={hasProjects ? 'No projects match this view' : 'No projects here yet'}
          />
        }
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            saving={isMutating && sheetTargetId === item.id}
            onActions={() => setSheetTargetId(item.id)}
            onOpen={() => router.push(`/projects/${item.slug}`)}
          />
        )}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.fabWrap}>
        <PrimaryFab label="New Project" onPress={() => router.push('/projects/create')} />
      </View>

      <ActionSheet
        items={sheetItems}
        onClose={() => setSheetTargetId(null)}
        subtitle={sheetTarget?.name}
        title="Project actions"
        visible={sheetTargetId !== null}
      />
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  centeredContent: {
    alignItems: 'center',
    marginTop: mobileTheme.spacing.lg,
  },
  controlsWrap: {
    marginTop: mobileTheme.spacing.md,
    paddingHorizontal: mobileTheme.spacing.lg,
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
  fabWrap: {
    bottom: mobileTheme.spacing.xl,
    position: 'absolute',
    right: mobileTheme.spacing.lg,
  },
  headerWrap: {
    paddingTop: mobileTheme.spacing.md,
  },
  listContent: {
    paddingBottom: 120,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.md,
  },
  skeletonWrap: {
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
    paddingHorizontal: mobileTheme.spacing.lg,
  },
});
