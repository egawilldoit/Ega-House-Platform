import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { Chip } from '@/components/mobile/ui/Chip';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { FormSection } from '@/components/mobile/ui/FormSection';
import type { MobileTaskReminder } from '@/types/tasks';

import { createDefaultReminderDate, formatReminderDraft, formatReminderTimestamp } from './formatters';
import { formatTaskToken } from '@/features/tasks/form-utils';

type ReminderPickerMode = 'date' | 'time';

type Props = {
  reminderDate: Date | null;
  reminderPickerVisible: boolean;
  reminderPickerMode: ReminderPickerMode;
  pendingReminders: MobileTaskReminder[];
  completedReminders: MobileTaskReminder[];
  reminderError: string | null;
  reminderSuccess: string | null;
  isReminderSubmitting: boolean;
  isCancellingReminder: boolean;
  cancellingReminderId: string | null;
  onOpenPicker: (mode: ReminderPickerMode) => void;
  onReminderDateChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
  onHidePicker: () => void;
  onCreateReminder: () => void;
  onCancelReminder: (reminderId: string) => void;
  onClearDate: () => void;
};

export function TaskReminderSection({
  reminderDate,
  reminderPickerVisible,
  reminderPickerMode,
  pendingReminders,
  completedReminders,
  reminderError,
  reminderSuccess,
  isReminderSubmitting,
  isCancellingReminder,
  cancellingReminderId,
  onOpenPicker,
  onReminderDateChange,
  onHidePicker,
  onCreateReminder,
  onCancelReminder,
  onClearDate,
}: Props) {
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  return (
    <FormSection icon="notifications-outline" title="Reminder" description="Email reminder scheduling">
      <Pressable
        accessibilityRole="button"
        disabled={isReminderSubmitting}
        onPress={() => onOpenPicker('date')}
        style={({ pressed }) => [styles.dateField, pressed && !isReminderSubmitting ? styles.pressed : null]}
      >
        <Text style={styles.dateFieldLabel}>Remind at</Text>
        <Text style={[styles.dateFieldValue, !reminderDate ? styles.dateFieldPlaceholder : null]}>
          {formatReminderDraft(reminderDate)}
        </Text>
        <Text style={styles.dateFieldMeta}>Email</Text>
      </Pressable>

      <View style={styles.quickRow}>
        <Button
          disabled={isReminderSubmitting}
          onPress={() => onOpenPicker('date')}
          size="sm"
          title="Date"
          variant={reminderPickerMode === 'date' && reminderPickerVisible ? 'primary' : 'secondary'}
        />
        <Button
          disabled={isReminderSubmitting}
          onPress={() => onOpenPicker('time')}
          size="sm"
          title="Time"
          variant={reminderPickerMode === 'time' && reminderPickerVisible ? 'primary' : 'secondary'}
        />
        <Button
          disabled={isReminderSubmitting}
          onPress={onClearDate}
          size="sm"
          title="Clear"
          variant="secondary"
        />
      </View>

      {reminderPickerVisible ? (
        <View style={styles.pickerCard}>
          <View style={styles.pickerContent}>
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={reminderPickerMode === 'date' ? new Date() : undefined}
              mode={reminderPickerMode}
              onChange={onReminderDateChange}
              value={reminderDate ?? createDefaultReminderDate()}
            />
            {Platform.OS === 'ios' ? (
              <View style={styles.pickerActions}>
                <Button onPress={onHidePicker} size="sm" title="Done" />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <Button
        disabled={isReminderSubmitting}
        loading={isReminderSubmitting}
        onPress={onCreateReminder}
        style={styles.scheduleButton}
        title="Schedule email reminder"
      />

      <Text style={styles.groupLabel}>Pending</Text>
      {pendingReminders.length > 0 ? (
        <View style={styles.list}>
          {pendingReminders.map((reminder) => (
            <View key={reminder.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.reminderTime}>{formatReminderTimestamp(reminder.remindAt)}</Text>
                <Text style={styles.reminderMeta}>Email · Pending</Text>
                {reminder.failureReason ? (
                  <Text style={styles.failureText}>{reminder.failureReason}</Text>
                ) : null}
              </View>
              <Button
                disabled={isCancellingReminder}
                loading={cancellingReminderId === reminder.id}
                onPress={() => onCancelReminder(reminder.id)}
                size="sm"
                title="Cancel"
                variant="secondary"
              />
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyText}>No pending reminders.</Text>
      )}

      {completedReminders.length > 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setIsHistoryExpanded((v) => !v)}
            style={styles.historyHeader}
          >
            <Text style={styles.historyLabel}>History · {completedReminders.length}</Text>
            <Ionicons
              name={isHistoryExpanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={mobileTheme.colors.textMuted}
            />
            <Text style={styles.historyToggle}>{isHistoryExpanded ? 'Hide' : 'Show'}</Text>
          </Pressable>
          {isHistoryExpanded ? (
            <View style={styles.list}>
              {completedReminders.map((reminder) => (
                <View key={reminder.id} style={[styles.row, styles.historyRow]}>
                  <View style={styles.rowText}>
                    <Text style={styles.reminderTimeMuted}>{formatReminderTimestamp(reminder.remindAt)}</Text>
                    <Text style={styles.reminderMeta}>Email · {formatTaskToken(reminder.status)}</Text>
                    {reminder.failureReason ? (
                      <Text style={styles.failureText}>{reminder.failureReason}</Text>
                    ) : null}
                  </View>
                  <Chip kind="status" value={reminder.status} style={styles.historyChip} />
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {reminderError ? <FeedbackBanner message={reminderError} tone="danger" style={styles.banner} /> : null}
      {reminderSuccess ? <FeedbackBanner message={reminderSuccess} tone="success" style={styles.banner} /> : null}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: 10,
  },
  dateField: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: mobileTheme.spacing.md,
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
  emptyText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 6,
  },
  failureText: {
    color: mobileTheme.colors.danger,
    fontSize: 11,
    marginTop: 3,
  },
  groupLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 8,
  },
  historyChip: {
    alignSelf: 'center',
  },
  historyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    paddingVertical: 4,
  },
  historyLabel: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  historyRow: {
    opacity: 0.92,
  },
  historyToggle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
    marginLeft: 'auto',
  },
  list: {
    gap: 8,
    marginTop: 6,
  },
  pickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  pickerCard: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    overflow: 'hidden',
  },
  pickerContent: {
    padding: 8,
  },
  pressed: {
    opacity: 0.72,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  reminderMeta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  reminderTime: {
    color: mobileTheme.colors.text,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
  },
  reminderTimeMuted: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  row: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  scheduleButton: {
    marginTop: 10,
  },
});
