import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
          <GlassButton onPress={() => router.back()} title="Back" variant="secondary" />
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
          <GlassButton onPress={onRetry} title="Retry" />
          <GlassButton onPress={() => router.back()} title="Back" variant="secondary" />
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

            <GlassCard variant="fake">
              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.meta}>
                {task.project.name}
                {task.goal ? ` · ${task.goal.title}` : ''}
              </Text>
              <Text style={styles.meta}>Updated {formatTimestamp(task.updatedAt)}</Text>
            </GlassCard>

            <GlassCard variant="fake" style={styles.sectionSpacing}>
              <SectionTitle icon="flag-outline" label="Status" />
              <GlassSegmentedControl
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
              <GlassSegmentedControl
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
            </GlassCard>

            <GlassCard variant="fake" style={styles.sectionSpacing}>
              <SectionTitle icon="calendar-outline" label="Due date" />
              <Text style={styles.dueValue}>{formatDueDate(draft.dueDate)}</Text>
              <View style={styles.quickRow}>
                <GlassPill
                  label="Today"
                  onPress={() => applyQuickDueDate(isoDateAtOffset(0))}
                  selected={draft.dueDate === isoDateAtOffset(0)}
                />
                <GlassPill
                  label="Tomorrow"
                  onPress={() => applyQuickDueDate(isoDateAtOffset(1))}
                  selected={draft.dueDate === isoDateAtOffset(1)}
                />
                <GlassPill
                  label="+7 days"
                  onPress={() => applyQuickDueDate(isoDateAtOffset(7))}
                  selected={draft.dueDate === isoDateAtOffset(7)}
                />
                <GlassPill
                  label="Clear"
                  onPress={() => applyQuickDueDate(null)}
                  selected={draft.dueDate === null}
                />
              </View>

              <SectionTitle icon="time-outline" label="Estimate (minutes)" />
              <GlassInput
                value={draft.estimateMinutesText}
                onChangeText={(value) => {
                  setDraft((current) => (current ? { ...current, estimateMinutesText: value } : current));
                  setSuccessMessage(null);
                  setSubmitError(null);
                }}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder="Optional"
              />
            </GlassCard>

            <GlassCard variant="fake" style={styles.sectionSpacing}>
              <SectionTitle icon="document-text-outline" label="Description" />
              <GlassInput
                multiline
                value={draft.description}
                onChangeText={(value) => {
                  setDraft((current) => (current ? { ...current, description: value } : current));
                  setSuccessMessage(null);
                  setSubmitError(null);
                }}
                placeholder="Optional details"
                textAlignVertical="top"
              />

              <SectionTitle icon="ban-outline" label="Blocked reason" />
              <GlassInput
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
                textAlignVertical="top"
              />
              {draft.status !== 'blocked' ? (
                <Text style={styles.helperText}>This field is ignored unless status is Blocked.</Text>
              ) : null}
            </GlassCard>

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

            <GlassCard
              variant="fake"
              style={styles.footerActions}
              contentStyle={styles.footerActionsContent}
            >
              <GlassButton
                disabled={isSaving}
                fullWidth
                onPress={() => router.back()}
                style={styles.footerButton}
                title="Back"
                variant="secondary"
              />
              <GlassButton
                disabled={isSaving}
                fullWidth
                loading={isSaving}
                onPress={onSave}
                style={styles.footerButton}
                title={dirty ? 'Save changes' : 'Saved'}
              />
            </GlassCard>
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
    paddingBottom: mobileTheme.layout.stickyActionClearance,
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
    marginTop: 18,
  },
  footerActionsContent: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.sm,
  },
  footerButton: {
    flex: 1,
  },
  helperText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  keyboard: {
    flex: 1,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    marginTop: 6,
  },
  pagePadding: {
    paddingHorizontal: 16,
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
