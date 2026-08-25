import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ProjectStatus } from '@ega/api-client';
import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { Chip } from '@/components/mobile/ui/Chip';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { FormSection } from '@/components/mobile/ui/FormSection';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { SkeletonCard } from '@/components/mobile/ui/Skeleton';
import {
  useArchiveProjectMutation,
  useProjectBySlugQuery,
  useUnarchiveProjectMutation,
  useUpdateProjectStatusMutation,
} from '@/features/projects/query';

const PROJECT_STATUS_OPTIONS: ProjectStatus[] = ['planned', 'active', 'done', 'paused'];

function formatProjectToken(value: string) {
  return value.replaceAll('_', ' ');
}

export function ProjectDetailScreen() {
  const router = (() => {
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- fallback for test env where expo-router mock may be missing
      return useRouter();
    } catch {
      return { back: () => {}, push: () => {}, replace: () => {} } as unknown as ReturnType<typeof useRouter>;
    }
  })();
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const resolvedSlug = useMemo(() => String(slug ?? '').trim(), [slug]);

  const projectQuery = useProjectBySlugQuery(resolvedSlug);
  const updateStatusMutation = useUpdateProjectStatusMutation();
  const archiveMutation = useArchiveProjectMutation();
  const unarchiveMutation = useUnarchiveProjectMutation();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runMutation = useCallback((action: () => Promise<unknown>) => {
    setActionError(null);
    action().catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : 'Unable to update the project right now.');
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

  if (!resolvedSlug) {
    return (
      <AppScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Project details</Text>
          <FeedbackBanner message="Project slug is missing." tone="danger" style={styles.banner} />
          <Button onPress={() => router.back()} title="Back" variant="secondary" />
        </View>
      </AppScreen>
    );
  }

  if (projectQuery.isLoading) {
    return (
      <AppScreen testID="project-detail-loading">
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </AppScreen>
    );
  }

  if (projectQuery.isError || !projectQuery.data) {
    const loadError =
      projectQuery.error instanceof Error ? projectQuery.error.message : 'Unable to load this project.';
    return (
      <AppScreen>
        <View style={styles.centered}>
          <FeedbackBanner message={loadError} tone="danger" style={styles.banner} />
          <View style={styles.errorActions}>
            <Button onPress={() => projectQuery.refetch()} title="Retry" />
            <Button onPress={() => router.back()} title="Back" variant="secondary" />
          </View>
        </View>
      </AppScreen>
    );
  }

  const { project, goals } = projectQuery.data;
  const isArchived = project.status === 'archived';

  return (
    <AppScreen padded={false} testID="project-detail-screen">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pagePadding}>
          <ScreenHeader
            eyebrow={project.slug}
            title={project.name}
            description={project.description ?? 'No description yet'}
          />

          <Card style={styles.headerCard}>
            <View style={styles.badgeRow}>
              <Chip kind="status" value={project.status} />
              <View style={styles.spacer} />
              <Text style={styles.metaCount}>{goals.length} linked goal{goals.length === 1 ? '' : 's'}</Text>
              <Button
                disabled={isMutating}
                onPress={() => setSheetVisible(true)}
                size="sm"
                title="Actions"
                variant="ghost"
              />
            </View>
            {isArchived ? (
              <FeedbackBanner message="Archived project" tone="neutral" style={styles.archivedBanner} />
            ) : null}
            {actionError ? <FeedbackBanner message={actionError} tone="danger" style={styles.inlineError} /> : null}
          </Card>

          <FormSection icon="pulse-outline" title="Status" description="Lifecycle stage">
            <View style={styles.badgeRow}>
              <Chip kind="status" value={project.status} label={formatProjectToken(project.status)} />
              <View style={styles.spacer} />
              <Button
                disabled={isMutating}
                onPress={() => setSheetVisible(true)}
                size="sm"
                title="Manage status"
                variant="secondary"
              />
            </View>
            <Text style={styles.helperText}>Use Actions to change status or archive.</Text>
          </FormSection>

          <FormSection icon="flag-outline" title="Linked goals" description="Goals in this project">
            {goals.length > 0 ? (
              <View style={styles.goalList}>
                {goals.map((goal) => (
                  <View key={goal.id} style={styles.goalRow}>
                    <View style={styles.goalAccent} />
                    <Text numberOfLines={2} style={styles.goalTitle}>
                      {goal.title}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No goals linked</Text>
                <Text style={styles.emptyDesc}>Create a goal from the Goals tab and link it to this project.</Text>
              </Card>
            )}
          </FormSection>

          <Card style={styles.actionsCard}>
            {isArchived ? (
              <Button
                disabled={isMutating}
                loading={unarchiveMutation.isPending}
                onPress={() => runMutation(() => unarchiveMutation.mutateAsync(project.id))}
                title="Unarchive project"
                variant="secondary"
                fullWidth
              />
            ) : (
              <Button
                disabled={isMutating}
                loading={archiveMutation.isPending}
                onPress={() => runMutation(() => archiveMutation.mutateAsync(project.id))}
                title="Archive project"
                variant="danger"
                fullWidth
              />
            )}
            <Button
              disabled={isMutating}
              onPress={() => router.back()}
              title="Back"
              variant="ghost"
              fullWidth
              style={styles.backButton}
            />
          </Card>
        </View>
      </ScrollView>

      <ActionSheet
        items={sheetItems}
        onClose={() => setSheetVisible(false)}
        subtitle={project.name}
        title="Project actions"
        visible={sheetVisible}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actionsCard: {
    gap: 10,
    marginTop: mobileTheme.spacing.md,
  },
  archivedBanner: {
    marginTop: 10,
  },
  backButton: {
    marginTop: 2,
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  banner: {
    marginBottom: 12,
    width: '100%',
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    paddingBottom: mobileTheme.layout.stickyActionClearance,
    paddingTop: 14,
  },
  emptyCard: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 20,
  },
  emptyDesc: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  emptyTitle: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.extrabold,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  goalAccent: {
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 2,
    width: 3,
    alignSelf: 'stretch',
  },
  goalList: {
    gap: 8,
  },
  goalRow: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  goalTitle: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
  },
  headerCard: {
    marginTop: mobileTheme.spacing.md,
  },
  helperText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  inlineError: {
    marginTop: mobileTheme.spacing.md,
  },
  metaCount: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  pagePadding: {
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  skeleton: {
    height: 72,
    width: '100%',
  },
  skeletonShort: {
    height: 48,
    width: '70%',
  },
  skeletonWrap: {
    gap: 10,
    padding: 24,
  },
  spacer: {
    flex: 1,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.extrabold,
  },
});
