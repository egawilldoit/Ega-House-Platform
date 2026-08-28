import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { FadeSlide } from '@/components/mobile/motion/FadeSlide';
import { useReducedMotion } from '@/components/mobile/motion/ReducedMotion';
import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';
import type { MobileTaskDueFilter, MobileTaskPriority, MobileTaskStatus } from '@/types/tasks';

const STATUS_OPTIONS: Array<{ label: string; value: MobileTaskStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Todo', value: 'todo' },
  { label: 'Doing', value: 'in_progress' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Done', value: 'done' },
];

const PRIORITY_OPTIONS: Array<{ label: string; value: MobileTaskPriority | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
];

const DUE_OPTIONS: Array<{ label: string; value: MobileTaskDueFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Today', value: 'due_today' },
  { label: 'Soon', value: 'due_soon' },
  { label: 'None', value: 'no_due_date' },
];

export type TaskFiltersProps = {
  statusFilter: MobileTaskStatus | 'all';
  priorityFilter: MobileTaskPriority | 'all';
  dueFilter: MobileTaskDueFilter;
  activeCount: number;
  hasFilters: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onChangeStatus: (v: MobileTaskStatus | 'all') => void;
  onChangePriority: (v: MobileTaskPriority | 'all') => void;
  onChangeDue: (v: MobileTaskDueFilter) => void;
  onClear: () => void;
  testID?: string;
};

export function TaskFilters({
  statusFilter,
  priorityFilter,
  dueFilter,
  activeCount,
  collapsed,
  onToggleCollapsed,
  onChangeStatus,
  onChangePriority,
  onChangeDue,
  testID,
}: TaskFiltersProps) {
  const reducedMotion = useReducedMotion();
  return (
    <View style={styles.container} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={collapsed ? 'Expand filters' : 'Collapse filters'}
        onPress={onToggleCollapsed}
        style={({ pressed }) => [styles.header, pressed ? styles.headerPressed : null]}
      >
        <View style={styles.headerLeft}>
          <Ionicons color={mobileTheme.colors.textMuted} name="filter-outline" size={16} />
          <Text style={styles.headerTitle}>Filters</Text>
          {activeCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>•{activeCount}</Text>
            </View>
          ) : null}
        </View>
        <Ionicons
          color={mobileTheme.colors.textSubtle}
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={16}
        />
      </Pressable>

      {!collapsed ? (
        <FadeSlide
          visible={!collapsed}
          durationMs={reducedMotion ? 0 : 200}
          offsetY={reducedMotion ? 0 : 8}
          style={styles.fadeWrap}
        >
          <View style={styles.body}>
            <Text style={styles.label}>Status</Text>
            <SegmentedControl value={statusFilter} options={STATUS_OPTIONS} onChange={onChangeStatus} testID="task-status-filter" />

            <Text style={styles.label}>Priority</Text>
            <SegmentedControl
              value={priorityFilter}
              options={PRIORITY_OPTIONS}
              onChange={onChangePriority}
              testID="task-priority-filter"
            />

            <Text style={styles.label}>Due date</Text>
            <SegmentedControl value={dueFilter} options={DUE_OPTIONS} onChange={onChangeDue} testID="task-due-filter" />
          </View>
        </FadeSlide>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: mobileTheme.colors.accentSoft,
    borderRadius: mobileTheme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    color: mobileTheme.colors.accentDark,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  body: {
    gap: 0,
    marginTop: mobileTheme.spacing.sm,
  },
  container: {
    marginTop: mobileTheme.spacing.sm,
  },
  fadeWrap: {
    // fade+translateY 180-220ms via FadeSlide, reducedMotion instant
  },
  header: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: mobileTheme.spacing.md,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    flex: 1,
  },
  headerPressed: {
    opacity: 0.78,
  },
  headerTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
  },
  label: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.4,
    marginTop: mobileTheme.spacing.sm,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
});
