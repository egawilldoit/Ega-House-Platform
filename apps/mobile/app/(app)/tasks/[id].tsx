import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { formatTaskToken, validateEstimateMinutesInput } from '@/features/tasks/form-utils';
import { useTaskByIdQuery, useUpdateTaskMutation } from '@/features/tasks/query';
import {
  MOBILE_TASK_PRIORITY_VALUES,
  MOBILE_TASK_STATUS_VALUES,
  type MobileTaskListItem,
  type MobileTaskPriority,
  type MobileTaskStatus,
} from '@/types/tasks';

type EditableTaskFields = {
  status: MobileTaskStatus;
  priority: MobileTaskPriority;
  dueDate: string | null;
  estimateMinutesText: string;
  description: string;
  blockedReason: string;
};

function formatDueDate(value: string | null) {
  if (!value) {
    return 'No due date';
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function isoDateAtOffset(daysFromToday: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function createEditableDraft(task: MobileTaskListItem): EditableTaskFields {
  return {
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    estimateMinutesText: task.estimateMinutes === null ? '' : String(task.estimateMinutes),
    description: task.description ?? '',
    blockedReason: task.blockedReason ?? '',
  };
}

function isDraftDirty(task: MobileTaskListItem, draft: EditableTaskFields) {
  const original = createEditableDraft(task);

  return (
    original.status !== draft.status ||
    original.priority !== draft.priority ||
    original.dueDate !== draft.dueDate ||
    original.estimateMinutesText !== draft.estimateMinutesText ||
    original.description !== draft.description ||
    original.blockedReason !== draft.blockedReason
  );
}

function SectionTitle({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Ionicons color={mobileTheme.colors.textMuted} name={icon} size={16} />
      <Text style={styles.sectionTitle}>{label}</Text>
    </View>
  );
}

export default function TaskDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const taskId = useMemo(() => String(id ?? '').trim(), [id]);

  const taskQuery = useTaskByIdQuery(taskId);
  const updateTaskMutation = useUpdateTaskMutation();
  const { refetch } = taskQuery;

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableTaskFields | null>(null);

  const task = taskQuery.data ?? null;

  useFocusEffect(
    useCallback(() => {
      if (!taskId) {
        return;
      }

      refetch().catch(() => {
        // handled by query state
      });
    }, [taskId, refetch]),
  );

  useEffect(() => {
    if (!task) {
      return;
    }

    setDraft(createEditableDraft(task));
    setSubmitError(null);
  }, [task]);

  const onRetry = useCallback(() => {
    refetch().catch(() => {
      // handled by query state
    });
  }, [refetch]);

  const applyQuickDueDate = useCallback((nextDueDate: string | null) => {
    setDraft((current) => (current ? { ...current, dueDate: nextDueDate } : current));
    setSuccessMessage(null);
    setSubmitError(null);
  }, []);

  const onSave = useCallback(async () => {
    if (!taskId || !draft) {
      return;
    }

    const estimateResult = validateEstimateMinutesInput(draft.estimateMinutesText);
    if (estimateResult.error) {
      setSubmitError(estimateResult.error);
      setSuccessMessage(null);
      return;
    }

    if (draft.status === 'blocked' && !draft.blockedReason.trim()) {
      setSubmitError('Blocked reason is required when status is Blocked.');
      setSuccessMessage(null);
      return;
    }

    setSubmitError(null);
    setSuccessMessage(null);

    try {
      const response = await updateTaskMutation.mutateAsync({
        taskId,
        input: {
          status: draft.status,
          priority: draft.priority,
          dueDate: draft.dueDate,
          estimateMinutes: estimateResult.value,
          description: draft.description.trim() || null,
          blockedReason: draft.blockedReason.trim() || null,
        },
      });

      setDraft(createEditableDraft(response.task));
      setSuccessMessage('Task updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update task right now.';
      setSubmitError(message);
    }
  }, [draft, taskId, updateTaskMutation]);

  if (!taskId) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Task details</Text>
          <Text style={styles.errorText}>Task id is missing.</Text>
          <Pressable onPress={() => router.back()} style={styles.ghostButton}>
            <Text style={styles.ghostButtonText}>Back</Text>
          </Pressable>
        </View>
      </MobileScreen>
    );
  }

  if (taskQuery.isPending || !draft || !task) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.subtitle}>Loading task...</Text>
        </View>
      </MobileScreen>
    );
  }

  if (taskQuery.isError) {
    const loadError =
      taskQuery.error instanceof Error ? taskQuery.error.message : 'Unable to load task right now.';

    return (
      <MobileScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Task details</Text>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={onRetry} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={styles.ghostButton}>
            <Text style={styles.ghostButtonText}>Back</Text>
          </Pressable>
        </View>
      </MobileScreen>
    );
  }

  const dirty = isDraftDirty(task, draft);
  const isSaving = updateTaskMutation.isPending;

  return (
    <MobileScreen padded={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.pagePadding}>
            <MobileScreenHeader
              eyebrow="Task"
              title="Edit task"
              description={dirty ? 'Unsaved changes' : 'All changes saved'}
            />

            <SurfaceCard>
              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.meta}>
                {task.project.name}
                {task.goal ? ` · ${task.goal.title}` : ''}
              </Text>
              <Text style={styles.meta}>Updated {formatTimestamp(task.updatedAt)}</Text>
            </SurfaceCard>

            <SurfaceCard style={styles.sectionSpacing}>
              <SectionTitle icon="flag-outline" label="Status" />
              <SegmentedControl
                onChange={(status) => {
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          status,
                          blockedReason: status === 'blocked' ? current.blockedReason : '',
                        }
                      : current,
                  );
                  setSuccessMessage(null);
                  setSubmitError(null);
                }}
                options={MOBILE_TASK_STATUS_VALUES.map((option) => ({
                  label: formatTaskToken(option),
                  value: option,
                }))}
                value={draft.status}
              />

              <SectionTitle icon="trending-up-outline" label="Priority" />
              <SegmentedControl
                onChange={(priority) => {
                  setDraft((current) => (current ? { ...current, priority } : current));
                  setSuccessMessage(null);
                  setSubmitError(null);
                }}
                options={MOBILE_TASK_PRIORITY_VALUES.map((option) => ({
                  label: formatTaskToken(option),
                  value: option,
                }))}
                value={draft.priority}
              />
            </SurfaceCard>

            <SurfaceCard style={styles.sectionSpacing}>
              <SectionTitle icon="calendar-outline" label="Due date" />
              <Text style={styles.dueValue}>{formatDueDate(draft.dueDate)}</Text>
              <View style={styles.quickRow}>
                <Pressable onPress={() => applyQuickDueDate(isoDateAtOffset(0))} style={styles.quickButton}>
                  <Text style={styles.quickButtonText}>Today</Text>
                </Pressable>
                <Pressable onPress={() => applyQuickDueDate(isoDateAtOffset(1))} style={styles.quickButton}>
                  <Text style={styles.quickButtonText}>Tomorrow</Text>
                </Pressable>
                <Pressable onPress={() => applyQuickDueDate(isoDateAtOffset(7))} style={styles.quickButton}>
                  <Text style={styles.quickButtonText}>+7 days</Text>
                </Pressable>
                <Pressable onPress={() => applyQuickDueDate(null)} style={styles.quickButton}>
                  <Text style={styles.quickButtonText}>Clear</Text>
                </Pressable>
              </View>

              <SectionTitle icon="time-outline" label="Estimate (minutes)" />
              <TextInput
                value={draft.estimateMinutesText}
                onChangeText={(value) => {
                  setDraft((current) => (current ? { ...current, estimateMinutesText: value } : current));
                  setSuccessMessage(null);
                  setSubmitError(null);
                }}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder="Optional"
                style={styles.input}
              />
            </SurfaceCard>

            <SurfaceCard style={styles.sectionSpacing}>
              <SectionTitle icon="document-text-outline" label="Description" />
              <TextInput
                multiline
                value={draft.description}
                onChangeText={(value) => {
                  setDraft((current) => (current ? { ...current, description: value } : current));
                  setSuccessMessage(null);
                  setSubmitError(null);
                }}
                placeholder="Optional details"
                style={[styles.input, styles.multilineInput]}
                textAlignVertical="top"
              />

              <SectionTitle icon="ban-outline" label="Blocked reason" />
              <TextInput
                multiline
                value={draft.blockedReason}
                onChangeText={(value) => {
                  setDraft((current) => (current ? { ...current, blockedReason: value } : current));
                  setSuccessMessage(null);
                  setSubmitError(null);
                }}
                placeholder={
                  draft.status === 'blocked'
                    ? 'Required for blocked tasks'
                    : 'Only used when status is Blocked'
                }
                style={[styles.input, styles.multilineInput]}
                textAlignVertical="top"
              />
              {draft.status !== 'blocked' ? (
                <Text style={styles.helperText}>This field is ignored unless status is Blocked.</Text>
              ) : null}
            </SurfaceCard>

            {submitError ? (
              <View style={styles.feedbackError}>
                <Ionicons name="alert-circle" size={16} color={mobileTheme.colors.danger} />
                <Text style={styles.feedbackErrorText}>{submitError}</Text>
              </View>
            ) : null}
            {successMessage ? (
              <View style={styles.feedbackSuccess}>
                <Ionicons name="checkmark-circle" size={16} color={mobileTheme.colors.success} />
                <Text style={styles.feedbackSuccessText}>{successMessage}</Text>
              </View>
            ) : null}

            <View style={styles.footerActions}>
              <Pressable disabled={isSaving} onPress={() => router.back()} style={styles.ghostButton}>
                <Text style={styles.ghostButtonText}>Back</Text>
              </Pressable>
              <Pressable disabled={isSaving} onPress={onSave} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>
                  {isSaving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    paddingBottom: 28,
    paddingTop: 14,
  },
  dueValue: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.bold,
    marginTop: 6,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    marginTop: 12,
    textAlign: 'center',
  },
  feedbackError: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.dangerBg,
    borderRadius: mobileTheme.radius.md,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  feedbackErrorText: {
    color: mobileTheme.colors.danger,
    flex: 1,
    fontWeight: mobileTheme.font.semibold,
  },
  feedbackSuccess: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.successBg,
    borderRadius: mobileTheme.radius.md,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  feedbackSuccessText: {
    color: mobileTheme.colors.success,
    flex: 1,
    fontWeight: mobileTheme.font.semibold,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  ghostButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  ghostButtonText: {
    color: mobileTheme.colors.text,
    fontWeight: mobileTheme.font.bold,
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
  keyboard: {
    flex: 1,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    marginTop: 6,
  },
  multilineInput: {
    minHeight: 92,
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
  quickButton: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  quickButtonText: {
    color: mobileTheme.colors.text,
    fontWeight: mobileTheme.font.bold,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  sectionSpacing: {
    marginTop: 12,
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
  subtitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  taskTitle: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.extrabold,
  },
});
