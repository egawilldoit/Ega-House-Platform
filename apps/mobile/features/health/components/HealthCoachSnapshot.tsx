import { StyleSheet, Text, View } from "react-native";

import { mobileTheme } from "@/components/mobile/theme";
import { Card } from "@/components/mobile/ui/Card";
import type { HealthSnapshotResponse } from "@ega/api-client";

type Props = {
  response: HealthSnapshotResponse | null;
  errorMessage?: string | null;
};

function qualityLabel(quality: string): string {
  switch (quality) {
    case "sufficient":
      return "Evidence: sufficient";
    case "insufficient":
      return "Evidence: not enough recent sessions";
    case "provisional":
      return "Evidence: provisional — active session";
    case "suspect":
      return "Evidence: check data";
    default:
      return `Evidence: ${quality}`;
  }
}

export function HealthCoachSnapshot({ response, errorMessage }: Props) {
  if (errorMessage) {
    return (
      <Card style={styles.card} testID="health-coach-error">
        <Text style={styles.title}>Workload & Recovery — Snapshot</Text>
        <Text style={styles.subtitle}>Lightweight workload guidance from your tracked sessions.</Text>
        <Text style={styles.error}>Could not load workload snapshot right now.</Text>
      </Card>
    );
  }

  if (!response || !response.snapshot) {
    return (
      <Card style={styles.card} testID="health-coach-empty">
        <Text style={styles.title}>Workload & Recovery — Snapshot</Text>
        <Text style={styles.subtitle}>Lightweight workload guidance from your tracked sessions.</Text>
        <Text style={styles.body}>No workload snapshot available.</Text>
      </Card>
    );
  }

  const snap = response.snapshot;
  const isInsufficient = snap.quality.quality === "insufficient";

  return (
    <Card style={styles.card} testID="health-coach-snapshot">
      <Text style={styles.title}>Workload & Recovery — Snapshot</Text>
      <Text style={styles.subtitle}>
        Based on tracked sessions in the last {snap.windowDays} days. Workload guidance only — not medical advice.
      </Text>

      <View style={styles.badgeRow}>
        <View style={[styles.badge, snap.quality.quality === "sufficient" ? styles.badgeSuccess : snap.quality.quality === "provisional" ? styles.badgeInfo : snap.quality.quality === "suspect" ? styles.badgeWarn : styles.badgeMuted]}>
          <Text style={styles.badgeText}>{qualityLabel(snap.quality.quality)}</Text>
        </View>
        <View style={[styles.badge, styles.badgeMuted]}>
          <Text style={styles.badgeText}>{snap.timezone} · {snap.localDate}</Text>
        </View>
      </View>

      {isInsufficient ? (
        <Text style={styles.body}>
          Not enough recent work to summarize workload yet. Track a few sessions and check back for pace and recovery guidance.
        </Text>
      ) : null}

      {snap.quality.quality === "provisional" ? (
        <Text style={[styles.body, styles.warn]}>
          Includes time from an active session that has not been stopped yet. Totals will settle once the session is completed.
        </Text>
      ) : null}

      {snap.quality.quality === "suspect" ? (
        <Text style={[styles.body, styles.warn]}>
          Some sessions had incomplete timing data and were excluded.
        </Text>
      ) : null}

      <View style={styles.grid}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Rolling workload</Text>
          <Text style={styles.metricValue}>{snap.rollingWorkload.totalTrackedLabel}</Text>
          <Text style={styles.metricHint}>{snap.rollingWorkload.totalTrackedMinutes} min · {snap.windowDays}d</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Active days</Text>
          <Text style={styles.metricValue}>{snap.activeDays} / {snap.windowDays}</Text>
          <Text style={styles.metricHint}>{snap.sessionDensity} / day</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Sessions</Text>
          <Text style={styles.metricValue}>{snap.sessionCount}</Text>
          <Text style={styles.metricHint}>density {snap.sessionDensity}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Longest</Text>
          <Text style={styles.metricValue}>{snap.longestSessionLabel ?? "—"}</Text>
          <Text style={styles.metricHint}>in window</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Average</Text>
          <Text style={styles.metricValue}>{snap.averageSessionLabel ?? "—"}</Text>
          <Text style={styles.metricHint}>per session</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Recovery note</Text>
          <Text style={styles.metricHint}>Use session patterns to plan breaks — not a health diagnosis.</Text>
        </View>
      </View>

      <Text style={styles.footnote}>
        Window {snap.window.startIso.slice(0, 10)} → {snap.window.endIso.slice(0, 10)} · {snap.quality.reasons.join(", ") || "ok"}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: mobileTheme.spacing.md,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
  },
  subtitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  body: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: mobileTheme.spacing.sm,
    lineHeight: 18,
  },
  warn: {
    color: mobileTheme.colors.warning,
  },
  error: {
    color: mobileTheme.colors.danger,
    fontSize: 13,
    marginTop: mobileTheme.spacing.sm,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: mobileTheme.spacing.sm,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeMuted: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
  },
  badgeInfo: {
    backgroundColor: mobileTheme.colors.accentSoft,
  },
  badgeSuccess: {
    backgroundColor: mobileTheme.colors.successContainer,
  },
  badgeWarn: {
    backgroundColor: mobileTheme.colors.warningContainer,
  },
  badgeText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: mobileTheme.spacing.md,
  },
  metric: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.md,
    padding: 10,
    width: "48%",
  },
  metricLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
  },
  metricValue: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.bold,
    marginTop: 2,
  },
  metricHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 2,
  },
  footnote: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    marginTop: mobileTheme.spacing.sm,
  },
});
