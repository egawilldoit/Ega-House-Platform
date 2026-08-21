import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { GoalHealth, GoalStatus } from '@ega/api-client';
import {
  GlassButton,
  GlassCard,
  GlassInput,
  GlassPill,
  GlassSegmentedControl,
} from '@/components/mobile/glass';
import { EmptyState, MobileScreen, MobileScreenHeader, SkeletonCard } from '@/components/mobile/primitives';
import { mobileTheme } from '@/components/mobile/theme';
import { formatGoalToken, goalHealthTone, goalStatusTone } from '@/components/mobile/GoalCard';
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

function SectionTitle({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Ionicons color={mobileTheme.colors.textMuted} name={icon} size={16} />
      <Text style={styles.sectionTitle}>{label}</Text>
    </View>
  );
}

export default function GoalDetailScreen() {
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
    goalQuery.refetch().catch(() => {
      // Error state is rendered from the query result.
    });
  }, [goalQuery]);

  const runMutation = useCallback(
    (action: () => Promise<unknown>) => {
      setActionError(null);
      action().catch((error: unknown) => {
        setActionError(
          error instanceof Error ? error.message : 'Unable to update the goal right now.',
        );
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
      runMutation(() =>
        updateNextStepMutation.mutateAsync({ goalId: goal.id, nextStep: nextValue }),
      );
    }
  }, [goal, nextStepValue, runMutation, updateNextStepMutation]);

  if (!goalId) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Goal details</Text>
          <Text style={styles.errorText}>Goal id is missing.</Text>
          <GlassButton onPress={() => router.back()} title="Back" variant="secondary" />
        </View>
      </MobileScreen>
    );
  }

  if (goalQuery.isError) {
    const loadError =
      goalQuery.error instanceof Error ? goalQuery.error.message : 'Unable to load goal right now.';

    return (
      <MobileScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Goal details</Text>
          <Text style={styles.errorText}>{loadError}</Text>
          <GlassButton onPress={onRetry} title="Retry" />
          <GlassButton onPress={() => router.back()} title="Back" variant="secondary" />
        </View>
      </MobileScreen>
    );
  }

  if (!goalQuery.isLoading && goalQuery.data === null) {
    return (
      <MobileScreen>
        <EmptyState
          action={<GlassButton onPress={() => router.back()} title="Back" variant="secondary" />}
          description="This goal may have been removed or is not part of your goals anymore."
          icon="flag-outline"
          title="Goal not found"
        />
      </MobileScreen>
    );
  }

  if (goalQuery.isLoading || !goal) {
    return (
      <MobileScreen>
        <MobileScreenHeader
          eyebrow="Planning"
          title="Goal details"
          description="Outcome, health signal, and next step"
        />
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </MobileScreen>
    );
  }

  const healthTone = goalHealthTone(goal.health);
  const statusTone = goalStatusTone(goal.status);
  const progress = Math.max(0, Math.min(100, goal.progressPercent ?? 0));
  const isMutating =
    updateStatusMutation.isPending ||
    updateHealthMutation.isPending ||
    updateNextStepMutation.isPending ||
    archiveMutation.isPending ||
    unarchiveMutation.isPending;

  return (
    <MobileScreen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <MobileScreenHeader
          eyebrow="Planning"
          title="Goal details"
          description={isArchived ? 'Archived goal' : 'Outcome, health signal, and next step'}
        />

        <GlassCard variant="fake">
          <Text style={styles.goalTitle}>{goal.title}</Text>
          {goal.projectName ? (
            <Text style={styles.projectName}>{goal.projectName.toUpperCase()}</Text>
          ) : null}
          {goal.description ? (
            <Text style={styles.description}>{goal.description}</Text>
          ) : (
            <Text style={styles.noDescription}>No description yet.</Text>
          )}
          <View style={styles.badgeRow}>
            <GlassPill
              label={formatGoalToken(goal.status)}
              leftIcon={<View style={[styles.pillDot, { backgroundColor: statusTone.dot }]} />}
              tone={goal.status === 'done' ? 'success' : 'primary'}
            />
            <GlassPill
              label={goal.health ? formatGoalToken(goal.health) : 'No health set'}
              leftIcon={<View style={[styles.pillDot, { backgroundColor: healthTone.dot }]} />}
              tone={
                goal.health === 'off_track'
                  ? 'danger'
                  : goal.health === 'at_risk'
                    ? 'warning'
                    : 'default'
              }
            />
          </View>
        </GlassCard>

        {!isArchived ? (
          <>
            <GlassCard variant="fake" style={styles.sectionSpacing}>
              <SectionTitle icon="pulse-outline" label="Status" />
              <GlassSegmentedControl
                disabled={isMutating}
                onChange={(status) => {
                  if (status !== goal.status) {
                    runMutation(() =>
                      updateStatusMutation.mutateAsync({ goalId: goal.id, status }),
                    );
                  }
                }}
                options={GOAL_STATUS_OPTIONS.map((option) => ({
                  label: formatGoalToken(option),
                  value: option,
                }))}
                value={(goal.status as GoalStatus) ?? 'draft'}
              />

              <SectionTitle icon="medkit-outline" label="Health" />
              <GlassSegmentedControl
                disabled={isMutating || !goal.health}
                onChange={(health) => {
                  if (health !== goal.health) {
                    runMutation(() =>
                      updateHealthMutation.mutateAsync({ goalId: goal.id, health }),
                    );
                  }
                }}
                options={GOAL_HEALTH_OPTIONS.map((option) => ({
                  label: formatGoalToken(option),
                  value: option,
                }))}
                value={goal.health ?? 'on_track'}
              />
              {!goal.health ? (
                <Text style={styles.helperText}>No health signal has been recorded yet.</Text>
              ) : null}
            </GlassCard>

            <GlassCard variant="fake" style={styles.sectionSpacing}>
              <SectionTitle icon="arrow-forward-circle-outline" label="Next step" />
              <GlassInput
                autoCapitalize="sentences"
                label="What is the next action?"
                multiline
                onChangeText={setNextStepDraft}
                placeholder="e.g. Draft the project brief"
                textAlignVertical="top"
                value={nextStepValue}
              />
              <GlassButton
                disabled={isMutating}
                loading={updateNextStepMutation.isPending}
                onPress={saveNextStep}
                style={styles.saveButton}
                title="Save next step"
              />
            </GlassCard>
          </>
        ) : null}

        <GlassCard variant="fake" style={styles.sectionSpacing}>
          <SectionTitle icon="stats-chart-outline" label="Progress" />
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { backgroundColor: healthTone.color, width: `${progress}%` }]}
              />
            </View>
            <Text style={styles.progressLabel}>{`${Math.round(progress)}%`}</Text>
          </View>

          <SectionTitle icon="checkbox-outline" label={`Linked tasks (${goal.linkedTasks.length})`} />
          {goal.linkedTasks.length > 0 ? (
            <View style={styles.taskList}>
              {goal.linkedTasks.map((task) => (
                <View key={task.id} style={styles.taskRow}>
                  <Text numberOfLines={1} style={styles.taskTitle}>
                    {task.title}
                  </Text>
                  <GlassPill label={formatGoalToken(task.status)} tone="default" />
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.helperText}>No tasks are linked to this goal yet.</Text>
          )}
        </GlassCard>

        {actionError ? (
          <View style={styles.feedbackError}>
            <Ionicons name="alert-circle" size={16} color={mobileTheme.colors.danger} />
            <Text style={styles.feedbackErrorText}>{actionError}</Text>
          </View>
        ) : null}

        <GlassCard variant="fake" style={styles.sectionSpacing}>
          {isArchived ? (
            <GlassButton
              disabled={isMutating}
              fullWidth
              loading={unarchiveMutation.isPending}
              onPress={() => runMutation(() => unarchiveMutation.mutateAsync(goal.id))}
              title="Unarchive goal"
              variant="secondary"
            />
          ) : (
            <GlassButton
              disabled={isMutating}
              fullWidth
              loading={archiveMutation.isPending}
              onPress={() => runMutation(() => archiveMutation.mutateAsync(goal.id))}
              title="Archive goal"
              variant="secondary"
            />
          )}
          <GlassButton
            disabled={isMutating}
            fullWidth
            onPress={() => router.back()}
            style={styles.backButton}
            title="Back"
            variant="ghost"
          />
        </GlassCard>
      </ScrollView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  backButton: {
    marginTop: mobileTheme.spacing.sm,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    paddingBottom: mobileTheme.layout.stickyActionClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.md,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: mobileTheme.spacing.sm,
  },
  feedbackError: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.dangerBg,
    borderRadius: mobileTheme.radius.md,
    flexDirection: 'row',
    gap: 8,
    marginTop: mobileTheme.spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  feedbackErrorText: {
    color: mobileTheme.colors.danger,
    flex: 1,
    fontWeight: mobileTheme.font.semibold,
  },
  goalTitle: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  helperText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  noDescription: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: mobileTheme.spacing.sm,
  },
  pillDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  progressFill: {
    borderRadius: 3,
    height: '100%',
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
    gap: mobileTheme.spacing.md,
    marginTop: 8,
  },
  progressTrack: {
    backgroundColor: 'rgba(100,116,139,0.14)',
    borderRadius: 3,
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
  projectName: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginTop: 4,
  },
  saveButton: {
    marginTop: mobileTheme.spacing.md,
  },
  sectionSpacing: {
    marginTop: mobileTheme.spacing.md,
  },
  sectionTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
    marginTop: 12,
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
  },
  skeletonWrap: {
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  taskList: {
    gap: 8,
    marginTop: 8,
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
  errorText: {
    color: mobileTheme.colors.danger,
    marginTop: 12,
    textAlign: 'center',
  },
});
