import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';
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
  hasFilters,
  collapsed,
  onToggleCollapsed,
  onChangeStatus,
  onChangePriority,
  onChangeDue,
  onClear,
  testID,
}: TaskFiltersProps) {
  return (
    <Card style={styles.card} contentStyle={styles.content} testID={testID}>
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
            <View style={[styles.countPill, styles.countPillActive]}>
              <Text style={[styles.countText, styles.countTextActive]}>{activeCount} active</Text>
            </View>
          ) : (
            <View style={styles.countPill}>
              <Text style={styles.countText}>All</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          {hasFilters ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear task filters"
              hitSlop={8}
              onPress={onClear}
              style={({ pressed }) => [styles.clearPill, pressed ? styles.clearPressed : null]}
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          ) : null}
          <Ionicons
            color={mobileTheme.colors.textSubtle}
            name={collapsed ? 'chevron-down' : 'chevron-up'}
            size={16}
            style={styles.chevron}
          />
        </View>
      </Pressable>

      {collapsed ? null : (
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
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: {
    marginTop: mobileTheme.spacing.sm,
    gap: 0,
  },
  card: {
    marginTop: mobileTheme.spacing.sm,
  },
  chevron: {
    marginLeft: 6,
  },
  clearPill: {
    backgroundColor: mobileTheme.colors.accentSoft,
    borderColor: mobileTheme.colors.accentMid,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  clearPressed: {
    opacity: 0.78,
  },
  clearText: {
    color: mobileTheme.colors.accentDark,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  content: {
    padding: 12,
  },
  countPill: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countPillActive: {
    backgroundColor: mobileTheme.colors.accentSoft,
  },
  countText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
  },
  countTextActive: {
    color: mobileTheme.colors.accentDark,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
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
