import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { mobileTheme } from "@/components/mobile/theme";
import { AppScreen } from "@/components/mobile/ui/AppScreen";
import { Button } from "@/components/mobile/ui/Button";
import { Card } from "@/components/mobile/ui/Card";
import { FeedbackBanner } from "@/components/mobile/ui/FeedbackBanner";
import { ScreenHeader } from "@/components/mobile/ui/ScreenHeader";
import { useInboxListQuery, useArchiveInboxMutation, useCreateInboxMutation, useRestoreInboxMutation } from "@/features/inbox/query";

export default function InboxScreen() {
  const inboxQuery = useInboxListQuery();
  const createMutation = useCreateInboxMutation();
  const archiveMutation = useArchiveInboxMutation();
  const restoreMutation = useRestoreInboxMutation();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const items = (inboxQuery.data as any)?.items ?? [];
  const isLoading = inboxQuery.isPending && !inboxQuery.data;
  const isError = inboxQuery.isError && !inboxQuery.data;

  async function handleCreate() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required.");
      return;
    }
    setError(null);
    try {
      await createMutation.mutateAsync({ title: trimmed });
      setTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create idea.");
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
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={inboxQuery.isRefetching} onRefresh={() => inboxQuery.refetch()} />}
      >
        <ScreenHeader eyebrow="Capture" title="Inbox" description="Loose ideas before they become tasks." />

        {error ? <FeedbackBanner tone="danger" message={error} /> : null}

        <Card style={styles.createCard}>
          <Text style={styles.createTitle}>Capture idea</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Follow up on onboarding insight"
            placeholderTextColor={mobileTheme.colors.textMuted}
            style={styles.input}
            testID="inbox-title-input"
          />
          <Button
            title={createMutation.isPending ? "Capturing..." : "Capture idea"}
            onPress={handleCreate}
            disabled={createMutation.isPending}
            testID="inbox-create-button"
          />
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
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: mobileTheme.spacing.md,
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  createCard: {
    gap: mobileTheme.spacing.sm,
  },
  createTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
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
  input: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.md,
    color: mobileTheme.colors.text,
    fontSize: 15,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 12,
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
});
