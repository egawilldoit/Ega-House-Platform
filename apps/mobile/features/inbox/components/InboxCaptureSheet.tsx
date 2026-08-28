import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mobileTheme } from "@/components/mobile/theme";
import { Button } from "@/components/mobile/ui/Button";
import { FeedbackBanner } from "@/components/mobile/ui/FeedbackBanner";

function createIdempotencyKey(): string {
  // Prefer crypto.randomUUID if available (Expo/Jest polyfill)
  const g: any = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type InboxCaptureSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: { title: string; body: string | null; idempotencyKey: string }) => Promise<void>;
  initialTitle?: string;
  initialBody?: string;
};

export function InboxCaptureSheet({
  visible,
  onClose,
  onSubmit,
  initialTitle = "",
  initialBody = "",
}: InboxCaptureSheetProps) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  useEffect(() => {
    if (visible) {
      setTitle(initialTitle);
      setBody(initialBody);
      setError(null);
      // Generate fresh key for each new sheet open unless we are retrying same draft
      // If title/body were preserved from parent (draft), keep same key for retry
      if (!initialTitle && !initialBody) {
        idempotencyKeyRef.current = createIdempotencyKey();
      }
    }
  }, [visible, initialTitle, initialBody]);

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        title: trimmed,
        body: body.trim() ? body.trim() : null,
        idempotencyKey: idempotencyKeyRef.current,
      });
      // Success: reset key for next capture, clear error
      idempotencyKeyRef.current = createIdempotencyKey();
      setError(null);
      onClose();
    } catch (e) {
      // Preserve draft and key for retry; do not claim success
      const message = e instanceof Error ? e.message : "Unable to capture idea.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  function handleClose() {
    if (pending) return;
    onClose();
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
            accessibilityLabel="Close inbox capture"
            onPress={handleClose}
            style={styles.closeButton}
            testID="inbox-capture-close"
          >
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Capture idea
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.content} testID="inbox-capture-sheet">
          <Text style={styles.eyebrow}>Inbox Capture</Text>
          <Text style={styles.description}>Save a raw thought without choosing a Project. You can organize it later.</Text>

          <Text style={styles.label} nativeID="inbox-capture-title-label">
            Thought
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Follow up on onboarding insight"
            placeholderTextColor={mobileTheme.colors.textMuted}
            style={styles.input}
            testID="inbox-capture-title-input"
            accessibilityLabel="Inbox capture title"
            aria-labelledby="inbox-capture-title-label"
            autoFocus
            returnKeyType="next"
            editable={!pending}
          />

          <Text style={styles.label} nativeID="inbox-capture-body-label">
            Context (optional)
          </Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Add context, links, or next thoughts."
            placeholderTextColor={mobileTheme.colors.textMuted}
            style={[styles.input, styles.bodyInput]}
            testID="inbox-capture-body-input"
            accessibilityLabel="Inbox capture body"
            aria-labelledby="inbox-capture-body-label"
            multiline
            textAlignVertical="top"
            editable={!pending}
          />

          {error ? (
            <FeedbackBanner tone="danger" message={error} testID="inbox-capture-error" />
          ) : null}

          <View style={styles.actions}>
            <Button
              title={pending ? "Capturing..." : "Capture idea"}
              onPress={handleSubmit}
              disabled={pending}
              testID="inbox-capture-submit"
              accessibilityLabel="Capture idea to inbox"
            />
          </View>

          <Text style={styles.helper}>Draft is kept if capture fails — retry won&apos;t duplicate.</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    marginTop: mobileTheme.spacing.md,
  },
  bodyInput: {
    minHeight: 96,
    paddingTop: 12,
  },
  closeButton: {
    minHeight: mobileTheme.layout.minTouchTarget,
    minWidth: mobileTheme.layout.minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
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
    flex: 1,
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
  helper: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 8,
    textAlign: "center",
  },
  input: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.md,
    color: mobileTheme.colors.text,
    fontSize: 15,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 12,
  },
  label: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 4,
  },
});
