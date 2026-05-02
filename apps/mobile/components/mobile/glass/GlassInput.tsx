import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { mobileTheme } from '../theme';

export type GlassInputProps = TextInputProps & {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

export function GlassInput({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  containerStyle,
  inputStyle,
  multiline,
  style,
  placeholderTextColor = mobileTheme.colors.textSubtle,
  ...inputProps
}: GlassInputProps) {
  const supportingText = error ?? helperText;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.inputShell,
          multiline ? styles.inputShellMultiline : null,
          error ? styles.inputShellError : null,
        ]}
      >
        {leftIcon ? <View style={styles.icon}>{leftIcon}</View> : null}
        <TextInput
          multiline={multiline}
          placeholderTextColor={placeholderTextColor}
          style={[styles.input, multiline ? styles.inputMultiline : null, style, inputStyle]}
          {...inputProps}
        />
        {rightIcon ? <View style={styles.icon}>{rightIcon}</View> : null}
      </View>
      {supportingText ? (
        <Text style={[styles.supportingText, error ? styles.errorText : null]}>
          {supportingText}
        </Text>
      ) : null}
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
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: mobileTheme.glass.surface,
    borderColor: mobileTheme.glass.border,
    borderRadius: mobileTheme.radius.lg,
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
    color: mobileTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
  },
  supportingText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.medium,
    lineHeight: 17,
  },
});
