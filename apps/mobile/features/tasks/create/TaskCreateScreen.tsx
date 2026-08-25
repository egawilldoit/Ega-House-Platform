import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
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

import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { Card } from '@/components/mobile/ui/Card';
import { Button } from '@/components/mobile/ui/Button';
import { SelectionRow } from '@/components/mobile/ui/SelectionRow';
import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { FormSection } from '@/components/mobile/ui/FormSection';
import { FormField } from '@/components/mobile/ui/FormField';
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

const EMPTY_PROJECTS: { id: string; name: string }[] = [];
const EMPTY_GOALS: { id: string; title: string }[] = [];

function QuickPill({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : null,
        disabled ? styles.chipDisabled : null,
        pressed && !disabled ? styles.chipPressed : null,
      ]}
    >
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

export function TaskCreateScreen() {
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
      <AppScreen testID="task-create-loading">
        <View style={styles.centered}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.centerText}>Loading task form...</Text>
        </View>
      </AppScreen>
    );
  }

  if (optionsQuery.isError) {
    const loadError =
      optionsQuery.error instanceof Error
        ? optionsQuery.error.message
        : 'Unable to load task form options right now.';

    return (
      <AppScreen testID="task-create-error">
        <View style={styles.centered}>
          <FeedbackBanner message={loadError} tone="danger" style={styles.loadErrorBanner} />
          <Button onPress={() => optionsQuery.refetch()} title="Retry" variant="secondary" />
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen padded={false} testID="task-create-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pagePadding}>
            <ScreenHeader
              eyebrow="New task"
              title="Create task"
              description="Capture the next execution step with required project context."
            />

            <FormSection icon="create-outline" title="Title" description="The one-line execution step">
              <FormField
                accessibilityLabel="Task title"
                editable={!isSubmitting}
                onChangeText={(value) => {
                  setTitle(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="Ship the next execution step"
                required
                value={title}
              />
            </FormSection>

            <FormSection icon="briefcase-outline" title="Context" description="Project and optional goal">
              <Text style={styles.groupLabel}>Project</Text>
              {projects.length === 0 ? (
                <FeedbackBanner
                  message="No projects are available for this workspace yet, so task creation is blocked."
                  tone="warning"
                />
              ) : (
                <View style={styles.selectionList}>
                  {projects.map((project) => (
                    <SelectionRow
                      key={project.id}
                      label={project.name}
                      selected={project.id === projectId}
                      onPress={() => {
                        setProjectId(project.id);
                        if (submitError) {
                          setSubmitError(null);
                        }
                      }}
                      disabled={isSubmitting}
                    />
                  ))}
                </View>
              )}

              <Text style={styles.groupLabel}>Goal</Text>
              <View style={styles.selectionList}>
                <SelectionRow
                  label="No goal"
                  selected={goalId === null}
                  onPress={() => {
                    setGoalId(null);
                    if (submitError) {
                      setSubmitError(null);
                    }
                  }}
                  disabled={isSubmitting}
                />
                {goals.map((goal) => (
                  <SelectionRow
                    key={goal.id}
                    label={goal.title}
                    selected={goal.id === goalId}
                    onPress={() => {
                      setGoalId(goal.id);
                      if (submitError) {
                        setSubmitError(null);
                      }
                    }}
                    disabled={isSubmitting}
                  />
                ))}
              </View>
            </FormSection>

            <FormSection icon="flag-outline" title="Planning" description="Status and priority">
              <Text style={styles.groupLabel}>Status</Text>
              <SegmentedControl
                onChange={(next) => {
                  setStatus(next as MobileTaskStatus);
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

              <Text style={styles.groupLabel}>Priority</Text>
              <SegmentedControl
                onChange={(next) => {
                  setPriority(next as MobileTaskPriority);
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
            </FormSection>

            <FormSection icon="calendar-outline" title="Schedule" description="Due date and time estimate">
              <Text style={styles.groupLabel}>Due date</Text>
              <View style={styles.chipRow}>
                <QuickPill
                  label="Today"
                  onPress={() => applyRelativeDueDate(0)}
                  selected={dueDate === todayDateValue}
                  disabled={isSubmitting}
                />
                <QuickPill
                  label="Tomorrow"
                  onPress={() => applyRelativeDueDate(1)}
                  selected={dueDate === tomorrowDateValue}
                  disabled={isSubmitting}
                />
                <QuickPill label="Clear" onPress={clearDueDate} selected={!dueDate} disabled={isSubmitting} />
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => setIsDueDatePickerVisible((current) => !current)}
                style={({ pressed }) => [styles.dateField, pressed && !isSubmitting ? styles.dateFieldPressed : null]}
              >
                <Text style={styles.dateFieldLabel}>Selected date</Text>
                <Text style={[styles.dateFieldValue, !dueDate ? styles.dateFieldPlaceholder : null]}>
                  {formatDisplayDate(dueDate)}
                </Text>
                <Text style={styles.dateFieldMeta}>Optional</Text>
              </Pressable>
              {isDueDatePickerVisible ? (
                <Card style={styles.datePickerCard} contentStyle={styles.datePickerContent}>
                  <DateTimePicker
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    mode="date"
                    onChange={onDueDateChange}
                    value={dueDatePickerValue}
                  />
                  {Platform.OS === 'ios' ? (
                    <View style={styles.datePickerActions}>
                      <Button onPress={clearDueDate} size="sm" title="Clear" variant="secondary" />
                      <Button onPress={() => setIsDueDatePickerVisible(false)} size="sm" title="Done" />
                    </View>
                  ) : null}
                </Card>
              ) : null}
              <Text style={styles.helperText}>Picker selection still submits as YYYY-MM-DD.</Text>

              <FormField
                editable={!isSubmitting}
                helperText="Whole minutes, up to 525600"
                keyboardType="number-pad"
                label="Estimate minutes"
                onChangeText={(value) => {
                  setEstimateMinutes(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="30"
                value={estimateMinutes}
              />
            </FormSection>

            <FormSection icon="document-text-outline" title="Details" description="Optional context">
              <FormField
                editable={!isSubmitting}
                helperText="What needs to happen?"
                label="Description"
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

              <FormField
                editable={!isSubmitting}
                helperText={status === 'blocked' ? 'Required when status is Blocked' : 'Only used when status is Blocked'}
                label="Blocked reason"
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
            </FormSection>

            {submitError ? (
              <FeedbackBanner message={submitError} tone="danger" style={styles.inlineError} />
            ) : null}
          </View>
        </ScrollView>

        <View style={styles.stickyBar}>
          <View style={styles.stickyContent}>
            <Button
              disabled={isSubmitting}
              onPress={() => router.back()}
              style={styles.actionButton}
              title="Cancel"
              variant="secondary"
            />
            <Button
              disabled={isSubmitting || projects.length === 0}
              loading={isSubmitting}
              onPress={onSubmit}
              style={styles.actionButton}
              title="Create Task"
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
  chip: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipSelected: {
    backgroundColor: mobileTheme.colors.accentSoft,
    borderColor: mobileTheme.colors.accentMid,
  },
  chipText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
  },
  chipTextSelected: {
    color: mobileTheme.colors.accentDark,
    fontWeight: mobileTheme.font.bold,
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
    marginTop: 4,
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
  dateFieldPressed: {
    opacity: 0.72,
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
  loadErrorBanner: {
    marginBottom: mobileTheme.spacing.md,
    width: '100%',
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
});
