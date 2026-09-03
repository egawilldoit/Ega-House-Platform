import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  FrictionBlockedSignal,
  FrictionContextSwitchSignal,
  FrictionEstimateSignal,
  FrictionNeglectedGoalSignal,
  FrictionStaleGoalSignal,
  FrictionStaleTaskSignal,
  FrictionWorkloadImbalanceSignal,
} from "@ega/contracts/friction";
import { mobileTheme } from "@/components/mobile/theme";
import { Card } from "@/components/mobile/ui/Card";

type Props = {
  blocked: FrictionBlockedSignal[];
  staleTasks: FrictionStaleTaskSignal[];
  staleGoals: FrictionStaleGoalSignal[];
  thresholdDays: number;
  estimateSignals: FrictionEstimateSignal[];
  contextSwitch: FrictionContextSwitchSignal;
  neglectedGoals: FrictionNeglectedGoalSignal[];
  workloadImbalance: FrictionWorkloadImbalanceSignal;
  evidenceWindow: { startIso: string; endIso: string } | null;
  onTaskPress?: (taskId: string) => void;
  onGoalPress?: (goalId: string) => void;
};

function SignalRow({
  title,
  subtitle,
  badgeText,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle: string;
  badgeText: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const content = (
    <>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.ageBadge}>
        <Text style={styles.ageText}>{badgeText}</Text>
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityHint="Opens details"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      {content}
    </Pressable>
  );
}

export function FrictionRadarView({ blocked, staleTasks, staleGoals, thresholdDays, estimateSignals, contextSwitch, neglectedGoals, workloadImbalance, onTaskPress, onGoalPress }: Props) {
  const hasAny =
    blocked.length > 0 ||
    staleTasks.length > 0 ||
    staleGoals.length > 0 ||
    estimateSignals.length > 0 ||
    contextSwitch.isFriction ||
    neglectedGoals.length > 0 ||
    workloadImbalance.isImbalance;

  if (!hasAny) {
    return (
      <Card style={styles.card}>
        <Text style={styles.emptyTitle}>No friction detected</Text>
        <Text style={styles.emptySubtitle}>
          No blocked, stale, estimate, context-switch, neglected-goal, or imbalance friction found.
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
              badgeText={`${task.ageDays}d ago`}
              onPress={onTaskPress ? () => onTaskPress(task.id) : undefined}
              accessibilityLabel={onTaskPress ? `Open blocked task: ${task.title}` : undefined}
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
              badgeText={`${task.ageDays}d ago`}
              onPress={onTaskPress ? () => onTaskPress(task.id) : undefined}
              accessibilityLabel={onTaskPress ? `Open stale task: ${task.title}` : undefined}
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
              badgeText={`${goal.ageDays}d ago`}
              onPress={onGoalPress ? () => onGoalPress(goal.id) : undefined}
              accessibilityLabel={onGoalPress ? `Open stale goal: ${goal.title}` : undefined}
            />
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Estimate Accuracy ({estimateSignals.length})</Text>
        <Text style={styles.sectionSubtitle}>Tasks with estimate ≥5m where actual deviates &gt;50% (medium) or &gt;100% (high). Window-clipped, no double-count.</Text>
        {estimateSignals.length === 0 ? (
          <Text style={styles.emptyInline}>No estimate friction in window.</Text>
        ) : (
          estimateSignals.map((sig) => (
            <SignalRow
              key={sig.id}
              title={sig.title}
              subtitle={`Est ${sig.estimateMinutes}m · Actual ${sig.actualMinutes}m · Δ ${sig.deltaMinutes}m`}
              badgeText={`${sig.percentError}% ${sig.severity}`}
              onPress={onTaskPress ? () => onTaskPress(sig.id) : undefined}
              accessibilityLabel={onTaskPress ? `Open estimate task: ${sig.title}` : undefined}
            />
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Context Switches ({contextSwitch.switchCount})</Text>
        <Text style={styles.sectionSubtitle}>
          Transitions between different Tasks in ordered sessions (repeat not a switch). Threshold {contextSwitch.threshold}
          (med), {contextSwitch.highThreshold} (high).
        </Text>
        <Text style={styles.emptyInline}>
          {contextSwitch.transitionsCount} sessions · {contextSwitch.distinctTaskCount} tasks · {contextSwitch.switchCount} switches · {contextSwitch.severity}
          {contextSwitch.isFriction ? " · Friction" : " · No friction"}
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Neglected Goals ({neglectedGoals.length})</Text>
        <Text style={styles.sectionSubtitle}>Active goals with no tracked execution in window (rolling window from time-context).</Text>
        {neglectedGoals.length === 0 ? (
          <Text style={styles.emptyInline}>No neglected goals in window.</Text>
        ) : (
          neglectedGoals.map((goal) => (
            <SignalRow
              key={goal.id}
              title={goal.title}
              subtitle={`Status ${goal.status} · Window ${new Date(goal.window.startIso).toLocaleDateString()} → ${new Date(goal.window.endIso).toLocaleDateString()}`}
              badgeText={goal.daysSinceActivity === null ? "no activity" : `${goal.daysSinceActivity}d`}
              onPress={onGoalPress ? () => onGoalPress(goal.id) : undefined}
              accessibilityLabel={onGoalPress ? `Open neglected goal: ${goal.title}` : undefined}
            />
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Workload Imbalance ({workloadImbalance.severity})</Text>
        <Text style={styles.sectionSubtitle}>Project share from canonical tracked-time. Threshold {workloadImbalance.threshold}% (med), {workloadImbalance.highThreshold}% (high). Min {workloadImbalance.minTotalMinutes}m total, {workloadImbalance.minForHighMinutes}m for high. Sparse cannot trigger high.</Text>
        <Text style={styles.emptyInline}>
          {workloadImbalance.projectCount === 0
            ? "No tracked work in window."
            : `${workloadImbalance.totalTrackedMinutes}m total · ${workloadImbalance.projectCount} projects · Dominant ${workloadImbalance.dominantProjectName ?? workloadImbalance.dominantProjectId ?? "-"} ${workloadImbalance.dominantSharePercent}% (${Math.floor(workloadImbalance.dominantTrackedSeconds / 60)}m) · ${workloadImbalance.severity}${workloadImbalance.isImbalance ? " · Imbalance" : " · Balanced"}`}
        </Text>
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
  rowPressed: { opacity: 0.72 },
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
