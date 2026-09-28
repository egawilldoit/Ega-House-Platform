import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { InboxProjectOption } from "@ega/contracts/inbox";
import { mobileTheme } from "@/components/mobile/theme";
import { Button } from "@/components/mobile/ui/Button";
import { FeedbackBanner } from "@/components/mobile/ui/FeedbackBanner";
import { SelectionRow } from "@/components/mobile/ui/SelectionRow";

function createIdempotencyKey(): string {
  // Prefer crypto.randomUUID if available (Expo/Jest polyfill)
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type InboxCaptureSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    body: string | null;
    projectId: string | null;
    idempotencyKey: string;
  }) => Promise<void>;
  initialTitle?: string;
  initialBody?: string;
  initialProjectId?: string;
  projects?: InboxProjectOption[];
};

export function InboxCaptureSheet({
  visible,
  onClose,
  onSubmit,
  initialTitle = "",
  initialBody = "",
  initialProjectId = "",
  projects = [],
}: InboxCaptureSheetProps) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  useEffect(() => {
    if (visible) {
      // Sync draft from parent (retry-safe) - intentional setState in effect for sheet open
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(initialTitle);
      setBody(initialBody);
      setProjectId(initialProjectId);
      setError(null);
      // Generate fresh key for each new sheet open unless we are retrying same draft
      // If title/body were preserved from parent (draft), keep same key for retry
      if (!initialTitle && !initialBody) {
        idempotencyKeyRef.current = createIdempotencyKey();
      }
    }
  }, [visible, initialTitle, initialBody, initialProjectId]);

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
        projectId: projectId || null,
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
            accessibilityLabel="Close backlog capture"
            onPress={handleClose}
            style={styles.closeButton}
            testID="inbox-capture-close"
          >
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Add to Backlog
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          testID="inbox-capture-sheet"
        >
          <Text style={styles.eyebrow}>Backlog Capture</Text>
          <Text style={styles.description}>Save an idea with an optional Project. Keep it here until it becomes real work.</Text>

          <Text style={styles.label} nativeID="inbox-capture-title-label">
            Idea
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Follow up on onboarding insight"
            placeholderTextColor={mobileTheme.colors.textMuted}
            style={styles.input}
            testID="inbox-capture-title-input"
            accessibilityLabel="Backlog capture title"
            aria-labelledby="inbox-capture-title-label"
            autoFocus
            returnKeyType="next"
            editable={!pending}
          />

          <Text style={styles.label} nativeID="inbox-capture-project-label">
            Project (optional)
          </Text>
          {projects.length > 0 ? (
            <View style={styles.projectList}>
              <SelectionRow
                label="No project"
                onPress={() => setProjectId("")}
                selected={projectId === ""}
                testID="inbox-capture-project-none"
              />
              {projects.map((project) => (
                <SelectionRow
                  key={project.id}
                  label={project.name}
                  onPress={() => setProjectId(project.id)}
                  selected={project.id === projectId}
                  testID={`inbox-capture-project-${project.id}`}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.helper}>No projects yet — you can add one later.</Text>
          )}

          <Text style={styles.label} nativeID="inbox-capture-body-label">
            Notes (optional)
          </Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Add context, links, or next thoughts."
            placeholderTextColor={mobileTheme.colors.textMuted}
            style={[styles.input, styles.bodyInput]}
            testID="inbox-capture-body-input"
            accessibilityLabel="Backlog capture notes"
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
              title={pending ? "Adding..." : "Add to Backlog"}
              onPress={handleSubmit}
              disabled={pending}
              testID="inbox-capture-submit"
              accessibilityLabel="Add to Backlog"
            />
          </View>

          <Text style={styles.helper}>Draft is kept if capture fails — retry won&apos;t duplicate.</Text>
        </ScrollView>
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
    alignItems: 'center',
    justifyContent: 'center',
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
    textTransform: 'uppercase',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: mobileTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    textAlign: 'center',
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
  projectList: {
    gap: mobileTheme.spacing.xs,
  },
});
