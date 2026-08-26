import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { mobileTheme } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { FormField } from '@/components/mobile/ui/FormField';
import { FormSection } from '@/components/mobile/ui/FormSection';
import { MOBILE_TASK_RECURRENCE_RULE_VALUES } from '@/types/tasks';

import {
  formatDueDate,
  formatRecurrenceRule,
  isoDateAtOffset,
  type EditableTaskFields,
} from './formatters';

type Props = {
  taskRecurrenceTimezone: string | null;
  draft: EditableTaskFields;
  onChange: (next: EditableTaskFields) => void;
  onClearMessages: () => void;
};

export function TaskScheduleSection({ taskRecurrenceTimezone, draft, onChange, onClearMessages }: Props) {
  const deviceTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );
  const displayTimezone = taskRecurrenceTimezone ?? deviceTimezone;
  const [isDuePickerVisible, setIsDuePickerVisible] = useState(false);
  const [isRecurrenceExpanded, setIsRecurrenceExpanded] = useState(false);

  const duePickerValue = useMemo(() => {
    if (!draft.dueDate) return new Date();
    const parsed = new Date(`${draft.dueDate}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [draft.dueDate]);

  function onDueDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') {
      setIsDuePickerVisible(false);
    }
    if (event.type === 'dismissed' || !selectedDate) {
      return;
    }
    const year = selectedDate.getFullYear();
    const month = `${selectedDate.getMonth() + 1}`.padStart(2, '0');
    const day = `${selectedDate.getDate()}`.padStart(2, '0');
    const iso = `${year}-${month}-${day}`;
    onChange({ ...draft, dueDate: iso });
    onClearMessages();
  }

  return (
    <FormSection icon="calendar-outline" title="Schedule" description="Due date, estimate, and repeat">
      <Text style={styles.groupLabel}>Due date</Text>
      <Text style={styles.dueValue}>{formatDueDate(draft.dueDate)}</Text>
      <View style={styles.quickRow}>
        <QuickPill
          label="Today"
          onPress={() => {
            onChange({ ...draft, dueDate: isoDateAtOffset(0) });
            onClearMessages();
          }}
          selected={draft.dueDate === isoDateAtOffset(0)}
        />
        <QuickPill
          label="Tomorrow"
          onPress={() => {
            onChange({ ...draft, dueDate: isoDateAtOffset(1) });
            onClearMessages();
          }}
          selected={draft.dueDate === isoDateAtOffset(1)}
        />
        <QuickPill
          label="+7 days"
          onPress={() => {
            onChange({ ...draft, dueDate: isoDateAtOffset(7) });
            onClearMessages();
          }}
          selected={draft.dueDate === isoDateAtOffset(7)}
        />
        <QuickPill
          label="Clear"
          onPress={() => {
            onChange({ ...draft, dueDate: null });
            onClearMessages();
          }}
          selected={draft.dueDate === null}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => setIsDuePickerVisible((v) => !v)}
        style={({ pressed }) => [styles.dateField, pressed ? styles.dateFieldPressed : null]}
      >
        <Text style={styles.dateFieldLabel}>Pick a calendar date</Text>
        <Text style={[styles.dateFieldValue, !draft.dueDate ? styles.dateFieldPlaceholder : null]}>
          {formatDueDate(draft.dueDate)}
        </Text>
        <Text style={styles.dateFieldMeta}>Submits as YYYY-MM-DD</Text>
      </Pressable>

      {isDuePickerVisible ? (
        <View style={styles.pickerCard}>
          <View style={styles.pickerContent}>
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              mode="date"
              onChange={onDueDateChange}
              value={duePickerValue}
            />
            {Platform.OS === 'ios' ? (
              <View style={styles.pickerActions}>
                <Button
                  onPress={() => setIsDuePickerVisible(false)}
                  size="sm"
                  title="Done"
                  variant="secondary"
                />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <Text style={styles.helperText}>Picker selection still submits as YYYY-MM-DD.</Text>

      <FormField
        helperText="Whole minutes, up to 525600"
        keyboardType="number-pad"
        label="Estimate (minutes)"
        onChangeText={(value) => {
          onChange({ ...draft, estimateMinutesText: value });
          onClearMessages();
        }}
        placeholder="Optional"
        value={draft.estimateMinutesText}
      />

      <Text style={styles.groupLabel}>Repeat</Text>
      <View style={styles.quickRow}>
        <QuickPill
          label="None"
          onPress={() => {
            onChange({ ...draft, recurrenceRule: null });
            onClearMessages();
          }}
          selected={draft.recurrenceRule === null}
        />
        {(() => {
          const baseRules = ['daily', 'weekdays', 'monthly:day-of-month'] as const;
          const visible = isRecurrenceExpanded
            ? MOBILE_TASK_RECURRENCE_RULE_VALUES
            : Array.from(
                new Set([
                  ...baseRules,
                  ...(draft.recurrenceRule && !(baseRules as readonly string[]).includes(draft.recurrenceRule)
                    ? [draft.recurrenceRule]
                    : []),
                ]),
              ) as readonly string[];
          return visible.map((rule) => (
            <QuickPill
              key={rule}
              label={formatRecurrenceRule(rule as never)}
              onPress={() => {
                onChange({ ...draft, recurrenceRule: rule as never });
                onClearMessages();
              }}
              selected={draft.recurrenceRule === rule}
            />
          ));
        })()}
        <QuickPill
          label={isRecurrenceExpanded ? 'Less' : 'More'}
          onPress={() => setIsRecurrenceExpanded((v) => !v)}
          selected={false}
        />
      </View>

      <Text style={styles.timezoneText} numberOfLines={1}>
        {displayTimezone}
        {taskRecurrenceTimezone ? '' : ' · device on save'}
        {draft.recurrenceRule ? ` · ${formatRecurrenceRule(draft.recurrenceRule as never)}` : ' · no repeat'}
      </Text>
    </FormSection>
  );
}

function QuickPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : null,
        pressed ? styles.chipPressed : null,
      ]}
    >
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 7,
  },
  chipPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
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
  dateFieldPressed: {
    opacity: 0.72,
  },
  dateFieldValue: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.bold,
    marginTop: 4,
  },
  dueValue: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.bold,
    marginTop: 4,
  },
  groupLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 6,
  },
  helperText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    lineHeight: 16,
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
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  timezoneText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 8,
  },
});
