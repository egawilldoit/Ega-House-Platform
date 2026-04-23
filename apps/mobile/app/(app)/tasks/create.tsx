import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { createMobileTask, listMobileTasks } from '@/lib/api/tasks';
import { notifyTasksChanged } from '@/lib/tasks/store';
import {
  MOBILE_TASK_PRIORITY_VALUES,
  MOBILE_TASK_STATUS_VALUES,
  type CreateTaskInput,
  type MobileTaskGoal,
  type MobileTaskPriority,
  type MobileTaskProject,
  type MobileTaskStatus,
} from '@/types/tasks';

function isDateOnlyValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatDateOnlyValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnlyValue(value: string) {
  if (!isDateOnlyValue(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map((segment) => Number.parseInt(segment, 10));
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatDisplayDate(value: string) {
  const parsed = parseDateOnlyValue(value);

  if (!parsed) {
    return 'No due date';
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function validateEstimate(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return { value: null, error: null } as const;
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      value: null,
      error: 'Estimate must be a whole number of minutes.',
    } as const;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return {
      value: null,
      error: 'Estimate must be a whole number of minutes.',
    } as const;
  }

  if (parsed > 60 * 24 * 365) {
    return {
      value: null,
      error: 'Estimate is too large. Keep it under 525600 minutes.',
    } as const;
  }

  return { value: parsed, error: null } as const;
}

function formatTaskToken(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type ChoiceChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

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
  const [projects, setProjects] = useState<MobileTaskProject[]>([]);
  const [goals, setGoals] = useState<MobileTaskGoal[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const loadFormOptions = useCallback(async () => {
    setIsLoadingOptions(true);
    try {
      const response = await listMobileTasks({ limit: 1 });
      setProjects(response.projects);
      setGoals(response.goals);
      setProjectId((current) => {
        if (current && response.projects.some((project) => project.id === current)) {
          return current;
        }

        if (response.projects.length === 1) {
          return response.projects[0].id;
        }

        return current;
      });
      setLoadError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load task form options right now.';
      setLoadError(message);
    } finally {
      setIsLoadingOptions(false);
    }
  }, []);

  useEffect(() => {
    loadFormOptions().catch(() => {
      setIsLoadingOptions(false);
      setLoadError('Unable to load task form options right now.');
    });
  }, [loadFormOptions]);

  const todayDateValue = (() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return formatDateOnlyValue(today);
  })();
  const tomorrowDateValue = (() => {
    const tomorrow = new Date();
    tomorrow.setHours(12, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateOnlyValue(tomorrow);
  })();
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
    const estimateResult = validateEstimate(estimateMinutes);

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
    setIsSubmitting(true);

    try {
      await createMobileTask(payload);
      notifyTasksChanged();
      router.replace('/tasks');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create task right now.';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingOptions) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.centerText}>Loading task form...</Text>
        </View>
      </MobileScreen>
    );
  }

  if (loadError) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={() => loadFormOptions()} style={styles.primaryButton}>
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
    opacity: 0.6,
  },
  centerText: {
    color: mobileTheme.colors.textMuted,
    marginTop: 10,
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
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  choiceChipSelected: {
    backgroundColor: mobileTheme.colors.accent,
    borderColor: mobileTheme.colors.accent,
  },
  choiceChipText: {
    color: mobileTheme.colors.textMuted,
    fontWeight: mobileTheme.font.bold,
  },
  choiceChipTextSelected: {
    color: mobileTheme.colors.textOnAccent,
  },
  content: {
    paddingBottom: 118,
    paddingTop: 14,
  },
  dateField: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    gap: 3,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dateFieldLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
    textTransform: 'uppercase',
  },
  dateFieldMeta: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 13,
  },
  dateFieldPlaceholder: {
    color: mobileTheme.colors.textSubtle,
  },
  dateFieldValue: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.bold,
  },
  datePickerActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 10,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  datePickerCard: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: mobileTheme.radius.lg,
    marginTop: 10,
    overflow: 'hidden',
  },
  datePickerPrimaryButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 88,
    paddingHorizontal: 14,
  },
  datePickerPrimaryButtonText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
  },
  datePickerSecondaryButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 88,
    paddingHorizontal: 14,
  },
  datePickerSecondaryButtonText: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.bold,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    minHeight: 20,
    paddingHorizontal: 2,
    paddingTop: 12,
  },
  helperText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 8,
  },
  input: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    color: mobileTheme.colors.text,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multilineInput: {
    minHeight: 96,
    paddingTop: 12,
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
    fontSize: 15,
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
    fontSize: 15,
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
    backgroundColor: mobileTheme.colors.stickyBar,
    borderTopColor: mobileTheme.colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
});
