import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { GoalHealth, GoalStatus } from '@ega/api-client';
import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { Chip } from '@/components/mobile/ui/Chip';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { FormField } from '@/components/mobile/ui/FormField';
import { FormSection } from '@/components/mobile/ui/FormSection';
import { ProgressBar } from '@/components/mobile/ui/ProgressBar';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';
import { SkeletonCard } from '@/components/mobile/ui/Skeleton';
import {
  useArchiveGoalMutation,
  useGoalDetailQuery,
  useUnarchiveGoalMutation,
  useUpdateGoalHealthMutation,
  useUpdateGoalNextStepMutation,
  useUpdateGoalStatusMutation,
} from '@/features/goals/query';
import { healthTone, statusTone } from '@/components/mobile/theme';

const GOAL_STATUS_OPTIONS: GoalStatus[] = ['draft', 'active', 'done', 'paused'];
const GOAL_HEALTH_OPTIONS: GoalHealth[] = ['on_track', 'at_risk', 'off_track'];

function formatGoalToken(value: string) {
  return value.replaceAll('_', ' ');
}

export function GoalDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const goalId = useMemo(() => String(id ?? '').trim(), [id]);

  const goalQuery = useGoalDetailQuery(goalId);
  const updateStatusMutation = useUpdateGoalStatusMutation();
  const updateHealthMutation = useUpdateGoalHealthMutation();
  const updateNextStepMutation = useUpdateGoalNextStepMutation();
  const archiveMutation = useArchiveGoalMutation();
  const unarchiveMutation = useUnarchiveGoalMutation();

  const [nextStepDraft, setNextStepDraft] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const goal = goalQuery.data ?? null;
  const isArchived = goal?.status === 'archived';

  const onRetry = useCallback(() => {
    setActionError(null);
    goalQuery.refetch().catch(() => {});
  }, [goalQuery]);

  const runMutation = useCallback(
    (action: () => Promise<unknown>) => {
      setActionError(null);
      action().catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : 'Unable to update the goal right now.');
      });
    },
    [],
  );

  const nextStepValue = nextStepDraft ?? goal?.nextStep ?? '';

  const saveNextStep = useCallback(() => {
    if (!goal) {
      return;
    }

    const normalized = nextStepValue.trim();
    const nextValue = normalized.length > 0 ? normalized : null;
    if (nextValue !== goal.nextStep) {
      runMutation(() => updateNextStepMutation.mutateAsync({ goalId: goal.id, nextStep: nextValue }));
    }
  }, [goal, nextStepValue, runMutation, updateNextStepMutation]);

  if (!goalId) {
    return (
      <AppScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Goal details</Text>
          <FeedbackBanner message="Goal id is missing." tone="danger" style={styles.banner} />
          <Button onPress={() => router.back()} title="Back" variant="secondary" />
        </View>
      </AppScreen>
    );
  }

  if (goalQuery.isError) {
    const loadError =
      goalQuery.error instanceof Error ? goalQuery.error.message : 'Unable to load goal right now.';

    return (
      <AppScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Goal details</Text>
          <FeedbackBanner message={loadError} tone="danger" style={styles.banner} />
          <View style={styles.errorActions}>
            <Button onPress={onRetry} title="Retry" />
            <Button onPress={() => router.back()} title="Back" variant="secondary" />
          </View>
        </View>
      </AppScreen>
    );
  }

  if (!goalQuery.isLoading && goalQuery.data === null) {
    return (
      <AppScreen>
        <View style={styles.centered}>
          <Card style={styles.notFoundCard}>
            <Text style={styles.notFoundTitle}>Goal not found</Text>
            <Text style={styles.notFoundDesc}>
              This goal may have been removed or is not part of your goals anymore.
            </Text>
            <Button onPress={() => router.back()} title="Back" variant="secondary" style={styles.notFoundAction} />
          </Card>
        </View>
      </AppScreen>
    );
  }

  if (goalQuery.isLoading || !goal) {
    return (
      <AppScreen padded={false} testID="goal-detail-loading">
        <View style={styles.pagePadding}>
          <ScreenHeader
            eyebrow="Planning"
            title="Goal details"
            description="Outcome, health signal, and next step"
          />
        </View>
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </AppScreen>
    );
  }

  const hTone = healthTone((goal.health as never) ?? null);
  const sTone = statusTone((goal.status as never) ?? 'draft');
  const progress = Math.max(0, Math.min(100, goal.progressPercent ?? 0));
  const isMutating =
    updateStatusMutation.isPending ||
    updateHealthMutation.isPending ||
    updateNextStepMutation.isPending ||
    archiveMutation.isPending ||
    unarchiveMutation.isPending;

  return (
    <AppScreen padded={false} testID="goal-detail-screen">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pagePadding}>
          <ScreenHeader
            eyebrow="Planning"
            title="Goal details"
            description={isArchived ? 'Archived goal' : 'Outcome, health signal, and next step'}
          />

          <Card style={styles.headerCard}>
            <Text style={styles.goalTitle}>{goal.title}</Text>
            {goal.projectName ? <Text style={styles.projectName}>{goal.projectName.toUpperCase()}</Text> : null}
            {goal.description ? (
              <Text style={styles.description}>{goal.description}</Text>
            ) : (
              <Text style={styles.noDescription}>No description yet.</Text>
            )}
            <View style={styles.badgeRow}>
              <Chip kind="status" value={goal.status} />
              <Chip kind="health" value={goal.health} label={goal.health ? formatGoalToken(goal.health) : 'No health set'} />
            </View>
            <View style={styles.metaAccentRow}>
              <View style={[styles.metaDot, { backgroundColor: sTone.dot }]} />
              <Text style={styles.metaText}>{formatGoalToken(goal.status)}</Text>
              <View style={[styles.metaDot, { backgroundColor: hTone.dot, marginLeft: 10 }]} />
              <Text style={styles.metaText}>{goal.health ? formatGoalToken(goal.health) : 'No health'}</Text>
            </View>
          </Card>

          {!isArchived ? (
            <>
              <FormSection icon="pulse-outline" title="Status" description="Lifecycle stage">
                <SegmentedControl
                  disabled={isMutating}
                  onChange={(status) => {
                    if (status !== goal.status) {
                      runMutation(() => updateStatusMutation.mutateAsync({ goalId: goal.id, status: status as GoalStatus }));
                    }
                  }}
                  options={GOAL_STATUS_OPTIONS.map((option) => ({
                    label: formatGoalToken(option),
                    value: option,
                  }))}
                  value={(goal.status as GoalStatus) ?? 'draft'}
                />

                <Text style={styles.groupLabel}>Health</Text>
                <SegmentedControl
                  disabled={isMutating}
                  onChange={(health) => {
                    if (health !== goal.health) {
                      runMutation(() => updateHealthMutation.mutateAsync({ goalId: goal.id, health: health as GoalHealth }));
                    }
                  }}
                  options={GOAL_HEALTH_OPTIONS.map((option) => ({
                    label: formatGoalToken(option),
                    value: option,
                  }))}
                  value={(goal.health as GoalHealth) ?? 'on_track'}
                />
                {!goal.health ? (
                  <Text style={styles.helperText}>No health signal has been recorded yet.</Text>
                ) : null}
              </FormSection>

              <FormSection icon="arrow-forward-circle-outline" title="Next step" description="What is the next action?">
                <FormField
                  multiline
                  onChangeText={setNextStepDraft}
                  placeholder="e.g. Draft the project brief"
                  textAlignVertical="top"
                  value={nextStepValue}
                />
                <Button
                  disabled={isMutating}
                  loading={updateNextStepMutation.isPending}
                  onPress={saveNextStep}
                  title="Save next step"
                />
              </FormSection>
            </>
          ) : null}

          <FormSection icon="stats-chart-outline" title="Progress" description="Completion signal">
            <View style={styles.progressRow}>
              <ProgressBar value={progress} max={100} color={hTone.color} style={styles.progressBar} />
              <Text style={styles.progressLabel}>{`${Math.round(progress)}%`}</Text>
            </View>
            <Text style={styles.helperText}>
              {goal.linkedTasks.filter((t) => t.status === 'done').length} / {goal.linkedTasks.length} tasks
            </Text>

            <Text style={styles.groupLabel}>{`Linked tasks (${goal.linkedTasks.length})`}</Text>
            {goal.linkedTasks.length > 0 ? (
              <View style={styles.taskList}>
                {goal.linkedTasks.map((task) => (
                  <View key={task.id} style={styles.taskRow}>
                    <Text numberOfLines={1} style={styles.taskTitle}>
                      {task.title}
                    </Text>
                    <Chip kind="status" value={task.status} />
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.helperText}>No tasks are linked to this goal yet.</Text>
            )}
          </FormSection>

          {actionError ? <FeedbackBanner message={actionError} tone="danger" style={styles.inlineError} /> : null}

          <Card style={styles.actionsCard}>
            {isArchived ? (
              <Button
                disabled={isMutating}
                fullWidth
                loading={unarchiveMutation.isPending}
                onPress={() => runMutation(() => unarchiveMutation.mutateAsync(goal.id))}
                title="Unarchive goal"
                variant="secondary"
              />
            ) : (
              <Button
                disabled={isMutating}
                fullWidth
                loading={archiveMutation.isPending}
                onPress={() => runMutation(() => archiveMutation.mutateAsync(goal.id))}
                title="Archive goal"
                variant="secondary"
              />
            )}
            <Button
              disabled={isMutating}
              fullWidth
              onPress={() => router.back()}
              title="Back"
              variant="ghost"
              style={styles.backButton}
            />
          </Card>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actionsCard: {
    gap: 10,
    marginTop: mobileTheme.spacing.md,
  },
  backButton: {
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
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
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  goalTitle: {
    color: mobileTheme.colors.text,
    fontSize: 22,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  groupLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 10,
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
  metaAccentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 8,
  },
  metaDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  metaText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    marginLeft: 5,
    textTransform: 'capitalize',
  },
  noDescription: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 8,
  },
  notFoundAction: {
    marginTop: 12,
  },
  notFoundCard: {
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  notFoundDesc: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  notFoundTitle: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
  },
  pagePadding: {
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  progressBar: {
    flex: 1,
  },
  progressLabel: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    minWidth: 36,
    textAlign: 'right',
  },
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  projectName: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
    letterSpacing: 0.6,
    marginTop: 4,
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
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: 10,
  },
  taskList: {
    gap: 8,
    marginTop: 6,
  },
  taskRow: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  taskTitle: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    minWidth: 0,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.extrabold,
  },
});
