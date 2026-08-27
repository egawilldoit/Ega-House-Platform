import { StyleSheet, Text } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { FormField } from '@/components/mobile/ui/FormField';
import { FormSection } from '@/components/mobile/ui/FormSection';

import type { EditableTaskFields } from './formatters';

type Props = {
  draft: EditableTaskFields;
  onChange: (next: EditableTaskFields) => void;
  onClearMessages: () => void;
};

export function TaskDetailsSection({ draft, onChange, onClearMessages }: Props) {
  return (
    <FormSection icon="document-text-outline" title="Details" description="Description and blocked reason">
      <FormField
        helperText="What needs to happen?"
        label="Description"
        multiline
        onChangeText={(value) => {
          onChange({ ...draft, description: value });
          onClearMessages();
        }}
        placeholder="Optional details"
        textAlignVertical="top"
        value={draft.description}
      />

      <FormField
        helperText={
          draft.status === 'blocked' ? 'Required when status is Blocked' : 'Only used when status is Blocked'
        }
        label="Blocked reason"
        multiline
        onChangeText={(value) => {
          onChange({ ...draft, blockedReason: value });
          onClearMessages();
        }}
        placeholder={draft.status === 'blocked' ? 'Required for blocked tasks' : 'Only used when status is Blocked'}
        textAlignVertical="top"
        value={draft.blockedReason}
      />
      {draft.status !== 'blocked' ? (
        <Text style={styles.helperText}>This field is ignored unless status is Blocked.</Text>
      ) : null}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  helperText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
});
