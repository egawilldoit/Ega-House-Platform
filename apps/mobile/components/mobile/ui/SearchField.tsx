import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

export type SearchFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search tasks, projects, goals',
  autoFocus = false,
  style,
  testID,
}: SearchFieldProps) {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <Ionicons color={mobileTheme.colors.textSubtle} name="search" size={16} style={styles.leftIcon} />
      <TextInput
        accessibilityLabel="Search"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor={mobileTheme.colors.textSubtle}
        returnKeyType="search"
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          onPress={() => onChangeText('')}
          style={styles.clear}
        >
          <Ionicons color={mobileTheme.colors.textMuted} name="close-circle" size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: {
    alignItems: 'center',
    height: mobileTheme.layout.minTouchTarget,
    justifyContent: 'center',
    width: mobileTheme.layout.minTouchTarget,
  },
  container: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingLeft: mobileTheme.spacing.md,
    ...mobileTheme.shadow.control,
  },
  input: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  leftIcon: {
    marginRight: mobileTheme.spacing.sm,
  },
});
