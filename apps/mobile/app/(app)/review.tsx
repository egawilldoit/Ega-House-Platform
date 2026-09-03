import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";

import { useWeeklyReviewQuery } from "@/features/weekly-review/query";
import { mobileTheme } from "@/components/mobile/theme";

function formatIsoDate(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function shiftIsoDateByDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function WeeklyReviewScreen() {
  const [selectedWeekOf, setSelectedWeekOf] = useState<string | undefined>(undefined);
  const { data, isLoading, isError, error, refetch, isFetching } = useWeeklyReviewQuery(selectedWeekOf);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.mutedText}>Loading weekly review…</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error instanceof Error ? error.message : "Failed to load review."}</Text>
        <Pressable
          testID="review-retry"
          accessibilityRole="button"
          accessibilityLabel="Retry loading weekly review"
          accessibilityHint="Attempts to load the review again"
          accessibilityState={{ busy: isFetching, disabled: isFetching }}
          disabled={isFetching}
          style={({ pressed }) => [styles.button, isFetching ? styles.disabled : null, pressed ? styles.pressed : null]}
          onPress={() => void refetch()}
        >
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const review = data?.review;
  if (!review) {
    return (
      <View style={styles.center}>
        <Text style={styles.mutedText}>No review data.</Text>
      </View>
    );
  }

  const stats = review.stats;
  const window = review.window;
  const saved = review.savedReview;
  const draft = review.generatedDraft;
  const mostTracked = review.mostTracked;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Weekly Review" }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.weekSelector}>
          <Pressable
            testID="review-previous-week"
            accessibilityRole="button"
            accessibilityLabel="View previous week"
            accessibilityHint="Loads the previous weekly review"
            style={({ pressed }) => [styles.selectorBtn, pressed ? styles.pressed : null]}
            onPress={() =>
              setSelectedWeekOf(
                selectedWeekOf ? shiftIsoDateByDays(selectedWeekOf, -7) : shiftIsoDateByDays(window.weekStart, -7),
              )
            }
          >
            <Text style={styles.selectorBtnText}>‹ Previous</Text>
          </Pressable>
          <View style={styles.weekInfo}>
            <Text style={styles.weekLabel}>
              {formatIsoDate(window.weekStart)} – {formatIsoDate(window.weekEnd)}
            </Text>
            <Text style={styles.mutedText}>{window.timezone}{window.fallback !== "none" ? ` (${window.fallback})` : ""}</Text>
            {isFetching ? <Text style={styles.refreshing}>Refreshing…</Text> : null}
          </View>
          <Pressable
            testID="review-next-week"
            accessibilityRole="button"
            accessibilityLabel="View next week"
            accessibilityHint="Loads the next weekly review"
            style={({ pressed }) => [styles.selectorBtn, pressed ? styles.pressed : null]}
            onPress={() =>
              setSelectedWeekOf(
                selectedWeekOf ? shiftIsoDateByDays(selectedWeekOf, 7) : shiftIsoDateByDays(window.weekStart, 7),
              )
            }
          >
            <Text style={styles.selectorBtnText}>Next ›</Text>
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Tasks Created</Text>
            <Text style={styles.statValue}>{String(stats.tasksCreated)}</Text>
            <Text style={styles.mutedText}>{stats.sessionsLogged} sessions</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Tracked</Text>
            <Text style={styles.statValue}>{Math.round(stats.trackedSeconds / 3600)}h</Text>
            <Text style={styles.mutedText}>{stats.goalsTouched} goals touched</Text>
          </View>
        </View>

        {stats.blockedTasks.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Active Blockers ({stats.blockedTasks.length})</Text>
            {stats.blockedTasks.map((t) => (
              <View key={t.id} style={styles.blockerRow}>
                <Text style={styles.blockerTitle}>{t.title}</Text>
                <Text style={styles.mutedText}>{t.blockedReason ?? "Blocked with no reason"}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Active Blockers</Text>
            <Text style={styles.mutedText}>No blocked tasks are currently active.</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Saved Reflection</Text>
          <Text style={styles.bodyText} testID="saved-review-summary">
            {saved?.summary ?? "No saved reflection for this week yet."}
          </Text>
          {saved?.wins ? <Text style={styles.bodyText}>Wins: {saved.wins}</Text> : null}
          {saved?.blockers ? <Text style={styles.bodyText}>Blockers: {saved.blockers}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Generated Draft</Text>
          <Text style={styles.bodyText}>{draft.summary.slice(0, 600)}</Text>
          <Text style={styles.bodyText}>{draft.wins.slice(0, 300)}</Text>
          <Text style={styles.bodyText}>{draft.blockers.slice(0, 300)}</Text>
          <Text style={styles.bodyText}>{draft.nextSteps.slice(0, 300)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Most Tracked — Tasks</Text>
          {mostTracked.tasks.length > 0 ? (
            mostTracked.tasks.map((row) => (
              <View key={row.id} style={styles.trackedRow}>
                <Text style={styles.trackedLabel}>{row.label}</Text>
                <Text style={styles.mutedText}>{row.trackedLabel} • {row.sessionCount} sessions • {row.detail}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.mutedText}>No tracked tasks in this weekly window yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Most Tracked — Projects</Text>
          {mostTracked.projects.length > 0 ? (
            mostTracked.projects.map((row) => (
              <View key={row.id} style={styles.trackedRow}>
                <Text style={styles.trackedLabel}>{row.label}</Text>
                <Text style={styles.mutedText}>{row.trackedLabel} • {row.sessionCount} sessions</Text>
              </View>
            ))
          ) : (
            <Text style={styles.mutedText}>No tracked projects in this weekly window yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Most Tracked — Goals</Text>
          {mostTracked.goals.length > 0 ? (
            mostTracked.goals.map((row) => (
              <View key={row.id} style={styles.trackedRow}>
                <Text style={styles.trackedLabel}>{row.label}</Text>
                <Text style={styles.mutedText}>{row.trackedLabel} • {row.sessionCount} sessions</Text>
              </View>
            ))
          ) : (
            <Text style={styles.mutedText}>No tracked goals in this weekly window yet.</Text>
          )}
        </View>

        <Pressable
          testID="review-current-week"
          accessibilityRole="button"
          accessibilityLabel="Return to this week"
          accessibilityHint="Shows the current weekly review"
          style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
          onPress={() => setSelectedWeekOf(undefined)}
        >
          <Text style={styles.buttonText}>Back to this week</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: mobileTheme.colors.background, flex: 1 },
  content: { gap: mobileTheme.spacing.md, padding: mobileTheme.spacing.md, paddingBottom: mobileTheme.spacing.xl },
  center: {
    alignItems: "center",
    flex: 1,
    gap: mobileTheme.spacing.md,
    justifyContent: "center",
    padding: mobileTheme.spacing.xl,
  },
  weekSelector: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: mobileTheme.spacing.md,
  },
  selectorBtn: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileTheme.layout.minTouchTarget,
    minWidth: 92,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: mobileTheme.spacing.sm,
  },
  selectorBtnText: { color: mobileTheme.colors.accent, fontWeight: "600" },
  weekInfo: { alignItems: "center", flex: 1, gap: 2 },
  weekLabel: { color: mobileTheme.colors.text, fontWeight: "700" },
  mutedText: { color: mobileTheme.colors.textSubtle, fontSize: 12, lineHeight: 16 },
  refreshing: { color: mobileTheme.colors.accent, fontSize: 11 },
  statsRow: { flexDirection: "row", gap: mobileTheme.spacing.md },
  statCard: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    flex: 1,
    padding: mobileTheme.spacing.md,
  },
  statLabel: { color: mobileTheme.colors.textSubtle, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  statValue: { color: mobileTheme.colors.text, fontSize: 28, fontWeight: "700" },
  card: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    gap: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.md,
  },
  cardTitle: { color: mobileTheme.colors.text, fontSize: 15, fontWeight: "600" },
  bodyText: { color: mobileTheme.colors.text, fontSize: 13, lineHeight: 18 },
  blockerRow: { gap: 2, paddingVertical: mobileTheme.spacing.xs },
  blockerTitle: { color: mobileTheme.colors.text, fontWeight: "600" },
  trackedRow: { gap: 2, paddingVertical: mobileTheme.spacing.xs },
  trackedLabel: { color: mobileTheme.colors.text, fontWeight: "600" },
  errorText: { color: mobileTheme.colors.danger, textAlign: "center" },
  button: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.control,
    justifyContent: "center",
    minHeight: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: mobileTheme.spacing.sm,
  },
  buttonText: { color: mobileTheme.colors.textOnAccent, fontWeight: "600" },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.82 },
});
