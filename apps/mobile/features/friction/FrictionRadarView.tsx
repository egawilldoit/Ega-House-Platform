import { StyleSheet, Text, View } from "react-native";
import type {
  FrictionBlockedSignal,
  FrictionStaleGoalSignal,
  FrictionStaleTaskSignal,
} from "@ega/contracts/friction";
import { mobileTheme } from "@/components/mobile/theme";
import { Card } from "@/components/mobile/ui/Card";

type Props = {
  blocked: FrictionBlockedSignal[];
  staleTasks: FrictionStaleTaskSignal[];
  staleGoals: FrictionStaleGoalSignal[];
  thresholdDays: number;
};

function SignalRow({
  title,
  subtitle,
  ageDays,
}: {
  title: string;
  subtitle: string;
  ageDays: number;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.ageBadge}>
        <Text style={styles.ageText}>{ageDays}d ago</Text>
      </View>
    </View>
  );
}

export function FrictionRadarView({ blocked, staleTasks, staleGoals, thresholdDays }: Props) {
  const hasAny = blocked.length > 0 || staleTasks.length > 0 || staleGoals.length > 0;

  if (!hasAny) {
    return (
      <Card style={styles.card}>
        <Text style={styles.emptyTitle}>No friction detected</Text>
        <Text style={styles.emptySubtitle}>
          No blocked or stale work found. Your active tasks and goals are fresh.
        </Text>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Blocked ({blocked.length})</Text>
        <Text style={styles.sectionSubtitle}>
          Active tasks with status Blocked — includes blocker reason when present and age.
        </Text>
        {blocked.length === 0 ? (
          <Text style={styles.emptyInline}>No blocked tasks.</Text>
        ) : (
          blocked.map((task) => (
            <SignalRow
              key={task.id}
              title={task.title}
              subtitle={task.blockedReason ? `Reason: ${task.blockedReason}` : "No blocker reason provided"}
              ageDays={task.ageDays}
            />
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Stale Tasks ({staleTasks.length})</Text>
        <Text style={styles.sectionSubtitle}>Active tasks with no update for ≥ {thresholdDays} days.</Text>
        {staleTasks.length === 0 ? (
          <Text style={styles.emptyInline}>No stale tasks.</Text>
        ) : (
          staleTasks.map((task) => (
            <SignalRow
              key={task.id}
              title={task.title}
              subtitle={`Status ${task.status} · Updated ${new Date(task.updatedAt).toLocaleDateString()}`}
              ageDays={task.ageDays}
            />
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Stale Goals ({staleGoals.length})</Text>
        <Text style={styles.sectionSubtitle}>Active goals with no update for ≥ {thresholdDays} days.</Text>
        {staleGoals.length === 0 ? (
          <Text style={styles.emptyInline}>No stale goals.</Text>
        ) : (
          staleGoals.map((goal) => (
            <SignalRow
              key={goal.id}
              title={goal.title}
              subtitle={`Status ${goal.status} · Updated ${new Date(goal.updatedAt).toLocaleDateString()}`}
              ageDays={goal.ageDays}
            />
          ))
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: mobileTheme.spacing.md },
  card: { padding: mobileTheme.spacing.lg },
  sectionTitle: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
  },
  sectionSubtitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 4,
    marginBottom: mobileTheme.spacing.md,
  },
  row: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 12,
    marginTop: mobileTheme.spacing.sm,
  },
  rowCopy: { flex: 1, marginRight: 12 },
  rowTitle: { color: mobileTheme.colors.text, fontSize: 14, fontWeight: mobileTheme.font.semibold },
  rowSubtitle: { color: mobileTheme.colors.textSubtle, fontSize: 12, marginTop: 2 },
  ageBadge: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ageText: { color: mobileTheme.colors.textMuted, fontSize: 12, fontWeight: mobileTheme.font.semibold },
  emptyTitle: { color: mobileTheme.colors.text, fontSize: 16, fontWeight: mobileTheme.font.extrabold, textAlign: "center" },
  emptySubtitle: { color: mobileTheme.colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 6 },
  emptyInline: { color: mobileTheme.colors.textMuted, fontSize: 13, marginTop: 4 },
});
