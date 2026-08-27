import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { GoalHealth, GoalStatus } from '@ega/api-client';
import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { Button } from '@/components/mobile/ui/Button';
import { SelectionRow } from '@/components/mobile/ui/SelectionRow';
import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { EmptyState } from '@/components/mobile/ui/EmptyState';
import { FormSection } from '@/components/mobile/ui/FormSection';
import { FormField } from '@/components/mobile/ui/FormField';
import { Card } from '@/components/mobile/ui/Card';
import { useCreateGoalMutation, useGoalListQuery } from '@/features/goals/query';

const HEALTH_OPTIONS: Array<{ label: string; value: GoalHealth }> = [
  { label: 'On track', value: 'on_track' },
  { label: 'At risk', value: 'at_risk' },
  { label: 'Off track', value: 'off_track' },
];

const STATUS_OPTIONS: Array<{ label: string; value: GoalStatus }> = [
  { label: 'Draft', value: 'draft' },
  { label: 'Active', value: 'active' },
  { label: 'Done', value: 'done' },
  { label: 'Paused', value: 'paused' },
];

const EMPTY_PROJECTS: { id: string; name: string }[] = [];

export function GoalCreateScreen() {
  const insets = useSafeAreaInsets();
  const goalsQuery = useGoalListQuery('all');
  const createGoalMutation = useCreateGoalMutation();

  const projects = goalsQuery.data?.projects ?? EMPTY_PROJECTS;

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [health, setHealth] = useState<GoalHealth>('on_track');
  const [status, setStatus] = useState<GoalStatus>('active');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedProjectId = projects.some((project) => project.id === projectId)
    ? projectId
    : projects.length === 1
      ? projects[0].id
      : '';

  const isSubmitting = createGoalMutation.isPending;
  const canSubmit = title.trim().length > 0 && selectedProjectId.length > 0 && !isSubmitting;

  const onSubmit = () => {
    if (!canSubmit) {
      return;
    }

    setSubmitError(null);
    createGoalMutation.mutate(
      {
        title: title.trim(),
        projectId: selectedProjectId,
        description: description.trim() || null,
        nextStep: nextStep.trim() || null,
        health,
        status,
        slug: null,
      },
      {
        onSuccess: () => {
          router.back();
        },
        onError: (error) => {
          setSubmitError(error instanceof Error ? error.message : 'Unable to create goal.');
        },
      },
    );
  };

  if (goalsQuery.isLoading) {
    return (
      <AppScreen testID="goal-create-loading">
        <View style={styles.centered}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.centerText}>Loading projects...</Text>
          <Card style={styles.skeletonCard}>
            <ScreenHeader eyebrow="Planning" title="New Goal" description="Loading projects…" />
          </Card>
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen padded={false} testID="goal-create-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: mobileTheme.layout.stickyActionClearance + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pagePadding}>
            <ScreenHeader
              eyebrow="Planning"
              title="New Goal"
              description="An outcome with a health signal and a next step"
            />

            <FormSection icon="create-outline" title="Essentials" description="The outcome title">
              <FormField
                autoCapitalize="sentences"
                label="Title"
                onChangeText={(value) => {
                  setTitle(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="e.g. Ship the mobile dashboard"
                required
                value={title}
              />
            </FormSection>

            <FormSection
              icon="folder-outline"
              title="Context"
              description="Link this goal to a project"
            >
              {projects.length === 0 ? (
                <EmptyState
                  icon="folder-open-outline"
                  title="No projects yet"
                  description="Create a project first, then link this goal to it."
                />
              ) : (
                <View style={styles.tonalGroup}>
                  {projects.map((project) => (
                    <SelectionRow
                      key={project.id}
                      label={project.name}
                      selected={selectedProjectId === project.id}
                      onPress={() => {
                        setProjectId(project.id);
                        if (submitError) {
                          setSubmitError(null);
                        }
                      }}
                      disabled={isSubmitting}
                    />
                  ))}
                  {projects.length === 1 ? (
                    <Text style={styles.helperText}>Single project auto-selected</Text>
                  ) : null}
                </View>
              )}
            </FormSection>

            <FormSection
              icon="document-text-outline"
              title="Details"
              description="What moves this goal forward"
            >
              <FormField
                autoCapitalize="sentences"
                helperText="Optional — the immediate next action"
                label="Next step"
                onChangeText={(value) => {
                  setNextStep(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="What moves this goal forward?"
                value={nextStep}
              />

              <FormField
                autoCapitalize="sentences"
                helperText="Optional — what success looks like"
                label="Description"
                multiline
                onChangeText={(value) => {
                  setDescription(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="What does success look like?"
                textAlignVertical="top"
                value={description}
              />
            </FormSection>

            <FormSection icon="pulse-outline" title="Health & Status" description="Signals for this goal">
              <Text style={styles.groupLabel}>Health</Text>
              <SegmentedControl
                options={HEALTH_OPTIONS}
                onChange={(next) => {
                  setHealth(next as GoalHealth);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                value={health}
              />

              <Text style={styles.groupLabel}>Status</Text>
              <SegmentedControl
                options={STATUS_OPTIONS}
                onChange={(next) => {
                  setStatus(next as GoalStatus);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                value={status}
              />
            </FormSection>

            {submitError ? (
              <FeedbackBanner message={submitError} tone="danger" style={styles.inlineError} />
            ) : null}
          </View>
        </ScrollView>

        <View style={styles.stickyBar}>
          <View style={[styles.stickyContent, { paddingBottom: insets.bottom ? insets.bottom + 10 : (Platform.OS === 'ios' ? 26 : 14) }]}>
            <Button
              disabled={isSubmitting}
              onPress={() => router.back()}
              style={styles.actionButton}
              title="Cancel"
              variant="secondary"
            />
            <Button
              disabled={!canSubmit}
              loading={isSubmitting}
              onPress={onSubmit}
              style={styles.actionButton}
              title="Create Goal"
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: mobileTheme.spacing.lg,
  },
  centerText: {
    color: mobileTheme.colors.textMuted,
    marginTop: 8,
  },
  content: {
    paddingBottom: mobileTheme.layout.stickyActionClearance,
    paddingTop: 14,
  },
  groupLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 4,
  },
  helperText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 6,
  },
  inlineError: {
    marginTop: mobileTheme.spacing.md,
  },
  pagePadding: {
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  screen: {
    flex: 1,
  },
  selectionList: {
    gap: 8,
  },
  skeletonCard: {
    marginTop: mobileTheme.spacing.lg,
    width: '100%',
  },
  stickyBar: {
    backgroundColor: mobileTheme.colors.surface,
    borderTopColor: mobileTheme.colors.border,
    borderTopWidth: 1,
    ...mobileTheme.shadow.sheet,
  },
  stickyContent: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 26 : 14,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: 10,
  },
  tonalGroup: {
    backgroundColor: mobileTheme.colors.surfaceLow,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    overflow: 'hidden',
    padding: 8,
  },
});
