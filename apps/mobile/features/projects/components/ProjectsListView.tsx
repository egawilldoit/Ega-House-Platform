/* eslint-disable react-hooks/exhaustive-deps -- rawProjects fallback array identity is stable via query; filtered memo is intentional */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import type { ProjectStatus, ProjectViewFilter } from '@ega/api-client';
import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { mobileTheme } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';
import { Button } from '@/components/mobile/ui/Button';
import { EmptyState } from '@/components/mobile/ui/EmptyState';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { SearchField } from '@/components/mobile/ui/SearchField';
import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';
import { SkeletonCard } from '@/components/mobile/ui/Skeleton';
import {
  useArchiveProjectMutation,
  useProjectListQuery,
  useUnarchiveProjectMutation,
  useUpdateProjectStatusMutation,
} from '@/features/projects/query';

import { ProjectCard } from './ProjectCard';

const VIEW_OPTIONS: Array<{ label: string; value: ProjectViewFilter }> = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All', value: 'all' },
];

const PROJECT_STATUS_OPTIONS: ProjectStatus[] = ['planned', 'active', 'done', 'paused'];

export function ProjectsListView() {
  const [view, setView] = useState<ProjectViewFilter>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetTargetId, setSheetTargetId] = useState<string | null>(null);

  const projectsQuery = useProjectListQuery(view);
  const updateStatusMutation = useUpdateProjectStatusMutation();
  const archiveMutation = useArchiveProjectMutation();
  const unarchiveMutation = useUnarchiveProjectMutation();

  const isMutating =
    updateStatusMutation.isPending || archiveMutation.isPending || unarchiveMutation.isPending;

  const loadError =
    projectsQuery.error instanceof Error ? projectsQuery.error.message : 'Unable to load projects right now.';

  const rawProjects = projectsQuery.data?.projects ?? [];

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rawProjects;
    return rawProjects.filter((p) => {
      const hay = `${p.name} ${p.slug} ${p.description ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rawProjects, searchQuery]);

  const hasSearch = searchQuery.trim().length > 0;

  const onRefresh = useCallback(() => {
    projectsQuery.refetch().catch(() => {});
  }, [projectsQuery]);

  useFocusEffect(
    useCallback(() => {
      projectsQuery.refetch().catch(() => {});
    }, [projectsQuery]),
  );

  const sheetTarget = useMemo(
    () => rawProjects.find((project) => project.id === sheetTargetId) ?? null,
    [rawProjects, sheetTargetId],
  );

  const sheetItems = useMemo((): ActionSheetItem[] => {
    if (!sheetTarget) return [];

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

  const renderProjectItem = useCallback(
    ({ item }: { item: (typeof filteredProjects)[number] }) => (
      <ProjectCard
        project={item}
        saving={isMutating && sheetTargetId === item.id}
        onActions={() => setSheetTargetId(item.id)}
        onOpen={() => router.push({ pathname: '/(app)/projects/[slug]', params: { slug: item.slug } })}
      />
    ),
    [isMutating, sheetTargetId],
  );

  const isPending = projectsQuery.isPending && !projectsQuery.data;
  const isRefetching = projectsQuery.isFetching && !!projectsQuery.data;
  const isError = projectsQuery.isError && !projectsQuery.data;

  if (isPending) {
    return (
      <View style={styles.skeletonWrap} testID="projects-loading">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.errorWrap} testID="projects-error">
        <Card style={styles.errorCard}>
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={22} color={mobileTheme.colors.danger} />
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        </Card>
        <View style={styles.centered}>
          <Button title="Retry" variant="secondary" onPress={onRefresh} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="projects-list-view">
      <FlatList
        data={filteredProjects}
        keyExtractor={(item) => item.id}
        initialNumToRender={10}
        windowSize={5}
        maxToRenderPerBatch={10}
        removeClippedSubviews={false}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={!!isRefetching}
            onRefresh={onRefresh}
            colors={[mobileTheme.colors.accent]}
            tintColor={mobileTheme.colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <SearchField
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search projects"
              testID="projects-search-field"
            />
            <View style={styles.segmentWrap}>
              <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} testID="projects-view-filter" />
            </View>
            <View style={styles.counterRow}>
              <Text style={styles.counterText}>
                {filteredProjects.length} project{filteredProjects.length === 1 ? '' : 's'}
                {hasSearch ? ` · filtered` : view !== 'all' ? ` · ${view}` : ''}
              </Text>
              {hasSearch ? (
                <Text style={styles.clearText} onPress={() => setSearchQuery('')}>
                  Clear
                </Text>
              ) : null}
            </View>
            {isRefetching ? <Text style={styles.refreshingHint}>Refreshing…</Text> : null}
            {projectsQuery.isError && projectsQuery.data ? <FeedbackBanner message={loadError} tone="danger" style={styles.banner} /> : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Card contentStyle={styles.emptyCardContent}>
              <EmptyState
                icon={view === 'archived' ? 'archive-outline' : 'folder-open-outline'}
                iconSize={36}
                title={
                  hasSearch ? 'No projects match search' : filteredProjects.length === 0 && rawProjects.length === 0 ? (view === 'archived' ? 'No archived projects' : view === 'active' ? 'No projects here yet' : 'No projects') : 'No projects match this view'
                }
                description={
                  hasSearch
                    ? `No results for “${searchQuery.trim()}”.`
                    : view === 'active'
                      ? 'Group goals and tasks under a shared outcome.'
                      : view === 'archived'
                        ? 'Archived projects live here until you need them again.'
                        : 'Nothing to show in this view yet.'
                }
                action={
                  view === 'active' && !hasSearch ? (
                    <Button title="Create your first project" onPress={() => router.push('/(app)/projects/create')} />
                  ) : hasSearch ? (
                    <Button title="Clear search" variant="secondary" onPress={() => setSearchQuery('')} />
                  ) : undefined
                }
              />
            </Card>
          </View>
        }
        renderItem={renderProjectItem}
      />

      <ActionSheet
        items={sheetItems}
        onClose={() => setSheetTargetId(null)}
        subtitle={sheetTarget?.name}
        title="Project actions"
        visible={sheetTargetId !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: mobileTheme.spacing.sm,
  },
  centered: {
    alignItems: 'center',
    marginTop: mobileTheme.spacing.lg,
  },
  clearText: {
    color: mobileTheme.colors.accent,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  container: {
    flex: 1,
  },
  counterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: mobileTheme.spacing.sm,
  },
  counterText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  emptyCardContent: {
    padding: 0,
  },
  emptyWrap: {
    marginTop: mobileTheme.spacing.sm,
  },
  errorCard: {
    marginTop: mobileTheme.spacing.sm,
  },
  errorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    flex: 1,
    fontWeight: mobileTheme.font.semibold,
  },
  errorWrap: {
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  headerWrap: {
    marginBottom: mobileTheme.spacing.sm,
  },
  listContent: {
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  refreshingHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 6,
  },
  segmentWrap: {
    marginTop: mobileTheme.spacing.md,
  },
  skeletonWrap: {
    gap: mobileTheme.spacing.sm,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.md,
  },
});
