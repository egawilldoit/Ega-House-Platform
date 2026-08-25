import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { Button } from '@/components/mobile/ui/Button';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { FormField } from '@/components/mobile/ui/FormField';
import { FormSection } from '@/components/mobile/ui/FormSection';
import { normalizeMobileProjectSlug } from '@/features/projects/form-utils';
import { useCreateProjectMutation } from '@/features/projects/query';

export function ProjectCreateScreen() {
  const createProjectMutation = useCreateProjectMutation();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const slug = useMemo(() => normalizeMobileProjectSlug(name), [name]);
  const isSubmitting = createProjectMutation.isPending;
  const canSubmit = name.trim().length > 0 && slug.length > 0 && !isSubmitting;

  const onSubmit = () => {
    if (!canSubmit) {
      return;
    }

    setSubmitError(null);
    createProjectMutation.mutate(
      { name: name.trim(), slug, description: description.trim() || null },
      {
        onSuccess: () => {
          router.back();
        },
        onError: (error) => {
          setSubmitError(error instanceof Error ? error.message : 'Unable to create project.');
        },
      },
    );
  };

  return (
    <AppScreen padded={false} testID="project-create-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pagePadding}>
            <ScreenHeader
              eyebrow="Planning"
              title="New Project"
              description="A container for goals and tasks that share an outcome"
            />

            <FormSection icon="folder-outline" title="Identity" description="Name that drives the URL slug">
              <FormField
                autoCapitalize="words"
                label="Name"
                onChangeText={(value) => {
                  setName(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="e.g. Launch the platform"
                required
                value={name}
              />
              <View style={styles.slugRow}>
                <Text style={styles.slugLabel}>Derived slug</Text>
                <Text style={styles.slugValue} testID="project-slug-preview">
                  {slug.length > 0 ? `/${slug}` : 'Slug is derived from the name'}
                </Text>
                <Text style={styles.slugHelper}>Read-only · updates live as you type</Text>
              </View>
            </FormSection>

            <FormSection
              icon="document-text-outline"
              title="Details"
              description="Optional context for this project"
            >
              <FormField
                autoCapitalize="sentences"
                label="Description"
                helperText="What outcome does this project serve?"
                multiline
                onChangeText={(value) => {
                  setDescription(value);
                  if (submitError) {
                    setSubmitError(null);
                  }
                }}
                placeholder="What outcome does this project serve?"
                textAlignVertical="top"
                value={description}
              />
            </FormSection>

            {submitError ? (
              <FeedbackBanner message={submitError} tone="danger" style={styles.inlineError} />
            ) : null}
          </View>
        </ScrollView>

        <View style={styles.stickyBar}>
          <View style={styles.stickyContent}>
            <Button
              disabled={isSubmitting}
              onPress={() => router.back()}
              style={styles.actionButton}
              title="Cancel"
              variant="secondary"
            />
            <Button
              disabled={!canSubmit}
              loading={isSubmitting}
              onPress={onSubmit}
              style={styles.actionButton}
              title="Create Project"
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    flex: 1,
  },
  content: {
    paddingBottom: mobileTheme.layout.stickyActionClearance,
    paddingTop: 14,
  },
  inlineError: {
    marginTop: mobileTheme.spacing.md,
  },
  pagePadding: {
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  screen: {
    flex: 1,
  },
  slugHelper: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 4,
  },
  slugLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  slugRow: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  slugValue: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 4,
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
