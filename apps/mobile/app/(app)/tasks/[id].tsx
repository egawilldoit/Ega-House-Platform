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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

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

  return date.toLocaleDateString();
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
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.subtitle}>Loading task...</Text>
      </View>
    );
  }

  if (loadError || !task || !draft) {
    return (
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
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>Title</Text>
          <Text style={styles.value}>{task.title}</Text>
          <Text style={styles.meta}>
            {task.project.name}
            {task.goal ? ` · ${task.goal.title}` : ''}
          </Text>
          <Text style={styles.meta}>Updated {formatTimestamp(task.updatedAt)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={styles.optionRow}>
            {STATUS_OPTIONS.map((option) => {
              const selected = draft.status === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => {
                    setDraft((current) =>
                      current ? { ...current, status: option, blockedReason: option === 'blocked' ? current.blockedReason : '' } : current,
                    );
                    setSuccessMessage(null);
                    setSubmitError(null);
                  }}
                  style={[styles.optionChip, selected ? styles.optionChipActive : null]}
                >
                  <Text style={[styles.optionChipText, selected ? styles.optionChipTextActive : null]}>
                    {formatTaskToken(option)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Priority</Text>
          <View style={styles.optionRow}>
            {PRIORITY_OPTIONS.map((option) => {
              const selected = draft.priority === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => {
                    setDraft((current) => (current ? { ...current, priority: option } : current));
                    setSuccessMessage(null);
                    setSubmitError(null);
                  }}
                  style={[styles.optionChip, selected ? styles.optionChipActive : null]}
                >
                  <Text style={[styles.optionChipText, selected ? styles.optionChipTextActive : null]}>
                    {formatTaskToken(option)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Due date</Text>
          <Text style={styles.value}>{formatDueDate(draft.dueDate)}</Text>
          <View style={styles.optionRow}>
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
        </View>

        <View style={styles.card}>
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
            placeholder={draft.status === 'blocked' ? 'Required for blocked tasks' : 'Only used when status is Blocked'}
            style={[styles.input, styles.multilineInput]}
            textAlignVertical="top"
          />
          {draft.status !== 'blocked' ? (
            <Text style={styles.meta}>This field is ignored unless status is Blocked.</Text>
          ) : null}
        </View>

        {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
        {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

        <View style={styles.footerActions}>
          <Pressable disabled={isSaving} onPress={() => router.back()} style={styles.ghostButton}>
            <Text style={styles.ghostButtonText}>Back</Text>
          </Pressable>
          <Pressable disabled={isSaving} onPress={onSave} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{isSaving ? 'Saving...' : 'Save changes'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    gap: 12,
    padding: 14,
    paddingBottom: 24,
  },
  errorText: {
    color: '#dc2626',
    textAlign: 'center',
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  ghostButton: {
    borderColor: '#cbd5e1',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  ghostButtonText: {
    color: '#334155',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderRadius: 10,
    borderWidth: 1,
    color: '#0f172a',
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  meta: {
    color: '#64748b',
    marginTop: 6,
  },
  multilineInput: {
    minHeight: 88,
  },
  optionChip: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionChipActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  optionChipText: {
    color: '#334155',
    fontWeight: '600',
  },
  optionChipTextActive: {
    color: '#ffffff',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  quickButton: {
    borderColor: '#cbd5e1',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  quickButtonText: {
    color: '#334155',
    fontWeight: '600',
  },
  screen: {
    backgroundColor: '#f8fafc',
    flex: 1,
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  subtitle: {
    color: '#475569',
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  successText: {
    color: '#166534',
    textAlign: 'center',
  },
  title: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '700',
  },
  value: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
});
