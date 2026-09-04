import { useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { mobileTheme } from "@/components/mobile/theme";
import { AppScreen } from "@/components/mobile/ui/AppScreen";
import { Button } from "@/components/mobile/ui/Button";
import { Card } from "@/components/mobile/ui/Card";
import { FeedbackBanner } from "@/components/mobile/ui/FeedbackBanner";
import { FloatingActionButton } from "@/components/mobile/ui/FloatingActionButton";
import { SegmentedControl } from "@/components/mobile/ui/SegmentedControl";
import { ScreenHeader } from "@/components/mobile/ui/ScreenHeader";
import { useBottomChromeMetrics } from "@/components/mobile/navigation/bottomChrome";
import { InboxCaptureSheet } from "@/features/inbox/components/InboxCaptureSheet";
import { InboxConvertSheet } from "@/features/inbox/components/InboxConvertSheet";
import { InboxEditSheet } from "@/features/inbox/components/InboxEditSheet";
import {
  useArchiveInboxMutation,
  useConvertInboxMutation,
  useCreateInboxMutation,
  useInboxListQuery,
  useRestoreInboxMutation,
  useUpdateInboxMutation,
} from "@/features/inbox/query";
import type { InboxItem, InboxListView, UpdateInboxInput } from "@ega/contracts/inbox";

const INBOX_VIEW_OPTIONS: Array<{ label: string; value: InboxListView }> = [
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
];

type InboxEditableInput = Omit<UpdateInboxInput, "id">;

export default function InboxScreen() {
  const router = useRouter();
  const [view, setView] = useState<InboxListView>("active");
  const inboxQuery = useInboxListQuery({ view });
  const createMutation = useCreateInboxMutation();
  const archiveMutation = useArchiveInboxMutation();
  const restoreMutation = useRestoreInboxMutation();
  const updateMutation = useUpdateInboxMutation();
  const convertMutation = useConvertInboxMutation();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [captureVisible, setCaptureVisible] = useState(false);
  const [editItem, setEditItem] = useState<InboxItem | null>(null);
  const [convertItem, setConvertItem] = useState<InboxItem | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const { contentBottomPadding } = useBottomChromeMetrics();

  const items = inboxQuery.data?.items ?? [];
  const projects = inboxQuery.data?.projects ?? [];
  const isLoading = inboxQuery.isPending && !inboxQuery.data;
  const isError = inboxQuery.isError && !inboxQuery.data;
  const isMutating =
    archiveMutation.isPending ||
    restoreMutation.isPending ||
    updateMutation.isPending ||
    convertMutation.isPending;

  async function handleCaptureSubmit(input: { title: string; body: string | null; idempotencyKey: string }) {
    // Preserve draft until success; do not clear on failure (retry-safe)
    setDraftTitle(input.title);
    setDraftBody(input.body ?? "");
    setError(null);
    setSuccess(null);
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
    setSuccess(null);
    try {
      await archiveMutation.mutateAsync(id);
      setSuccess("Idea archived.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to archive idea.");
    }
  }

  async function handleRestore(id: string) {
    setError(null);
    setSuccess(null);
    try {
      await restoreMutation.mutateAsync(id);
      setSuccess("Idea restored to Inbox.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to restore idea.");
    }
  }

  async function handleEdit(input: InboxEditableInput) {
    if (!editItem) return;
    setError(null);
    setSuccess(null);
    try {
      await updateMutation.mutateAsync({ id: editItem.id, input });
      setEditItem(null);
      setSuccess("Idea updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save this idea.");
      throw e;
    }
  }

  async function handleConvert(projectId: string) {
    if (!convertItem) return;
    setError(null);
    setSuccess(null);
    try {
      const result = await convertMutation.mutateAsync({ id: convertItem.id, input: { projectId } });
      setConvertItem(null);
      setSuccess("Task created from Inbox idea.");
      router.push({ pathname: "/(app)/tasks/[id]", params: { id: result.task.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to convert this idea.");
      throw e;
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

          <SegmentedControl
            disabled={isMutating}
            onChange={(nextView) => {
              setError(null);
              setSuccess(null);
              setView(nextView);
            }}
            options={INBOX_VIEW_OPTIONS}
            testID="inbox-view-control"
            value={view}
          />

          {error ? <FeedbackBanner tone="danger" message={error} testID="inbox-error-banner" /> : null}
          {success ? <FeedbackBanner tone="success" message={success} testID="inbox-success-banner" /> : null}

          <Card style={styles.hintCard} testID="inbox-hint-card">
            <Text style={styles.hintTitle}>Quick capture</Text>
            <Text style={styles.hintText}>Tap Capture to save a raw thought without choosing a Project. Retry is safe — same tap won&apos;t duplicate.</Text>
          </Card>

          {items.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {view === "archived" ? "No archived ideas" : view === "all" ? "Inbox is empty" : "No active ideas"}
              </Text>
              <Text style={styles.emptyText}>
                {view === "archived"
                  ? "Archived ideas will appear here so you can restore them when they become useful again."
                  : "Capture a thought to keep it separate from tasks until you are ready to process it."}
              </Text>
            </Card>
          ) : (
            <View style={styles.list}>
              {items.map((item: InboxItem) => (
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
                      <Button
                        title="Restore"
                        variant="secondary"
                        size="sm"
                        disabled={isMutating}
                        loading={restoreMutation.isPending}
                        onPress={() => handleRestore(item.id)}
                        testID={`inbox-restore-${item.id}`}
                      />
                    ) : item.status === "converted" ? (
                      <FeedbackBanner message="Converted to task" tone="neutral" testID={`inbox-converted-${item.id}`} />
                    ) : (
                      <>
                        <Button
                          title="Edit"
                          variant="ghost"
                          size="sm"
                          disabled={isMutating}
                          onPress={() => setEditItem(item)}
                          testID={`inbox-edit-${item.id}`}
                        />
                        <Button
                          title="Convert"
                          variant="secondary"
                          size="sm"
                          disabled={isMutating}
                          onPress={() => setConvertItem(item)}
                          testID={`inbox-convert-${item.id}`}
                        />
                        <Button
                          title="Archive"
                          variant="secondary"
                          size="sm"
                          disabled={isMutating}
                          loading={archiveMutation.isPending}
                          onPress={() => handleArchive(item.id)}
                          testID={`inbox-archive-${item.id}`}
                        />
                      </>
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
        <InboxEditSheet
          visible={Boolean(editItem)}
          item={editItem}
          onClose={() => setEditItem(null)}
          onSubmit={handleEdit}
        />
        <InboxConvertSheet
          visible={Boolean(convertItem)}
          item={convertItem}
          projects={projects}
          onClose={() => setConvertItem(null)}
          onSubmit={handleConvert}
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
    flexWrap: "wrap",
    gap: mobileTheme.spacing.xs,
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
