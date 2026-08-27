import { StyleSheet, Text } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { FormSection } from '@/components/mobile/ui/FormSection';
import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';
import { formatTaskToken } from '@/features/tasks/form-utils';
import {
  MOBILE_TASK_PRIORITY_VALUES,
  MOBILE_TASK_STATUS_VALUES,
  type MobileTaskPriority,
  type MobileTaskStatus,
} from '@/types/tasks';

import type { EditableTaskFields } from './formatters';

type Props = {
  draft: EditableTaskFields;
  onChange: (next: EditableTaskFields) => void;
  onClearMessages: () => void;
};

export function TaskStateSection({ draft, onChange, onClearMessages }: Props) {
  return (
    <FormSection icon="flag-outline" title="State" description="Status and priority">
      <Text style={styles.groupLabel}>Status</Text>
      <SegmentedControl
        onChange={(status) => {
          const nextStatus = status as MobileTaskStatus;
          onChange({
            ...draft,
            status: nextStatus,
            blockedReason: nextStatus === 'blocked' ? draft.blockedReason : '',
          });
          onClearMessages();
        }}
        options={MOBILE_TASK_STATUS_VALUES.map((option) => ({
          label: formatTaskToken(option),
          value: option,
        }))}
        value={draft.status}
      />

      <Text style={styles.groupLabel}>Priority</Text>
      <SegmentedControl
        onChange={(priority) => {
          onChange({ ...draft, priority: priority as MobileTaskPriority });
          onClearMessages();
        }}
        options={MOBILE_TASK_PRIORITY_VALUES.map((option) => ({
          label: formatTaskToken(option),
          value: option,
        }))}
        value={draft.priority}
      />
    </FormSection>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 4,
  },
});
