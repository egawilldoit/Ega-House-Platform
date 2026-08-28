import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type FormFieldProps = TextInputProps & {
  label?: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputContainerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

export function FormField({
  label,
  helperText,
  error,
  required = false,
  containerStyle,
  inputContainerStyle,
  inputStyle,
  multiline = false,
  style,
  placeholderTextColor = mobileTheme.colors.textSubtle,
  editable,
  ...inputProps
}: FormFieldProps) {
  const supportingText = error ?? helperText;
  const isError = Boolean(error);
  const inputAccessibilityLabel = [
    // Prefer explicit accessibilityLabel, fall back to visible label, then error.
    (inputProps as { accessibilityLabel?: string }).accessibilityLabel ?? label,
    isError ? `Error: ${error}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}
      <View
        style={[
          styles.inputShell,
          multiline ? styles.inputShellMultiline : null,
          isError ? styles.inputShellError : null,
          inputContainerStyle,
        ]}
      >
        <TextInput
          accessibilityLabel={inputAccessibilityLabel || undefined}
          editable={editable}
          multiline={multiline}
          placeholderTextColor={placeholderTextColor}
          style={[styles.input, multiline ? styles.inputMultiline : null, style, inputStyle]}
          {...inputProps}
        />
      </View>
      <View style={styles.supportingWrap} accessibilityLiveRegion="polite">
        <Text style={[styles.supportingText, isError ? styles.errorText : null]}>
          {supportingText ?? ' '}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 7,
  },
  errorText: {
    color: mobileTheme.colors.danger,
  },
  input: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: mobileTheme.font.semibold,
    minHeight: 24,
    padding: 0,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    minHeight: 52,
    paddingHorizontal: mobileTheme.spacing.md,
    ...mobileTheme.shadow.control,
  },
  inputShellError: {
    borderColor: mobileTheme.colors.danger,
  },
  inputShellMultiline: {
    alignItems: 'flex-start',
    paddingVertical: mobileTheme.spacing.md,
  },
  label: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  required: {
    color: mobileTheme.colors.danger,
  },
  supportingWrap: {
    minHeight: 20,
    justifyContent: 'center',
  },
  supportingText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.medium,
    lineHeight: 16,
  },
});
