import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";

import { mobileTheme } from "@/components/mobile/theme";
import { AppScreen } from "@/components/mobile/ui/AppScreen";
import { ScreenHeader } from "@/components/mobile/ui/ScreenHeader";
import { Button } from "@/components/mobile/ui/Button";
import { FeedbackBanner } from "@/components/mobile/ui/FeedbackBanner";
import { FrictionRadarView } from "@/features/friction/FrictionRadarView";
import { useFrictionRadarQuery } from "@/features/friction/query";
import { useBottomChromeMetrics } from "@/components/mobile/navigation/bottomChrome";

export default function FrictionRadarScreen() {
  const { contentBottomPaddingNoFab } = useBottomChromeMetrics();
  const { data, error, isError, isPending, isRefetching, refetch, isFetched } = useFrictionRadarQuery();

  useFocusEffect(
    useCallback(() => {
      if (!isFetched) return;
      refetch().catch(() => {});
    }, [isFetched, refetch]),
  );

  const isLoading = isPending && !data;

  if (isLoading) {
    return (
      <AppScreen testID="friction-loading">
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.subtitle}>Loading friction signals...</Text>
        </View>
      </AppScreen>
    );
  }

  if (isError && !data) {
    const msg = error instanceof Error ? error.message : "Unable to load friction signals.";
    return (
      <AppScreen testID="friction-error">
        <View style={styles.centered}>
          <Text style={styles.title}>Friction Radar</Text>
          <Text style={styles.errorTextCentered}>{msg}</Text>
          <Button title="Retry" variant="secondary" onPress={() => refetch()} style={styles.retryButton} />
        </View>
      </AppScreen>
    );
  }

  if (!data) return null;

  const isRefreshing = isRefetching && !isLoading;

  return (
    <AppScreen padded={false} testID="friction-screen">
      <ScrollView
        contentContainerStyle={[styles.listContent, { paddingBottom: contentBottomPaddingNoFab }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refetch} />}
      >
        <View style={styles.pagePadding}>
          <ScreenHeader
            eyebrow="Friction Radar"
            title="Workflow Friction"
            style={styles.screenHeader}
          />
          <Text style={styles.description}>
            Deterministic stale ({data.thresholdDays}d), estimate, and context-switch signals. Generated{" "}
            {new Date(data.generatedAt).toLocaleString()}
            {data.evidenceWindow ? ` · Window ${new Date(data.evidenceWindow.startIso).toLocaleDateString()} → ${new Date(data.evidenceWindow.endIso).toLocaleDateString()}` : ""}.
          </Text>
          {isError && data ? (
            <FeedbackBanner message={error instanceof Error ? error.message : "Refresh failed"} tone="danger" style={styles.feedback} />
          ) : null}
          <FrictionRadarView
            blocked={data.blocked}
            staleTasks={data.staleTasks}
            staleGoals={data.staleGoals}
            thresholdDays={data.thresholdDays}
            estimateSignals={data.estimateSignals}
            contextSwitch={data.contextSwitch}
            evidenceWindow={data.evidenceWindow}
          />
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  errorTextCentered: { color: mobileTheme.colors.danger, marginTop: mobileTheme.spacing.sm, textAlign: "center" },
  feedback: { marginTop: mobileTheme.spacing.md },
  listContent: { paddingBottom: mobileTheme.layout.floatingTabClearance, paddingTop: 4 },
  screenHeader: { marginBottom: 6, marginTop: 0 },
  loadingWrap: { alignItems: "center", paddingTop: mobileTheme.spacing.xxl },
  pagePadding: { paddingHorizontal: mobileTheme.spacing.lg },
  retryButton: { marginTop: mobileTheme.spacing.lg },
  subtitle: { color: mobileTheme.colors.textMuted, fontSize: 15, marginTop: mobileTheme.spacing.sm, textAlign: "center" },
  title: { color: mobileTheme.colors.text, fontSize: 24, fontWeight: mobileTheme.font.black },
  description: { color: mobileTheme.colors.textMuted, fontSize: 13, marginTop: 4, marginBottom: mobileTheme.spacing.md },
});
