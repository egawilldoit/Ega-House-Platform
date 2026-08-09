import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MobileScreen, MobileScreenHeader } from '@/components/mobile/primitives';
import { GlassButton, GlassCard, GlassInput } from '@/components/mobile/glass';
import { mobileTheme } from '@/components/mobile/theme';
import { normalizeMobileProjectSlug } from '@/features/projects/form-utils';
import { useCreateProjectMutation } from '@/features/projects/query';

export default function CreateProjectScreen() {
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
    <MobileScreen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <MobileScreenHeader
            eyebrow="Planning"
            title="New Project"
            description="A container for goals and tasks that share an outcome"
          />

          <GlassCard variant="fake" contentStyle={styles.formCard}>
            <GlassInput
              autoCapitalize="words"
              label="Name"
              onChangeText={setName}
              placeholder="e.g. Launch the platform"
              value={name}
            />
            <Text style={styles.slugPreview}>
              {slug.length > 0 ? `/${slug}` : 'Slug is derived from the name'}
            </Text>

            <GlassInput
              autoCapitalize="sentences"
              label="Description (optional)"
              multiline
              onChangeText={setDescription}
              placeholder="What outcome does this project serve?"
              style={styles.descriptionInput}
              value={description}
            />

            {submitError ? (
              <View style={styles.errorRow}>
                <Ionicons color={mobileTheme.colors.danger} name="alert-circle-outline" size={16} />
                <Text style={styles.errorText}>{submitError}</Text>
              </View>
            ) : null}

            <GlassButton
              disabled={!canSubmit}
              fullWidth
              loading={isSubmitting}
              onPress={onSubmit}
              title="Create Project"
            />
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: mobileTheme.spacing.lg,
  },
  descriptionInput: {
    minHeight: 96,
  },
  errorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginBottom: mobileTheme.spacing.md,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    flex: 1,
    fontSize: 13,
  },
  flex: {
    flex: 1,
  },
  formCard: {
    marginTop: mobileTheme.spacing.lg,
  },
  slugPreview: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginBottom: mobileTheme.spacing.md,
    marginTop: 2,
  },
});
