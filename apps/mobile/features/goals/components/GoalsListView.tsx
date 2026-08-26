import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import type { GoalHealth, GoalReadModel, GoalStatus, GoalViewFilter } from '@ega/api-client';
import { ActionSheet, type ActionSheetItem } from '@/components/mobile/ActionSheet';
import { useBottomChromeMetrics } from '@/components/mobile/navigation/bottomChrome';
import { mobileTheme } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { EmptyState } from '@/components/mobile/ui/EmptyState';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';
import { SkeletonCard } from '@/components/mobile/ui/Skeleton';
import {
  useArchiveGoalMutation,
  useGoalListQuery,
  useUnarchiveGoalMutation,
  useUpdateGoalHealthMutation,
  useUpdateGoalNextStepMutation,
  useUpdateGoalStatusMutation,
} from '@/features/goals/query';

import { GoalCard } from './GoalCard';

const VIEW_OPTIONS: Array<{ label: string; value: GoalViewFilter }> = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All', value: 'all' },
];

const GOAL_STATUS_OPTIONS: GoalStatus[] = ['draft', 'active', 'done', 'paused'];
const GOAL_HEALTH_OPTIONS: GoalHealth[] = ['on_track', 'at_risk', 'off_track'];

export function GoalsListView() {
  const { contentBottomPadding } = useBottomChromeMetrics();
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

  const isMutating =
    updateStatusMutation.isPending ||
    updateHealthMutation.isPending ||
    updateNextStepMutation.isPending ||
    archiveMutation.isPending ||
    unarchiveMutation.isPending;

  const loadError =
    goalsQuery.error instanceof Error ? goalsQuery.error.message : 'Unable to load goals right now.';

  const onRefresh = useCallback(() => {
    goalsQuery.refetch().catch(() => {});
  }, [goalsQuery.refetch]);

  useFocusEffect(
    useCallback(() => {
      goalsQuery.refetch().catch(() => {});
    }, [goalsQuery.refetch]),
  );

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
    if (!nextStepTarget) return;
    const normalized = nextStepDraft.trim();
    const nextValue = normalized.length > 0 ? normalized : null;
    if (nextValue !== nextStepTarget.nextStep) {
      updateNextStepMutation.mutate({ goalId: nextStepTarget.id, nextStep: nextValue });
    }
    setNextStepTargetId(null);
  }, [nextStepTarget, nextStepDraft, updateNextStepMutation]);

  const sheetItems = useMemo((): ActionSheetItem[] => {
    if (!sheetTarget) return [];

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

  const renderGoalItem = useCallback(
    ({ item }: { item: GoalReadModel }) => (
      <GoalCard
        goal={item}
        saving={isMutating && sheetTargetId === item.id}
        onPress={() => router.push({ pathname: '/(app)/goals/[id]', params: { id: item.id } })}
        onActions={() => setSheetTargetId(item.id)}
        onAddNextStep={() => openNextStepEditor(item.id)}
      />
    ),
    [isMutating, sheetTargetId, openNextStepEditor],
  );

  // Perceived performance: skeleton only on cold start; stale list + “Refreshing…” banner on background fetch.
  const isPending = goalsQuery.isPending && !goalsQuery.data;
  const isRefetching = goalsQuery.isFetching && !!goalsQuery.data;
  const isError = goalsQuery.isError && !goalsQuery.data;

  if (isPending) {
    return (
      <View style={styles.skeletonWrap} testID="goals-loading">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.errorWrap} testID="goals-error">
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

  const goals = goalsQuery.data?.goals ?? [];

  return (
    <View style={styles.container} testID="goals-list-view">
      <FlatList
        // FlatList tuning (Wave 10.11): RN defaults baseline — same as ProjectsListView.
        // `initialNumToRender={10}` default; `maxToRenderPerBatch={10}` default; `windowSize` omitted → default 21
        // (vs 5: 5 caused blank on fast fling; 21 cheap for 10-40 goals). No `getItemLayout` (GoalCard height variable:
        // next-step 1-2 lines, progress row). `removeClippedSubviews` omitted → default recycling.
        data={goals}
        keyExtractor={(item) => item.id}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        contentContainerStyle={[styles.listContent, { paddingBottom: contentBottomPadding }]}
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
            <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} testID="goals-view-filter" />
            <View style={styles.counterRow}>
              <Text style={styles.counterText}>
                {goals.length} goal{goals.length === 1 ? '' : 's'}
                {view !== 'all' ? ` · ${view}` : ''}
              </Text>
            </View>
            {isRefetching ? <Text style={styles.refreshingHint}>Refreshing…</Text> : null}
            {goalsQuery.isError && goalsQuery.data ? (
              <FeedbackBanner message={loadError} tone="danger" style={styles.banner} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <EmptyState
              icon={view === 'archived' ? 'archive-outline' : 'flag-outline'}
              iconSize={36}
              title={
                goals.length === 0
                  ? view === 'archived'
                    ? 'No archived goals'
                    : view === 'active'
                      ? 'No goals here yet'
                      : 'No goals'
                  : 'No goals match this view'
              }
              description={
                view === 'active'
                  ? 'Define an outcome, keep its health honest, and name the next step.'
                  : view === 'archived'
                    ? 'Archived goals live here until you need them again.'
                    : 'Nothing to show in this view yet.'
              }
              action={
                view === 'active' ? (
                  <Button title="Create your first goal" onPress={() => router.push('/(app)/goals/create')} />
                ) : undefined
              }
            />
          </View>
        }
        renderItem={renderGoalItem}
      />

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
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Next step</Text>
            {nextStepTarget?.title ? (
              <Text numberOfLines={1} style={styles.sheetSubtitle}>
                {nextStepTarget.title}
              </Text>
            ) : null}
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>What is the next action?</Text>
              <TextInput
                value={nextStepDraft}
                onChangeText={setNextStepDraft}
                placeholder="e.g. Draft the project brief"
                placeholderTextColor={mobileTheme.colors.textSubtle}
                multiline
                textAlignVertical="top"
                autoCapitalize="sentences"
                style={styles.textInput}
              />
            </View>
            <View style={styles.sheetActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setNextStepTargetId(null)} />
              <Button
                title="Save"
                loading={updateNextStepMutation.isPending}
                onPress={saveNextStep}
              />
            </View>
          </View>
        </View>
      </Modal>
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
  emptyWrap: {
    marginTop: mobileTheme.spacing.md,
    alignItems: 'center',
    paddingVertical: mobileTheme.spacing.lg,
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
  inputLabel: {
    color: mobileTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
    marginBottom: 7,
  },
  inputWrap: {
    marginTop: mobileTheme.spacing.md,
  },
  listContent: {
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  modalBackdrop: {
    backgroundColor: 'rgba(15,23,42,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  refreshingHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 6,
  },
  sheet: {
    backgroundColor: mobileTheme.colors.surface,
    borderTopLeftRadius: mobileTheme.radius.sheet,
    borderTopRightRadius: mobileTheme.radius.sheet,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingBottom: mobileTheme.spacing.xl,
    paddingTop: mobileTheme.spacing.md,
    ...mobileTheme.shadow.sheet,
    borderColor: mobileTheme.colors.border,
    borderWidth: 1,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.md,
    justifyContent: 'flex-end',
    marginTop: mobileTheme.spacing.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(13,17,23,0.22)',
    borderRadius: mobileTheme.radius.pill,
    height: 5,
    marginBottom: mobileTheme.spacing.md,
    width: 44,
  },
  sheetSubtitle: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 13,
    marginTop: 2,
  },
  sheetTitle: {
    color: mobileTheme.colors.text,
    fontSize: 18,
    fontWeight: mobileTheme.font.semibold,
  },
  skeletonWrap: {
    gap: mobileTheme.spacing.sm,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.md,
  },
  textInput: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.lg,
    borderWidth: 1,
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.semibold,
    minHeight: 96,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: mobileTheme.spacing.md,
    ...mobileTheme.shadow.control,
  },
});
