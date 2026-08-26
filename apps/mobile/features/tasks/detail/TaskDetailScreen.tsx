/* eslint-disable react-hooks/set-state-in-effect -- task → draft sync is intentional; draft is local editable copy */
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { SkeletonCard, SkeletonLine } from '@/components/mobile/ui/Skeleton';
import { validateEstimateMinutesInput } from '@/features/tasks/form-utils';
import {
  useCancelTaskReminderMutation,
  useCreateTaskReminderMutation,
  useTaskByIdQuery,
  useUpdateTaskMutation,
} from '@/features/tasks/query';
import type { MobileTaskReminder } from '@/types/tasks';

import {
  createDefaultReminderDate,
  createEditableDraft,
  isDraftDirty,
  sortReminders,
  type EditableTaskFields,
  type ReminderPickerMode,
} from './formatters';
import { TaskDetailsSection } from './TaskDetailsSection';
import { TaskIdentityCard } from './TaskIdentityCard';
import { TaskReminderSection } from './TaskReminderSection';
import { TaskSaveBar } from './TaskSaveBar';
import { TaskScheduleSection } from './TaskScheduleSection';
import { TaskStateSection } from './TaskStateSection';

export function TaskDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const taskId = useMemo(() => String(id ?? '').trim(), [id]);

  const taskQuery = useTaskByIdQuery(taskId);
  const updateTaskMutation = useUpdateTaskMutation();
  const createReminderMutation = useCreateTaskReminderMutation();
  const cancelReminderMutation = useCancelTaskReminderMutation();
  const { refetch } = taskQuery;

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableTaskFields | null>(null);
  const [reminderDate, setReminderDate] = useState<Date | null>(createDefaultReminderDate);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [reminderSuccess, setReminderSuccess] = useState<string | null>(null);
  const [isReminderPickerVisible, setIsReminderPickerVisible] = useState(false);
  const [reminderPickerMode, setReminderPickerMode] = useState<ReminderPickerMode>('date');
  const [cancellingReminderId, setCancellingReminderId] = useState<string | null>(null);

  const task = taskQuery.data ?? null;
  const reminders = useMemo(() => sortReminders(task?.reminders ?? []), [task?.reminders]);
  const pendingReminders = useMemo(
    () =>
      reminders
        .filter((reminder) => reminder.status === 'pending')
        .sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime()),
    [reminders],
  );
  const completedReminders = useMemo(
    () => reminders.filter((reminder) => reminder.status !== 'pending').slice(0, 3),
    [reminders],
  );

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

  const clearMessages = useCallback(() => {
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
          recurrenceRule: draft.recurrenceRule,
          recurrenceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
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

  const openReminderPicker = useCallback((mode: ReminderPickerMode) => {
    setReminderPickerMode(mode);
    setIsReminderPickerVisible(true);
    setReminderError(null);
    setReminderSuccess(null);
  }, []);

  const onHidePicker = useCallback(() => {
    setIsReminderPickerVisible(false);
  }, []);

  const onReminderDateChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === 'android') {
        setIsReminderPickerVisible(false);
      }

      if (event.type === 'dismissed' || !selectedDate) {
        return;
      }

      setReminderDate((current) => {
        const next = new Date(current ?? createDefaultReminderDate());
        if (reminderPickerMode === 'date') {
          next.setFullYear(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDate.getDate(),
          );
        } else {
          next.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
        }
        return next;
      });
      setReminderError(null);
      setReminderSuccess(null);
    },
    [reminderPickerMode],
  );

  const onClearReminderDate = useCallback(() => {
    setReminderDate(null);
    setIsReminderPickerVisible(false);
    setReminderSuccess(null);
    setReminderError(null);
  }, []);

  const onCreateReminder = useCallback(async () => {
    if (!taskId) {
      return;
    }

    if (!reminderDate || Number.isNaN(reminderDate.getTime())) {
      setReminderError('Reminder time is required.');
      setReminderSuccess(null);
      return;
    }

    if (reminderDate.getTime() <= Date.now()) {
      setReminderError('Reminder time must be in the future.');
      setReminderSuccess(null);
      return;
    }

    setReminderError(null);
    setReminderSuccess(null);

    try {
      await createReminderMutation.mutateAsync({
        taskId,
        remindAt: reminderDate.toISOString(),
      });
      setReminderDate(createDefaultReminderDate());
      setIsReminderPickerVisible(false);
      setReminderSuccess('Reminder scheduled.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to schedule reminder right now.';
      setReminderError(message);
    }
  }, [createReminderMutation, reminderDate, taskId]);

  const onCancelReminder = useCallback(
    async (reminderId: string) => {
      if (!taskId) {
        return;
      }

      setCancellingReminderId(reminderId);
      setReminderError(null);
      setReminderSuccess(null);

      try {
        await cancelReminderMutation.mutateAsync({ taskId, reminderId });
        setReminderSuccess('Reminder cancelled.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to cancel reminder right now.';
        setReminderError(message);
      } finally {
        setCancellingReminderId(null);
      }
    },
    [cancelReminderMutation, taskId],
  );

  if (!taskId) {
    return (
      <AppScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Task details</Text>
          <FeedbackBanner message="Task id is missing." tone="danger" style={styles.banner} />
          <Button onPress={() => router.back()} title="Back" variant="secondary" />
        </View>
      </AppScreen>
    );
  }

  if (taskQuery.isError) {
    const loadError =
      taskQuery.error instanceof Error ? taskQuery.error.message : 'Unable to load task right now.';

    return (
      <AppScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Task details</Text>
          <FeedbackBanner message={loadError} tone="danger" style={styles.banner} />
          <View style={styles.errorActions}>
            <Button onPress={onRetry} title="Retry" />
            <Button onPress={() => router.back()} title="Back" variant="secondary" />
          </View>
        </View>
      </AppScreen>
    );
  }

  if (taskQuery.isPending || !draft || !task) {
    return (
      <AppScreen testID="task-detail-loading">
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.loadingText}>Loading task...</Text>
          <SkeletonCard />
          <SkeletonLine width="70%" height={48} />
        </View>
      </AppScreen>
    );
  }

  const dirty = isDraftDirty(task, draft);
  const isSaving = updateTaskMutation.isPending;
  const isReminderSubmitting = createReminderMutation.isPending;
  const isCancellingReminder = cancelReminderMutation.isPending;

  return (
    <AppScreen padded={false} testID="task-detail-screen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: mobileTheme.layout.stickyActionClearance + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pagePadding}>
            <ScreenHeader
              eyebrow="Task"
              title="Edit task"
              description={dirty ? 'Unsaved changes' : 'All changes saved'}
            />

            <TaskIdentityCard task={task} />

            <TaskStateSection draft={draft} onChange={setDraft} onClearMessages={clearMessages} />

            <TaskScheduleSection
              taskRecurrenceTimezone={task.recurrence?.timezone ?? null}
              draft={draft}
              onChange={setDraft}
              onClearMessages={clearMessages}
            />

            <TaskDetailsSection draft={draft} onChange={setDraft} onClearMessages={clearMessages} />

            <TaskReminderSection
              reminderDate={reminderDate}
              reminderPickerVisible={isReminderPickerVisible}
              reminderPickerMode={reminderPickerMode}
              pendingReminders={pendingReminders as MobileTaskReminder[]}
              completedReminders={completedReminders as MobileTaskReminder[]}
              reminderError={reminderError}
              reminderSuccess={reminderSuccess}
              isReminderSubmitting={isReminderSubmitting}
              isCancellingReminder={isCancellingReminder}
              cancellingReminderId={cancellingReminderId}
              onOpenPicker={openReminderPicker}
              onReminderDateChange={onReminderDateChange}
              onHidePicker={onHidePicker}
              onCreateReminder={onCreateReminder}
              onCancelReminder={onCancelReminder}
              onClearDate={onClearReminderDate}
            />
          </View>
        </ScrollView>

        <TaskSaveBar
          dirty={dirty}
          isSaving={isSaving}
          submitError={submitError}
          successMessage={successMessage}
          onBack={() => router.back()}
          onSave={onSave}
        />
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: 12,
    width: '100%',
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
  errorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  flex: {
    flex: 1,
  },
  loadingText: {
    color: mobileTheme.colors.textMuted,
    marginTop: 8,
  },
  loadingWrap: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
  },
  pagePadding: {
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  skeleton: {
    height: 72,
    marginTop: 8,
    width: '100%',
  },
  skeletonShort: {
    height: 48,
    width: '70%',
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.extrabold,
  },
});
