import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, RefreshControl, StyleSheet, Text, View } from 'react-native';

import type { GoalHealth, GoalStatus, GoalViewFilter } from '@ega/api-client';
import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { GoalCard } from '@/components/mobile/GoalCard';
import { EmptyState, MobileScreen, MobileScreenHeader, PrimaryFab, SkeletonCard } from '@/components/mobile/primitives';
import { GlassBottomSheet, GlassButton, GlassCard, GlassInput, GlassSegmentedControl } from '@/components/mobile/glass';
import { HeaderActions } from '@/components/mobile/ui/HeaderActions';
import { mobileTheme } from '@/components/mobile/theme';
import {
  useArchiveGoalMutation,
  useGoalListQuery,
  useUnarchiveGoalMutation,
  useUpdateGoalHealthMutation,
  useUpdateGoalNextStepMutation,
  useUpdateGoalStatusMutation,
} from '@/features/goals/query';

const VIEW_OPTIONS: Array<{ label: string; value: GoalViewFilter }> = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All', value: 'all' },
];

const GOAL_STATUS_OPTIONS: GoalStatus[] = ['draft', 'active', 'done', 'paused'];
const GOAL_HEALTH_OPTIONS: GoalHealth[] = ['on_track', 'at_risk', 'off_track'];

export default function GoalsScreen() {
  const [view, setView] = useState<GoalViewFilter>('active');
  const [sheetTargetId, setSheetTargetId] = useState<string | null>(null);
  const [nextStepTargetId, setNextStepTargetId] = useState<string | null>(null);
  const [nextStepDraft, setNextStepDraft] = useState('');

  const goalsQuery = useGoalListQuery(view);
  const updateStatusMutation = useUpdateGoalStatusMutation();
  const updateHealthMutation = useUpdateGoalHealthMutation();
  const updateNextStepMutation = useUpdateGoalNextStepMutation();
  const archiveMutation = useArchiveGoalMutation();
  const unarchiveMutation = useUnarchiveGoalMutation();

  const isMutating = useMemo(
    () =>
      updateStatusMutation.isPending ||
      updateHealthMutation.isPending ||
      updateNextStepMutation.isPending ||
      archiveMutation.isPending ||
      unarchiveMutation.isPending,
    [
      updateStatusMutation.isPending,
      updateHealthMutation.isPending,
      updateNextStepMutation.isPending,
      archiveMutation.isPending,
      unarchiveMutation.isPending,
    ],
  );

  const loadError =
    goalsQuery.error instanceof Error
      ? goalsQuery.error.message
      : 'Unable to load goals right now.';

  const onRefresh = useCallback(() => {
    goalsQuery.refetch().catch(() => {
      // Error state is rendered from the query result.
    });
  }, [goalsQuery]);

  const sheetTarget = useMemo(
    () => goalsQuery.data?.goals.find((goal) => goal.id === sheetTargetId) ?? null,
    [goalsQuery.data, sheetTargetId],
  );

  const nextStepTarget = useMemo(
    () => goalsQuery.data?.goals.find((goal) => goal.id === nextStepTargetId) ?? null,
    [goalsQuery.data, nextStepTargetId],
  );

  const openNextStepEditor = useCallback(
    (goalId: string) => {
      setSheetTargetId(null);
      const goal = goalsQuery.data?.goals.find((item) => item.id === goalId) ?? null;
      setNextStepDraft(goal?.nextStep ?? '');
      setNextStepTargetId(goalId);
    },
    [goalsQuery.data],
  );

  const saveNextStep = useCallback(() => {
    if (!nextStepTarget) {
      return;
    }

    const normalized = nextStepDraft.trim();
    const nextValue = normalized.length > 0 ? normalized : null;
    if (nextValue !== nextStepTarget.nextStep) {
      updateNextStepMutation.mutate({ goalId: nextStepTarget.id, nextStep: nextValue });
    }
    setNextStepTargetId(null);
  }, [nextStepTarget, nextStepDraft, updateNextStepMutation]);

  const sheetItems = useMemo((): ActionSheetItem[] => {
    if (!sheetTarget) {
      return [];
    }

    const statusItems: ActionSheetItem[] = GOAL_STATUS_OPTIONS.map((status) => ({
      key: `status-${status}`,
      label: status.replaceAll('_', ' '),
      disabled: sheetTarget.status === status,
      onPress: () => {
        setSheetTargetId(null);
        if (sheetTarget.status !== status) {
          updateStatusMutation.mutate({ goalId: sheetTarget.id, status });
        }
      },
    }));

    const healthItems: ActionSheetItem[] = GOAL_HEALTH_OPTIONS.map((health) => ({
      key: `health-${health}`,
      label: health.replaceAll('_', ' '),
      disabled: sheetTarget.health === health,
      onPress: () => {
        setSheetTargetId(null);
        if (sheetTarget.health !== health) {
          updateHealthMutation.mutate({ goalId: sheetTarget.id, health });
        }
      },
    }));

    const archiveItems: ActionSheetItem[] =
      sheetTarget.status === 'archived'
        ? [
            {
              key: 'unarchive',
              label: 'Unarchive goal',
              onPress: () => {
                setSheetTargetId(null);
                unarchiveMutation.mutate(sheetTarget.id);
              },
            },
          ]
        : [
            {
              key: 'next-step',
              label: 'Update next step',
              onPress: () => openNextStepEditor(sheetTarget.id),
            },
            {
              key: 'archive',
              label: 'Archive goal',
              destructive: true,
              onPress: () => {
                setSheetTargetId(null);
                archiveMutation.mutate(sheetTarget.id);
              },
            },
          ];

    return [...statusItems, ...healthItems, ...archiveItems];
  }, [sheetTarget, updateStatusMutation, updateHealthMutation, archiveMutation, unarchiveMutation, openNextStepEditor]);

  if (goalsQuery.isLoading) {
    return (
      <MobileScreen>
        <MobileScreenHeader
          eyebrow="Planning"
          title="Goals"
          description="Outcomes with a health signal and a next step"
          rightAction={<HeaderActions />}
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

  if (goalsQuery.isError) {
    return (
      <MobileScreen>
        <MobileScreenHeader
          eyebrow="Planning"
          title="Goals"
          description="Outcomes with a health signal and a next step"
          rightAction={<HeaderActions />}
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

  const goals = goalsQuery.data?.goals ?? [];
  const hasGoals = goals.length > 0;

  return (
    <MobileScreen padded={false}>
      <View style={styles.headerWrap}>
        <MobileScreenHeader
          eyebrow="Planning"
          title="Goals"
          description="Outcomes with a health signal and a next step"
          rightAction={<HeaderActions />}
        />
        <View style={styles.controlsWrap}>
          <GlassSegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={goals}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            colors={[mobileTheme.colors.accent]}
            onRefresh={onRefresh}
            refreshing={goalsQuery.isFetching && !goalsQuery.isLoading}
            tintColor={mobileTheme.colors.accent}
          />
        }
        ListEmptyComponent={
          <EmptyState
            action={
              view === 'active' ? (
                <GlassButton
                  title="Create your first goal"
                  onPress={() => router.push('/goals/create')}
                />
              ) : undefined
            }
            description={
              view === 'active'
                ? 'Define an outcome, keep its health honest, and name the next step.'
                : view === 'archived'
                  ? 'Archived goals live here until you need them again.'
                  : 'Nothing to show in this view yet.'
            }
            icon={view === 'archived' ? 'archive-outline' : 'flag-outline'}
            iconSize={64}
            title={hasGoals ? 'No goals match this view' : 'No goals here yet'}
          />
        }
        renderItem={({ item }) => (
          <GoalCard
            goal={item}
            saving={isMutating && sheetTargetId === item.id}
            onPress={() => router.push(`/goals/${item.id}`)}
            onActions={() => setSheetTargetId(item.id)}
          />
        )}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.fabWrap}>
        <PrimaryFab label="New Goal" onPress={() => router.push('/goals/create')} />
      </View>

      <ActionSheet
        items={sheetItems}
        onClose={() => setSheetTargetId(null)}
        subtitle={sheetTarget?.title}
        title="Goal actions"
        visible={sheetTargetId !== null}
      />

      <Modal
        animationType="slide"
        onRequestClose={() => setNextStepTargetId(null)}
        transparent
        visible={nextStepTargetId !== null}
      >
        <View style={styles.modalBackdrop}>
          <GlassBottomSheet contentStyle={styles.sheetContent}>
            <Text style={styles.sheetTitle}>Next step</Text>
            <Text numberOfLines={1} style={styles.sheetSubtitle}>
              {nextStepTarget?.title}
            </Text>
            <GlassInput
              autoCapitalize="sentences"
              label="What is the next action?"
              multiline
              onChangeText={setNextStepDraft}
              placeholder="e.g. Draft the project brief"
              style={styles.nextStepInput}
              value={nextStepDraft}
            />
            <View style={styles.sheetActions}>
              <GlassButton
                title="Cancel"
                onPress={() => setNextStepTargetId(null)}
                variant="ghost"
              />
              <GlassButton
                loading={updateNextStepMutation.isPending}
                title="Save"
                onPress={saveNextStep}
              />
            </View>
          </GlassBottomSheet>
        </View>
      </Modal>
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
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.md,
  },
  modalBackdrop: {
    backgroundColor: 'rgba(15,23,42,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  nextStepInput: {
    minHeight: 96,
    marginTop: mobileTheme.spacing.md,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.md,
    justifyContent: 'flex-end',
    marginTop: mobileTheme.spacing.lg,
  },
  sheetContent: {
    paddingTop: mobileTheme.spacing.lg,
  },
  sheetSubtitle: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 13,
    marginTop: 2,
  },
  sheetTitle: {
    color: mobileTheme.colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  skeletonWrap: {
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
    paddingHorizontal: mobileTheme.spacing.lg,
  },
});
