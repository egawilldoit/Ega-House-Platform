import { Platform, StyleSheet, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';

type Props = {
  dirty: boolean;
  isSaving: boolean;
  submitError: string | null;
  successMessage: string | null;
  onBack: () => void;
  onSave: () => void;
};

export function TaskSaveBar({ dirty, isSaving, submitError, successMessage, onBack, onSave }: Props) {
  return (
    <View style={styles.stickyBar}>
      {submitError ? <FeedbackBanner message={submitError} tone="danger" style={styles.banner} /> : null}
      {successMessage ? <FeedbackBanner message={successMessage} tone="success" style={styles.banner} /> : null}
      <View style={styles.stickyContent}>
        <Button
          disabled={isSaving}
          onPress={onBack}
          style={styles.actionButton}
          title="Back"
          variant="secondary"
        />
        <Button
          disabled={isSaving}
          loading={isSaving}
          onPress={onSave}
          style={styles.actionButton}
          title={dirty ? 'Save changes' : 'Saved'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    flex: 1,
  },
  banner: {
    marginHorizontal: mobileTheme.spacing.lg,
    marginTop: mobileTheme.spacing.sm,
  },
  stickyBar: {
    backgroundColor: mobileTheme.colors.surface,
    borderTopColor: mobileTheme.colors.border,
    borderTopWidth: 1,
    ...mobileTheme.shadow.sheet,
  },
  stickyContent: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 26 : 14,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: 10,
  },
});
