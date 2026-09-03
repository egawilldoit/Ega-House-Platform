import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { InboxItem, UpdateInboxInput } from "@ega/contracts/inbox";
import { mobileTheme } from "@/components/mobile/theme";
import { Button } from "@/components/mobile/ui/Button";
import { FeedbackBanner } from "@/components/mobile/ui/FeedbackBanner";
import { FormField } from "@/components/mobile/ui/FormField";

type InboxEditableInput = Omit<UpdateInboxInput, "id">;

export type InboxEditSheetProps = {
  visible: boolean;
  item: InboxItem | null;
  onClose: () => void;
  onSubmit: (input: InboxEditableInput) => Promise<void>;
};

function editableStatus(item: InboxItem): UpdateInboxInput["status"] {
  return item.status === "inbox" || item.status === "reviewing" || item.status === "planned"
    ? item.status
    : "inbox";
}

export function InboxEditSheet({ visible, item, onClose, onSubmit }: InboxEditSheetProps) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!visible || !item) return;
    // Sync the selected item when the sheet opens; the parent remains the source of truth.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(item.title);
    setBody(item.body ?? "");
    setError(null);
  }, [item, visible]);

  async function handleSubmit() {
    if (!item) return;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Title is required.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onSubmit({
        title: normalizedTitle,
        body: body.trim() || null,
        type: item.type,
        projectId: item.projectId,
        priority: item.priority,
        tags: item.tags,
        status: editableStatus(item),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this idea.");
    } finally {
      setPending(false);
    }
  }

  function handleClose() {
    if (!pending) onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
      transparent={false}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.container, { paddingBottom: Math.max(insets.bottom, 12) }]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Inbox edit"
            disabled={pending}
            onPress={handleClose}
            style={styles.closeButton}
            testID="inbox-edit-close"
          >
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Edit idea
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          testID="inbox-edit-sheet"
        >
          <Text style={styles.eyebrow}>Inbox Processing</Text>
          <Text style={styles.description}>Refine the thought before you archive it or turn it into a task.</Text>

          <FormField
            autoFocus
            editable={!pending}
            label="Title"
            onChangeText={setTitle}
            placeholder="What is the idea?"
            required
            testID="inbox-edit-title-input"
            value={title}
          />
          <FormField
            editable={!pending}
            label="Context"
            multiline
            onChangeText={setBody}
            placeholder="Add context, links, or next thoughts."
            testID="inbox-edit-body-input"
            value={body}
          />

          {error ? <FeedbackBanner tone="danger" message={error} testID="inbox-edit-error" /> : null}

          <Button
            accessibilityLabel="Save Inbox idea"
            loading={pending}
            onPress={handleSubmit}
            title={pending ? "Saving..." : "Save changes"}
            testID="inbox-edit-submit"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileTheme.layout.minTouchTarget,
    minWidth: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: 8,
  },
  closeText: {
    color: mobileTheme.colors.accent,
    fontSize: 15,
    fontWeight: mobileTheme.font.medium,
  },
  container: {
    backgroundColor: mobileTheme.colors.background,
    flex: 1,
    paddingTop: 8,
  },
  content: {
    gap: mobileTheme.spacing.sm,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.md,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  eyebrow: {
    color: mobileTheme.colors.accent,
    fontSize: 11,
    fontWeight: mobileTheme.font.black,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  header: {
    alignItems: "center",
    borderBottomColor: mobileTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 8,
  },
  headerSpacer: {
    minWidth: mobileTheme.layout.minTouchTarget,
  },
  headerTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
  },
});
