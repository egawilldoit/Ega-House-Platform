import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { mobileTheme } from "@/components/mobile/theme";
import { AppScreen } from "@/components/mobile/ui/AppScreen";
import { Button } from "@/components/mobile/ui/Button";
import { Card } from "@/components/mobile/ui/Card";
import { FeedbackBanner } from "@/components/mobile/ui/FeedbackBanner";
import { FloatingActionButton } from "@/components/mobile/ui/FloatingActionButton";
import { ScreenHeader } from "@/components/mobile/ui/ScreenHeader";
import { useBottomChromeMetrics } from "@/components/mobile/navigation/bottomChrome";
import { InboxCaptureSheet } from "@/features/inbox/components/InboxCaptureSheet";
import { useInboxListQuery, useArchiveInboxMutation, useCreateInboxMutation, useRestoreInboxMutation } from "@/features/inbox/query";

export default function InboxScreen() {
  const inboxQuery = useInboxListQuery();
  const createMutation = useCreateInboxMutation();
  const archiveMutation = useArchiveInboxMutation();
  const restoreMutation = useRestoreInboxMutation();
  const [error, setError] = useState<string | null>(null);
  const [captureVisible, setCaptureVisible] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const { contentBottomPadding } = useBottomChromeMetrics();

  const items = (inboxQuery.data as any)?.items ?? [];
  const isLoading = inboxQuery.isPending && !inboxQuery.data;
  const isError = inboxQuery.isError && !inboxQuery.data;

  async function handleCaptureSubmit(input: { title: string; body: string | null; idempotencyKey: string }) {
    // Preserve draft until success; do not clear on failure (retry-safe)
    setDraftTitle(input.title);
    setDraftBody(input.body ?? "");
    setError(null);
    try {
      await createMutation.mutateAsync({
        title: input.title,
        body: input.body,
        idempotencyKey: input.idempotencyKey,
      });
      // Success: clear draft, close sheet, invalidate handled by mutation
      setDraftTitle("");
      setDraftBody("");
      setCaptureVisible(false);
    } catch (e) {
      // Preserve draft for retry; surface error without false success
      const message = e instanceof Error ? e.message : "Unable to create idea.";
      setError(message);
      // Keep sheet open and retain draft + key for retry
      throw e;
    }
  }

  async function handleArchive(id: string) {
    setError(null);
    try {
      await archiveMutation.mutateAsync(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to archive idea.");
    }
  }

  async function handleRestore(id: string) {
    setError(null);
    try {
      await restoreMutation.mutateAsync(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to restore idea.");
    }
  }

  if (isLoading) {
    return (
      <AppScreen testID="inbox-loading">
        <ScreenHeader eyebrow="Capture" title="Inbox" description="Loading ideas..." />
        <ActivityIndicator color={mobileTheme.colors.accent} />
      </AppScreen>
    );
  }

  if (isError) {
    const msg = inboxQuery.error instanceof Error ? inboxQuery.error.message : "Unable to load inbox.";
    return (
      <AppScreen testID="inbox-error">
        <ScreenHeader eyebrow="Capture" title="Inbox" description="Server unavailable" />
        <FeedbackBanner tone="danger" message={msg} />
        <Button title="Retry" variant="secondary" onPress={() => inboxQuery.refetch()} />
      </AppScreen>
    );
  }

  return (
    <AppScreen testID="inbox-screen" padded={false}>
      <View style={styles.screenWrap}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: contentBottomPadding }]}
          refreshControl={<RefreshControl refreshing={inboxQuery.isRefetching} onRefresh={() => inboxQuery.refetch()} />}
        >
          <ScreenHeader eyebrow="Capture" title="Inbox" description="Loose ideas before they become tasks." />

          {error ? <FeedbackBanner tone="danger" message={error} testID="inbox-error-banner" /> : null}

          <Card style={styles.hintCard} testID="inbox-hint-card">
            <Text style={styles.hintTitle}>Quick capture</Text>
            <Text style={styles.hintText}>Tap Capture to save a raw thought without choosing a Project. Retry is safe — same tap won&apos;t duplicate.</Text>
          </Card>

          {items.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No ideas yet</Text>
              <Text style={styles.emptyText}>Capture a thought to keep it separate from tasks until you are ready to process it.</Text>
            </Card>
          ) : (
            <View style={styles.list}>
              {items.map((item: any) => (
                <Card key={item.id} style={styles.itemCard}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemMeta}>
                    {item.type} · {item.status}
                    {item.projectName ? ` · ${item.projectName}` : " · No project"}
                  </Text>
                  {item.body ? <Text style={styles.itemBody}>{item.body}</Text> : null}
                  {item.tags?.length ? <Text style={styles.itemTags}>{item.tags.join(", ")}</Text> : null}
                  <View style={styles.itemActions}>
                    {item.status === "archived" ? (
                      <Button title="Restore" variant="secondary" size="sm" onPress={() => handleRestore(item.id)} testID={`inbox-restore-${item.id}`} />
                    ) : (
                      <Button title="Archive" variant="secondary" size="sm" onPress={() => handleArchive(item.id)} testID={`inbox-archive-${item.id}`} />
                    )}
                  </View>
                </Card>
              ))}
            </View>
          )}
        </ScrollView>

        <FloatingActionButton
          label="Capture idea"
          icon="add"
          onPress={() => setCaptureVisible(true)}
          testID="inbox-fab-capture"
          accessibilityLabel="Capture idea to Inbox"
        />

        <InboxCaptureSheet
          visible={captureVisible}
          onClose={() => setCaptureVisible(false)}
          onSubmit={handleCaptureSubmit}
          initialTitle={draftTitle}
          initialBody={draftBody}
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: mobileTheme.spacing.md,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  hintCard: {
    gap: 6,
  },
  hintText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  hintTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
  },
  emptyCard: {
    alignItems: "center",
    gap: mobileTheme.spacing.sm,
    paddingVertical: mobileTheme.spacing.xl,
  },
  emptyText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    textAlign: "center",
  },
  emptyTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.semibold,
  },
  itemActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: mobileTheme.spacing.sm,
  },
  itemBody: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 6,
  },
  itemCard: {
    gap: 4,
  },
  itemMeta: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
  },
  itemTags: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  itemTitle: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.semibold,
  },
  list: {
    gap: mobileTheme.spacing.md,
  },
  screenWrap: {
    flex: 1,
  },
});
