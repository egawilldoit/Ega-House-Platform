import { StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { Card } from '@/components/mobile/ui/Card';
import { Chip } from '@/components/mobile/ui/Chip';
import type { MobileTaskListItem } from '@/types/tasks';

import { formatTimestamp } from './formatters';

type Props = {
  task: MobileTaskListItem;
};

export function TaskIdentityCard({ task }: Props) {
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{task.title}</Text>
      <View style={styles.metaRow}>
        <Chip kind="status" value={task.status} style={styles.chip} />
        <Chip kind="priority" value={task.priority} style={styles.chip} />
      </View>
      <Text style={styles.meta}>
        {task.project.name}
        {task.goal ? ` · ${task.goal.title}` : ''}
      </Text>
      <Text style={styles.metaSubtle}>Updated {formatTimestamp(task.updatedAt)}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: mobileTheme.spacing.md,
  },
  chip: {
    marginTop: 4,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  metaSubtle: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 4,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 22,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.4,
    lineHeight: 28,
  },
});
