import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
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

type OptionChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

function OptionChip({ label, selected, onPress }: OptionChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.optionChip, selected ? styles.optionChipSelected : null]}
    >
      <Text style={[styles.optionChipText, selected ? styles.optionChipTextSelected : null]}>
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
      const message =
        error instanceof Error ? error.message : 'Unable to create task right now.';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingOptions) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.centerText}>Loading task form...</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError}</Text>
        <Pressable onPress={() => loadFormOptions()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.title}>Create Task</Text>
          <Text style={styles.subtitle}>
            Add a task with the existing mobile backend contract. Project is required, goal is optional.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Title</Text>
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
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Project</Text>
          <View style={styles.optionGroup}>
            {projects.map((project) => (
              <OptionChip
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
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Goal</Text>
          <View style={styles.optionGroup}>
            <OptionChip
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
              <OptionChip
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
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Status</Text>
          <View style={styles.optionGroup}>
            {MOBILE_TASK_STATUS_VALUES.map((value) => (
              <OptionChip
                key={value}
                label={formatTaskToken(value)}
                onPress={() => {
                  setStatus(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                selected={value === status}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.optionGroup}>
            {MOBILE_TASK_PRIORITY_VALUES.map((value) => (
              <OptionChip
                key={value}
                label={formatTaskToken(value)}
                onPress={() => {
                  setPriority(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                selected={value === priority}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Due Date</Text>
          <View style={styles.optionGroup}>
            <OptionChip
              label="Today"
              onPress={() => applyRelativeDueDate(0)}
              selected={dueDate === todayDateValue}
            />
            <OptionChip
              label="Tomorrow"
              onPress={() => applyRelativeDueDate(1)}
              selected={dueDate === tomorrowDateValue}
            />
            <OptionChip label="Clear" onPress={clearDueDate} selected={!dueDate} />
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
            <Text style={styles.dateFieldMeta}>
              {dueDate ? `Backend value: ${dueDate}` : 'Optional'}
            </Text>
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
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Estimate Minutes</Text>
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
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Description</Text>
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
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Blocked Reason</Text>
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
        </View>

        <Text style={styles.errorText}>{submitError || ' '}</Text>

        <View style={styles.actions}>
          <Pressable
            disabled={isSubmitting}
            onPress={() => router.back()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            disabled={isSubmitting || projects.length === 0}
            onPress={onSubmit}
            style={[
              styles.primaryButton,
              isSubmitting || projects.length === 0 ? styles.buttonDisabled : null,
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Create Task</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  centerText: {
    color: '#475569',
    marginTop: 10,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    gap: 18,
    padding: 16,
    paddingBottom: 32,
  },
  dateField: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dateFieldLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  dateFieldMeta: {
    color: '#64748b',
    fontSize: 13,
  },
  dateFieldPlaceholder: {
    color: '#94a3b8',
  },
  dateFieldValue: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
  datePickerActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  datePickerCard: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    overflow: 'hidden',
    padding: 8,
  },
  datePickerPrimaryButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 88,
    paddingHorizontal: 14,
  },
  datePickerPrimaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  datePickerSecondaryButton: {
    alignItems: 'center',
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 88,
    paddingHorizontal: 14,
  },
  datePickerSecondaryButtonText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: '#dc2626',
    minHeight: 20,
  },
  helperText: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 8,
  },
  hero: {
    gap: 6,
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  label: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  multilineInput: {
    minHeight: 96,
    paddingTop: 12,
  },
  optionChip: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionChipSelected: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  optionChipText: {
    color: '#334155',
    fontWeight: '600',
  },
  optionChipTextSelected: {
    color: '#ffffff',
  },
  optionGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  screen: {
    backgroundColor: '#f8fafc',
    flex: 1,
  },
  section: {
    gap: 2,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    color: '#475569',
    fontSize: 15,
    lineHeight: 22,
  },
  title: {
    color: '#0f172a',
    fontSize: 28,
    fontWeight: '700',
  },
});
