import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { GoalHealth, GoalStatus } from '@ega/api-client';
import { healthTone, mobileTheme } from '@/components/mobile/theme';
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
  const progress = Math.max(0, Math.min(100, goal.progressPercent ?? 0));
  const completed = goal.linkedTasks.filter((t) => t.status === 'done').length;
  const total = goal.linkedTasks.length;
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

          <Card style={styles.headerCard} variant="plain">
            <Text style={styles.goalTitle}>{goal.title}</Text>
            {goal.projectName ? <Text style={styles.projectName}>{goal.projectName.toUpperCase()}</Text> : null}
            {goal.description ? (
              <Text style={styles.description}>{goal.description}</Text>
            ) : (
              <Text style={styles.noDescription}>No description yet.</Text>
            )}
            {/* health primary, status secondary — single badgeRow, no meta duplication */}
            <View style={styles.badgeRow}>
              <Chip kind="health" value={goal.health} label={goal.health ? formatGoalToken(goal.health) : 'No health set'} testID="goal-detail-health-chip" />
              <Chip kind="status" value={goal.status} label={formatGoalToken(goal.status)} style={styles.statusChipSecondary} testID="goal-detail-status-chip" />
            </View>
          </Card>

          {!isArchived ? (
            <>
              <FormSection icon="pulse-outline" title="Status" description="Lifecycle stage">
                {/* Health primary per spec — health before status, health hierarchy on_track/at_risk/off_track */}
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

                <Text style={styles.groupLabel}>State</Text>
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
            {/* Dedup: bar + fraction only (no percent duplication) */}
            <View style={styles.progressRow}>
              <ProgressBar value={progress} max={100} color={hTone.color} trackColor={mobileTheme.colors.surfaceMid} style={styles.progressBar} testID="goal-detail-progress-bar" />
              <Text style={styles.progressLabel}>{`${completed} / ${total} tasks`}</Text>
            </View>
          </FormSection>

          <FormSection icon="list-outline" title={`Linked tasks (${total})`} description={total > 0 ? 'Tasks tied to this outcome' : 'No tasks are linked yet'}>
            {total > 0 ? (
              <View style={styles.taskList}>
                {goal.linkedTasks.map((task) => (
                  <View key={task.id} style={styles.taskRow}>
                    <View style={[styles.taskAccent, { backgroundColor: hTone.color }]} />
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

          <View style={styles.actionsWrap}>
            <View style={styles.actionsDivider} />
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
          </View>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actionsDivider: {
    backgroundColor: mobileTheme.colors.border,
    height: StyleSheet.hairlineWidth,
    marginBottom: mobileTheme.spacing.md,
  },
  actionsWrap: {
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
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    minWidth: 72,
    textAlign: 'right',
  },
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: mobileTheme.spacing.sm,
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
  statusChipSecondary: {
    opacity: 0.88,
  },
  taskAccent: {
    alignSelf: 'stretch',
    borderRadius: 2,
    width: 3,
  },
  taskList: {
    gap: 0,
    marginTop: mobileTheme.spacing.sm,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    backgroundColor: mobileTheme.colors.surface,
  },
  taskRow: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surface,
    borderBottomColor: mobileTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 12,
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
