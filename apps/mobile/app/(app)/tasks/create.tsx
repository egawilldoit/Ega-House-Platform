import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  MobileScreen,
  MobileScreenHeader,
} from '@/components/mobile/primitives';
import {
  GlassButton,
  GlassCard,
  GlassInput,
  GlassPill,
  GlassSegmentedControl,
} from '@/components/mobile/glass';
import { mobileTheme } from '@/components/mobile/theme';
import {
  formatDateOnlyValue,
  formatDisplayDate,
  formatTaskToken,
  isDateOnlyValue,
  normalizeOptionalText,
  parseDateOnlyValue,
  validateEstimateMinutesInput,
} from '@/features/tasks/form-utils';
import { useCreateTaskMutation, useTaskFormOptionsQuery } from '@/features/tasks/query';
import {
  MOBILE_TASK_PRIORITY_VALUES,
  MOBILE_TASK_STATUS_VALUES,
  type CreateTaskInput,
  type MobileTaskPriority,
  type MobileTaskStatus,
} from '@/types/tasks';

type ChoiceChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

const EMPTY_PROJECTS: { id: string; name: string }[] = [];
const EMPTY_GOALS: { id: string; title: string }[] = [];

function SectionLabel({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Ionicons name={icon} size={16} color={mobileTheme.colors.textMuted} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function ChoiceChip({ label, selected, onPress }: ChoiceChipProps) {
  return <GlassPill label={label} onPress={onPress} selected={selected} />;
}

export default function CreateTaskScreen() {
  const optionsQuery = useTaskFormOptionsQuery();
  const createTaskMutation = useCreateTaskMutation();

  const projects = optionsQuery.data?.projects ?? EMPTY_PROJECTS;
  const goals = optionsQuery.data?.goals ?? EMPTY_GOALS;

  const [submitError, setSubmitError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [goalId, setGoalId] = useState<string | null>(null);
  const [status, setStatus] = useState<MobileTaskStatus>('todo');
  const [priority, setPriority] = useState<MobileTaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [isDueDatePickerVisible, setIsDueDatePickerVisible] = useState(false);
  const [estimateMinutes, setEstimateMinutes] = useState('');
  const [description, setDescription] = useState('');
  const [blockedReason, setBlockedReason] = useState('');

  const isSubmitting = createTaskMutation.isPending;

  useEffect(() => {
    if (projectId && projects.some((project) => project.id === projectId)) {
      return;
    }

    if (projects.length === 1) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects]);

  const todayDateValue = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return formatDateOnlyValue(today);
  }, []);

  const tomorrowDateValue = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setHours(12, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateOnlyValue(tomorrow);
  }, []);

  const dueDatePickerValue = parseDateOnlyValue(dueDate) ?? new Date();

  function setDueDateValue(value: string) {
    setDueDate(value);
    if (submitError) {
      setSubmitError(null);
    }
  }

  function applyRelativeDueDate(offsetDays: number) {
    const nextDate = new Date();
    nextDate.setHours(12, 0, 0, 0);
    nextDate.setDate(nextDate.getDate() + offsetDays);
    setDueDateValue(formatDateOnlyValue(nextDate));
  }

  function clearDueDate() {
    setDueDateValue('');
    setIsDueDatePickerVisible(false);
  }

  function onDueDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') {
      setIsDueDatePickerVisible(false);
    }

    if (event.type === 'dismissed' || !selectedDate) {
      return;
    }

    setDueDateValue(formatDateOnlyValue(selectedDate));
  }

  async function onSubmit() {
    const trimmedTitle = title.trim();
    const trimmedDueDate = dueDate.trim();
    const normalizedDescription = normalizeOptionalText(description);
    const normalizedBlockedReason = normalizeOptionalText(blockedReason);
    const estimateResult = validateEstimateMinutesInput(estimateMinutes);

    if (!trimmedTitle) {
      setSubmitError('Task title is required.');
      return;
    }

    if (!projectId) {
      setSubmitError('projectId is required.');
      return;
    }

    if (trimmedDueDate && !isDateOnlyValue(trimmedDueDate)) {
      setSubmitError('Due date must be a valid date in YYYY-MM-DD format.');
      return;
    }

    if (estimateResult.error) {
      setSubmitError(estimateResult.error);
      return;
    }

    if (status === 'blocked' && !normalizedBlockedReason) {
      setSubmitError('Blocked reason is required when status is Blocked.');
      return;
    }

    const payload: CreateTaskInput = {
      title: trimmedTitle,
      projectId,
      goalId,
      description: normalizedDescription,
      blockedReason: normalizedBlockedReason,
      status,
      priority,
      dueDate: trimmedDueDate || null,
      estimateMinutes: estimateResult.value,
    };

    setSubmitError(null);

    try {
      await createTaskMutation.mutateAsync(payload);
      router.replace('/tasks');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create task right now.';
      setSubmitError(message);
    }
  }

  if (optionsQuery.isPending) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.centerText}>Loading task form...</Text>
        </View>
      </MobileScreen>
    );
  }

  if (optionsQuery.isError) {
    const loadError =
      optionsQuery.error instanceof Error
        ? optionsQuery.error.message
        : 'Unable to load task form options right now.';

    return (
      <MobileScreen>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{loadError}</Text>
          <GlassButton onPress={() => optionsQuery.refetch()} title="Retry" />
        </View>
      </MobileScreen>
    );
  }

  return (
    <MobileScreen padded={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.pagePadding}>
            <MobileScreenHeader
              eyebrow="New task"
              title="Create task"
              description="Capture the next execution step with required project context."
            />

            <GlassCard variant="fake">
              <SectionLabel icon="create-outline" label="Title" />
              <GlassInput
                editable={!isSubmitting}
                onChangeText={(value) => {
                  setTitle(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="Ship the next execution step"
                value={title}
              />
            </GlassCard>

            <GlassCard variant="fake" style={styles.sectionSpacing}>
              <SectionLabel icon="briefcase-outline" label="Project" />
              <View style={styles.optionGroup}>
                {projects.map((project) => (
                  <ChoiceChip
                    key={project.id}
                    label={project.name}
                    onPress={() => {
                      setProjectId(project.id);
                      if (submitError) {
                        setSubmitError(null);
                      }
                    }}
                    selected={project.id === projectId}
                  />
                ))}
              </View>
              {projects.length === 0 ? (
                <Text style={styles.helperText}>
                  No projects are available for this workspace yet, so task creation is blocked.
                </Text>
              ) : null}

              <SectionLabel icon="flag-outline" label="Goal" />
              <View style={styles.optionGroup}>
                <ChoiceChip
                  label="No goal"
                  onPress={() => {
                    setGoalId(null);
                    if (submitError) {
                      setSubmitError(null);
                    }
                  }}
                  selected={goalId === null}
                />
                {goals.map((goal) => (
                  <ChoiceChip
                    key={goal.id}
                    label={goal.title}
                    onPress={() => {
                      setGoalId(goal.id);
                      if (submitError) {
                        setSubmitError(null);
                      }
                    }}
                    selected={goal.id === goalId}
                  />
                ))}
              </View>
            </GlassCard>

            <GlassCard variant="fake" style={styles.sectionSpacing}>
              <SectionLabel icon="flag-outline" label="Status" />
              <GlassSegmentedControl
                onChange={(next) => {
                  setStatus(next);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                options={MOBILE_TASK_STATUS_VALUES.map((value) => ({
                  label: formatTaskToken(value),
                  value,
                }))}
                value={status}
              />

              <SectionLabel icon="trending-up-outline" label="Priority" />
              <GlassSegmentedControl
                onChange={(next) => {
                  setPriority(next);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                options={MOBILE_TASK_PRIORITY_VALUES.map((value) => ({
                  label: formatTaskToken(value),
                  value,
                }))}
                value={priority}
              />
            </GlassCard>

            <GlassCard variant="fake" style={styles.sectionSpacing}>
              <SectionLabel icon="calendar-outline" label="Due date" />
              <View style={styles.optionGroup}>
                <ChoiceChip
                  label="Today"
                  onPress={() => applyRelativeDueDate(0)}
                  selected={dueDate === todayDateValue}
                />
                <ChoiceChip
                  label="Tomorrow"
                  onPress={() => applyRelativeDueDate(1)}
                  selected={dueDate === tomorrowDateValue}
                />
                <ChoiceChip label="Clear" onPress={clearDueDate} selected={!dueDate} />
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => setIsDueDatePickerVisible((current) => !current)}
                style={styles.dateField}
              >
                <Text style={styles.dateFieldLabel}>Selected date</Text>
                <Text style={[styles.dateFieldValue, !dueDate ? styles.dateFieldPlaceholder : null]}>
                  {formatDisplayDate(dueDate)}
                </Text>
                <Text style={styles.dateFieldMeta}>Optional</Text>
              </Pressable>
              {isDueDatePickerVisible ? (
                <GlassCard
                  variant="fake"
                  style={styles.datePickerCard}
                  contentStyle={styles.datePickerContent}
                >
                  <DateTimePicker
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    mode="date"
                    onChange={onDueDateChange}
                    value={dueDatePickerValue}
                  />
                  {Platform.OS === 'ios' ? (
                    <View style={styles.datePickerActions}>
                      <GlassButton
                        onPress={clearDueDate}
                        size="sm"
                        title="Clear"
                        variant="secondary"
                      />
                      <GlassButton
                        onPress={() => setIsDueDatePickerVisible(false)}
                        size="sm"
                        title="Done"
                      />
                    </View>
                  ) : null}
                </GlassCard>
              ) : null}
              <Text style={styles.helperText}>Picker selection still submits as YYYY-MM-DD.</Text>

              <SectionLabel icon="time-outline" label="Estimate minutes" />
              <GlassInput
                editable={!isSubmitting}
                keyboardType="number-pad"
                onChangeText={(value) => {
                  setEstimateMinutes(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="30"
                value={estimateMinutes}
              />
            </GlassCard>

            <GlassCard variant="fake" style={styles.sectionSpacing}>
              <SectionLabel icon="document-text-outline" label="Description" />
              <GlassInput
                editable={!isSubmitting}
                multiline
                onChangeText={(value) => {
                  setDescription(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="Optional task context"
                textAlignVertical="top"
                value={description}
              />

              <SectionLabel icon="ban-outline" label="Blocked reason" />
              <GlassInput
                editable={!isSubmitting}
                multiline
                onChangeText={(value) => {
                  setBlockedReason(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="Required if status is Blocked"
                textAlignVertical="top"
                value={blockedReason}
              />
            </GlassCard>

            <Text style={styles.errorText}>{submitError || ' '}</Text>
          </View>
        </ScrollView>

        <GlassCard variant="fake" style={styles.stickyBar} contentStyle={styles.stickyBarContent}>
          <GlassButton
            disabled={isSubmitting}
            fullWidth
            onPress={() => router.back()}
            style={styles.actionButton}
            title="Cancel"
            variant="secondary"
          />
          <GlassButton
            disabled={isSubmitting || projects.length === 0}
            fullWidth
            loading={isSubmitting}
            onPress={onSubmit}
            style={styles.actionButton}
            title="Create Task"
          />
        </GlassCard>
      </KeyboardAvoidingView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    flex: 1,
  },
  centerText: {
    color: mobileTheme.colors.textMuted,
    marginTop: 8,
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
  dateField: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dateFieldLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  dateFieldMeta: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 5,
  },
  dateFieldPlaceholder: {
    color: mobileTheme.colors.textSubtle,
  },
  dateFieldValue: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.bold,
    marginTop: 4,
  },
  datePickerActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  datePickerCard: {
    marginTop: 10,
  },
  datePickerContent: {
    padding: 8,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    marginTop: 12,
    minHeight: 20,
  },
  helperText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  optionGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  pagePadding: {
    paddingHorizontal: 16,
  },
  screen: {
    flex: 1,
  },
  sectionLabel: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
  },
  sectionLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
  },
  sectionSpacing: {
    marginTop: 12,
  },
  stickyBar: {
    borderRadius: 0,
  },
  stickyBarContent: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 26 : 14,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
});
