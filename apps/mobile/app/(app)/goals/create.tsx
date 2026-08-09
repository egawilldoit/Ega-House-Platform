import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { GoalHealth, GoalStatus } from '@ega/api-client';
import { EmptyState, MobileScreen, MobileScreenHeader } from '@/components/mobile/primitives';
import { GlassButton, GlassCard, GlassInput, GlassPill, GlassSegmentedControl } from '@/components/mobile/glass';
import { mobileTheme } from '@/components/mobile/theme';
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

function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return <GlassPill label={label} onPress={onPress} selected={selected} />;
}

export default function CreateGoalScreen() {
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
      <MobileScreen>
        <MobileScreenHeader eyebrow="Planning" title="New Goal" description="Loading projects…" />
      </MobileScreen>
    );
  }

  return (
    <MobileScreen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <MobileScreenHeader
            eyebrow="Planning"
            title="New Goal"
            description="An outcome with a health signal and a next step"
          />

          <GlassCard variant="fake" contentStyle={styles.formCard}>
            <GlassInput
              autoCapitalize="sentences"
              label="Title"
              onChangeText={setTitle}
              placeholder="e.g. Ship the mobile dashboard"
              value={title}
            />

            <Text style={styles.sectionLabel}>Project</Text>
            {projects.length === 0 ? (
              <EmptyState
                icon="folder-open-outline"
                title="No projects yet"
                description="Create a project first, then link this goal to it."
              />
            ) : (
              <View style={styles.chipRow}>
                {projects.map((project) => (
                  <ChoiceChip
                    key={project.id}
                    label={project.name}
                    onPress={() => setProjectId(project.id)}
                    selected={selectedProjectId === project.id}
                  />
                ))}
              </View>
            )}

            <GlassInput
              autoCapitalize="sentences"
              label="Next step (optional)"
              onChangeText={setNextStep}
              placeholder="What moves this goal forward?"
              style={styles.nextStepInput}
              value={nextStep}
            />

            <GlassInput
              autoCapitalize="sentences"
              label="Description (optional)"
              multiline
              onChangeText={setDescription}
              placeholder="What does success look like?"
              style={styles.descriptionInput}
              value={description}
            />

            <Text style={styles.sectionLabel}>Health</Text>
            <GlassSegmentedControl
              options={HEALTH_OPTIONS}
              onChange={setHealth}
              value={health}
            />

            <Text style={styles.sectionLabel}>Status</Text>
            <GlassSegmentedControl
              options={STATUS_OPTIONS}
              onChange={setStatus}
              value={status}
            />

            {submitError ? (
              <View style={styles.errorRow}>
                <Ionicons color={mobileTheme.colors.danger} name="alert-circle-outline" size={16} />
                <Text style={styles.errorText}>{submitError}</Text>
              </View>
            ) : null}

            <GlassButton
              disabled={!canSubmit}
              fullWidth
              loading={isSubmitting}
              onPress={onSubmit}
              title="Create Goal"
            />
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: mobileTheme.spacing.sm,
    marginBottom: mobileTheme.spacing.md,
  },
  content: {
    padding: mobileTheme.spacing.lg,
  },
  descriptionInput: {
    minHeight: 88,
  },
  errorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginBottom: mobileTheme.spacing.md,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    flex: 1,
    fontSize: 13,
  },
  flex: {
    flex: 1,
  },
  formCard: {
    marginTop: mobileTheme.spacing.lg,
  },
  nextStepInput: {
    marginBottom: mobileTheme.spacing.md,
  },
  sectionLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
});
