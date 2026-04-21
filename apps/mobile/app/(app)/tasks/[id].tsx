import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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
import { fetchMobileTaskById, updateMobileTask } from '@/lib/api/tasks';
import type { MobileTaskListItem, MobileTaskPriority, MobileTaskStatus } from '@/types/tasks';

const STATUS_OPTIONS: MobileTaskStatus[] = ['todo', 'in_progress', 'done', 'blocked'];
const PRIORITY_OPTIONS: MobileTaskPriority[] = ['low', 'medium', 'high', 'urgent'];

type EditableTaskFields = {
  status: MobileTaskStatus;
  priority: MobileTaskPriority;
  dueDate: string | null;
  estimateMinutesText: string;
  description: string;
  blockedReason: string;
};

function formatTaskToken(value: string) {
  return value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

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

function parseEstimateMinutes(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    return 'invalid';
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'invalid';
  }

  return parsed;
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

export default function TaskDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const taskId = useMemo(() => String(id ?? '').trim(), [id]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [task, setTask] = useState<MobileTaskListItem | null>(null);
  const [draft, setDraft] = useState<EditableTaskFields | null>(null);

  const loadTask = useCallback(async () => {
    if (!taskId) {
      setLoadError('Task id is missing.');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetchMobileTaskById(taskId);
      setTask(response.task);
      setDraft(createEditableDraft(response.task));
      setLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load task right now.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      loadTask().catch(() => {
        // handled in loadTask
      });
    }, [loadTask]),
  );

  const onRetry = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    loadTask().catch(() => {
      // handled in loadTask
    });
  }, [loadTask]);

  const applyQuickDueDate = useCallback((nextDueDate: string | null) => {
    setDraft((current) => (current ? { ...current, dueDate: nextDueDate } : current));
    setSuccessMessage(null);
    setSubmitError(null);
  }, []);

  const onSave = useCallback(async () => {
    if (!taskId || !draft) {
      return;
    }

    const estimateMinutes = parseEstimateMinutes(draft.estimateMinutesText);
    if (estimateMinutes === 'invalid') {
      setSubmitError('Estimate must be a whole number of minutes.');
      setSuccessMessage(null);
      return;
    }

    if (draft.status === 'blocked' && !draft.blockedReason.trim()) {
      setSubmitError('Blocked reason is required when status is Blocked.');
      setSuccessMessage(null);
      return;
    }

    setIsSaving(true);
    setSubmitError(null);
    setSuccessMessage(null);

    try {
      const response = await updateMobileTask(taskId, {
        status: draft.status,
        priority: draft.priority,
        dueDate: draft.dueDate,
        estimateMinutes,
        description: draft.description.trim() || null,
        blockedReason: draft.blockedReason.trim() || null,
      });

      setTask(response.task);
      setDraft(createEditableDraft(response.task));
      setSuccessMessage('Task updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update task right now.';
      setSubmitError(message);
    } finally {
      setIsSaving(false);
    }
  }, [draft, taskId]);

  if (isLoading) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.subtitle}>Loading task...</Text>
        </View>
      </MobileScreen>
    );
  }

  if (loadError || !task || !draft) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Task details</Text>
          <Text style={styles.errorText}>{loadError ?? 'Task not found.'}</Text>
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
              <Text style={styles.sectionTitle}>Status</Text>
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
                options={STATUS_OPTIONS.map((option) => ({
                  label: formatTaskToken(option),
                  value: option,
                }))}
                value={draft.status}
              />

              <Text style={styles.sectionTitle}>Priority</Text>
              <SegmentedControl
                onChange={(priority) => {
                  setDraft((current) => (current ? { ...current, priority } : current));
                  setSuccessMessage(null);
                  setSubmitError(null);
                }}
                options={PRIORITY_OPTIONS.map((option) => ({
                  label: formatTaskToken(option),
                  value: option,
                }))}
                value={draft.priority}
              />
            </SurfaceCard>

            <SurfaceCard style={styles.sectionSpacing}>
              <Text style={styles.sectionTitle}>Due date</Text>
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

              <Text style={styles.sectionTitle}>Estimate (minutes)</Text>
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
              <Text style={styles.sectionTitle}>Description</Text>
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

              <Text style={styles.sectionTitle}>Blocked reason</Text>
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

            {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
            {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

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
    fontWeight: '700',
    marginTop: 6,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    marginTop: 12,
    textAlign: 'center',
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  ghostButton: {
    alignItems: 'center',
    backgroundColor: '#ecf2f8',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
  },
  ghostButtonText: {
    color: mobileTheme.colors.text,
    fontWeight: '700',
  },
  helperText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderColor: mobileTheme.colors.border,
    borderRadius: 12,
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
    paddingHorizontal: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  quickButton: {
    backgroundColor: '#eef2f7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  quickButtonText: {
    color: mobileTheme.colors.text,
    fontWeight: '700',
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
    fontWeight: '800',
    marginTop: 12,
  },
  subtitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  successText: {
    color: mobileTheme.colors.success,
    marginTop: 12,
    textAlign: 'center',
  },
  taskTitle: {
    color: mobileTheme.colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
});
