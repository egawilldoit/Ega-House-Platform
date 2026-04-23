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
  TextInput,
  View,
} from 'react-native';

import {
  MobileScreen,
  MobileScreenHeader,
  SegmentedControl,
  SurfaceCard,
} from '@/components/mobile/primitives';
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
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.choiceChip, selected ? styles.choiceChipSelected : null]}
    >
      <Text style={[styles.choiceChipText, selected ? styles.choiceChipTextSelected : null]}>
        {label}
      </Text>
    </Pressable>
  );
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
          <Pressable onPress={() => optionsQuery.refetch()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
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

            <SurfaceCard>
              <SectionLabel icon="create-outline" label="Title" />
              <TextInput
                editable={!isSubmitting}
                onChangeText={(value) => {
                  setTitle(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="Ship the next execution step"
                style={styles.input}
                value={title}
              />
            </SurfaceCard>

            <SurfaceCard style={styles.sectionSpacing}>
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
            </SurfaceCard>

            <SurfaceCard style={styles.sectionSpacing}>
              <SectionLabel icon="flag-outline" label="Status" />
              <SegmentedControl
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
              <SegmentedControl
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
            </SurfaceCard>

            <SurfaceCard style={styles.sectionSpacing}>
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
                <View style={styles.datePickerCard}>
                  <DateTimePicker
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    mode="date"
                    onChange={onDueDateChange}
                    value={dueDatePickerValue}
                  />
                  {Platform.OS === 'ios' ? (
                    <View style={styles.datePickerActions}>
                      <Pressable onPress={clearDueDate} style={styles.datePickerSecondaryButton}>
                        <Text style={styles.datePickerSecondaryButtonText}>Clear</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setIsDueDatePickerVisible(false)}
                        style={styles.datePickerPrimaryButton}
                      >
                        <Text style={styles.datePickerPrimaryButtonText}>Done</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <Text style={styles.helperText}>Picker selection still submits as YYYY-MM-DD.</Text>

              <SectionLabel icon="time-outline" label="Estimate minutes" />
              <TextInput
                editable={!isSubmitting}
                keyboardType="number-pad"
                onChangeText={(value) => {
                  setEstimateMinutes(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="30"
                style={styles.input}
                value={estimateMinutes}
              />
            </SurfaceCard>

            <SurfaceCard style={styles.sectionSpacing}>
              <SectionLabel icon="document-text-outline" label="Description" />
              <TextInput
                editable={!isSubmitting}
                multiline
                onChangeText={(value) => {
                  setDescription(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="Optional task context"
                style={[styles.input, styles.multilineInput]}
                textAlignVertical="top"
                value={description}
              />

              <SectionLabel icon="ban-outline" label="Blocked reason" />
              <TextInput
                editable={!isSubmitting}
                multiline
                onChangeText={(value) => {
                  setBlockedReason(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="Required if status is Blocked"
                style={[styles.input, styles.multilineInput]}
                textAlignVertical="top"
                value={blockedReason}
              />
            </SurfaceCard>

            <Text style={styles.errorText}>{submitError || ' '}</Text>
          </View>
        </ScrollView>

        <View style={styles.stickyBar}>
          <Pressable disabled={isSubmitting} onPress={() => router.back()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            disabled={isSubmitting || projects.length === 0}
            onPress={onSubmit}
            style={[styles.primaryButton, isSubmitting || projects.length === 0 ? styles.buttonDisabled : null]}
          >
            {isSubmitting ? (
              <ActivityIndicator color={mobileTheme.colors.textOnAccent} />
            ) : (
              <Text style={styles.primaryButtonText}>Create Task</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  buttonDisabled: {
    opacity: 0.55,
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
  choiceChip: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  choiceChipSelected: {
    backgroundColor: mobileTheme.colors.accentSoft,
    borderColor: mobileTheme.colors.accent,
  },
  choiceChipText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
  },
  choiceChipTextSelected: {
    color: mobileTheme.colors.accent,
  },
  content: {
    paddingBottom: 28,
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
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.control,
    marginTop: 10,
    padding: 8,
  },
  datePickerPrimaryButton: {
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  datePickerPrimaryButtonText: {
    color: mobileTheme.colors.textOnAccent,
    fontWeight: mobileTheme.font.extrabold,
  },
  datePickerSecondaryButton: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: mobileTheme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  datePickerSecondaryButtonText: {
    color: mobileTheme.colors.text,
    fontWeight: mobileTheme.font.bold,
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
  input: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    color: mobileTheme.colors.text,
    fontSize: 15,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multilineInput: {
    minHeight: 92,
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
  primaryButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: mobileTheme.colors.textOnAccent,
    fontWeight: mobileTheme.font.extrabold,
  },
  screen: {
    flex: 1,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: mobileTheme.colors.text,
    fontWeight: mobileTheme.font.bold,
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
    backgroundColor: mobileTheme.colors.surface,
    borderTopColor: mobileTheme.colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingBottom: Platform.OS === 'ios' ? 26 : 14,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
});
