import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { TASK_VIEW_PRESETS, type TaskViewId } from '@/features/tasks/views';

export type TaskQuickFiltersProps = {
  activeViewId: TaskViewId | null;
  onSelect: (viewId: TaskViewId) => void;
  testID?: string;
};

export function TaskQuickFilters({ activeViewId, onSelect, testID }: TaskQuickFiltersProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      testID={testID}
      accessibilityLabel="Task views"
    >
      {TASK_VIEW_PRESETS.map((preset) => {
        const selected = activeViewId === preset.id;
        return (
          <Pressable
            key={preset.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(preset.id)}
            style={({ pressed }) => [
              styles.pill,
              selected ? styles.pillSelected : styles.pillIdle,
              pressed ? styles.pillPressed : null,
            ]}
          >
            <Text style={[styles.pillText, selected ? styles.pillTextSelected : null]}>{preset.label}</Text>
          </Pressable>
        );
      })}
      {activeViewId === null ? (
        <Pressable
          style={[styles.pill, styles.pillSelected]}
          accessibilityRole="button"
          accessibilityState={{ selected: true }}
        >
          <Text style={[styles.pillText, styles.pillTextSelected]}>Custom</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    justifyContent: 'center',
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: mobileTheme.spacing.md,
    borderWidth: 1,
  },
  pillIdle: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
  },
  pillPressed: {
    opacity: 0.82,
  },
  pillSelected: {
    backgroundColor: mobileTheme.colors.accent,
    borderColor: mobileTheme.colors.accentDark,
    ...mobileTheme.shadow.control,
  },
  pillText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
    textTransform: 'none',
  },
  pillTextSelected: {
    color: mobileTheme.colors.textOnAccent,
    fontWeight: mobileTheme.font.extrabold,
  },
  row: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    paddingRight: 16,
    paddingVertical: 2,
  },
});
