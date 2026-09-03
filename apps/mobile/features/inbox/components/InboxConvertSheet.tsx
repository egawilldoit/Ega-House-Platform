import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { InboxItem, InboxProjectOption } from "@ega/contracts/inbox";
import { mobileTheme } from "@/components/mobile/theme";
import { Button } from "@/components/mobile/ui/Button";
import { FeedbackBanner } from "@/components/mobile/ui/FeedbackBanner";
import { SelectionRow } from "@/components/mobile/ui/SelectionRow";

export type InboxConvertSheetProps = {
  visible: boolean;
  item: InboxItem | null;
  projects: InboxProjectOption[];
  onClose: () => void;
  onSubmit: (projectId: string) => Promise<void>;
};

export function InboxConvertSheet({ visible, item, projects, onClose, onSubmit }: InboxConvertSheetProps) {
  const insets = useSafeAreaInsets();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const preferred = item?.projectId && projects.some((project) => project.id === item.projectId)
      ? item.projectId
      : projects[0]?.id ?? null;
    // Sync the default project when the sheet opens; selection remains local to this transient flow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjectId(preferred);
    setError(null);
  }, [item, projects, visible]);

  async function handleSubmit() {
    if (!projectId) {
      setError("Choose a project before creating the task.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(projectId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to convert this idea.");
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
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Inbox conversion"
            disabled={pending}
            onPress={handleClose}
            style={styles.closeButton}
            testID="inbox-convert-close"
          >
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Create task
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} testID="inbox-convert-sheet">
          <Text style={styles.eyebrow}>Inbox Processing</Text>
          <Text style={styles.title}>{item?.title ?? "Choose a project"}</Text>
          <Text style={styles.description}>Choose where this idea belongs. The original Inbox item will be marked converted and the new task will open in Tasks, where you can review or schedule it for Today.</Text>

          <Text style={styles.sectionLabel}>Project</Text>
          {projects.length > 0 ? (
            <View style={styles.projectList}>
              {projects.map((project) => (
                <SelectionRow
                  key={project.id}
                  label={project.name}
                  onPress={() => setProjectId(project.id)}
                  selected={project.id === projectId}
                  testID={`inbox-convert-project-${project.id}`}
                />
              ))}
            </View>
          ) : (
            <FeedbackBanner message="Create a project before converting an idea into a task." tone="warning" />
          )}

          {error ? <FeedbackBanner tone="danger" message={error} testID="inbox-convert-error" /> : null}

          <Button
            accessibilityLabel="Create task from Inbox idea"
            disabled={!projectId}
            loading={pending}
            onPress={handleSubmit}
            title={pending ? "Creating task..." : "Create task"}
            testID="inbox-convert-submit"
          />
        </ScrollView>
      </View>
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
  projectList: {
    gap: mobileTheme.spacing.sm,
  },
  sectionLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    marginTop: mobileTheme.spacing.sm,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 18,
    fontWeight: mobileTheme.font.bold,
  },
});
