import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MobileTaskListItem } from '@/types/tasks';
import { mobileTheme } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { EmptyState } from '@/components/mobile/ui/EmptyState';

export type FocusQueueProps = {
  tasks: MobileTaskListItem[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  onStart: () => void;
  isStarting: boolean;
  testID?: string;
};

export function FocusQueue({
  tasks,
  selectedTaskId,
  onSelect,
  onStart,
  isStarting,
  testID,
}: FocusQueueProps) {
  if (tasks.length === 0) {
    return (
      <Card testID={testID ?? 'focus-queue-empty'}>
        <EmptyState
          icon="list-outline"
          title="No open tasks"
          description="Add a task first, then start timing it here."
        />
      </Card>
    );
  }

  return (
    <Card testID={testID ?? 'focus-queue'}>
      <View style={styles.header}>
        <Text style={styles.pickTitle}>Pick a task to time</Text>
      </View>

      <View style={styles.list}>
        {tasks.map((task) => {
          const isSelected = task.id === selectedTaskId;

          return (
            <Pressable
              key={task.id}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(task.id)}
              style={[styles.taskRow, isSelected ? styles.taskRowSelected : null]}
              testID={`focus-task-${task.id}`}
            >
              <View style={styles.taskRowCopy}>
                <Text style={styles.taskRowTitle} numberOfLines={1}>
                  {task.title}
                </Text>
                <Text style={styles.taskRowMeta} numberOfLines={1}>
                  {task.project.name} · {task.status.replaceAll('_', ' ')}
                </Text>
              </View>
              {isSelected ? (
                <Ionicons color={mobileTheme.colors.accent} name="checkmark-circle" size={20} />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <Button
        title="Start timer"
        leftIcon={<Ionicons color={mobileTheme.colors.textOnAccent} name="play" size={20} />}
        onPress={onStart}
        disabled={!selectedTaskId || isStarting}
        loading={isStarting}
        style={styles.startButton}
        testID="focus-start-button"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: mobileTheme.spacing.sm,
  },
  list: {
    gap: mobileTheme.spacing.sm,
  },
  pickTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
  },
  startButton: {
    marginTop: mobileTheme.spacing.md,
    minHeight: 52,
    width: '100%',
  },
  taskRow: {
    alignItems: 'center',
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  taskRowCopy: {
    flex: 1,
    marginRight: 8,
  },
  taskRowMeta: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 2,
  },
  taskRowSelected: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderColor: mobileTheme.colors.accentMid,
  },
  taskRowTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
  },
});
