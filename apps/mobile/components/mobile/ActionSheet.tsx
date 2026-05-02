import { ReactNode, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassBottomSheet } from '@/components/mobile/glass';
import { mobileTheme } from '@/components/mobile/theme';

export type ActionSheetItem = {
  key: string;
  label: string;
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

type ActionGroup = {
  key: string;
  label: string;
  items: ActionSheetItem[];
};

function groupItems(items: ActionSheetItem[]): ActionGroup[] {
  const statusItems = items.filter((item) => item.key.startsWith('status-'));
  const priorityItems = items.filter((item) => item.key.startsWith('priority-'));
  const dueItems = items.filter((item) => item.key.startsWith('due-'));
  const generalItems = items.filter(
    (item) =>
      !item.key.startsWith('status-') &&
      !item.key.startsWith('priority-') &&
      !item.key.startsWith('due-'),
  );

  return [
    { key: 'status', label: 'Status', items: statusItems },
    { key: 'priority', label: 'Priority', items: priorityItems },
    { key: 'due', label: 'Due date', items: dueItems },
    { key: 'general', label: 'Actions', items: generalItems },
  ].filter((group) => group.items.length > 0);
}

function getActionDotColor(item: ActionSheetItem) {
  if (item.destructive) {
    return mobileTheme.colors.danger;
  }

  if (item.key.startsWith('status-')) {
    return mobileTheme.colors.info;
  }

  if (item.key.startsWith('priority-')) {
    return mobileTheme.colors.warning;
  }

  if (item.key.startsWith('due-')) {
    return mobileTheme.colors.accent;
  }

  return mobileTheme.colors.textSubtle;
}

export function ActionSheet({
  visible,
  title,
  subtitle,
  items,
  footer,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  items: ActionSheetItem[];
  footer?: ReactNode;
  onClose: () => void;
}) {
  const groupedItems = useMemo(() => groupItems(items), [items]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <SafeAreaView edges={['bottom']} style={styles.overlay}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <GlassBottomSheet style={styles.sheet} contentStyle={styles.sheetContent}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <ScrollView style={styles.actions} contentContainerStyle={styles.actionsContent}>
            {groupedItems.map((group) => (
              <View key={group.key}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                {group.items.map((item) => (
                  <Pressable
                    key={item.key}
                    disabled={item.disabled}
                    onPress={() => {
                      item.onPress();
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.action,
                      item.disabled ? styles.actionDisabled : null,
                      pressed && !item.disabled ? styles.actionPressed : null,
                    ]}
                  >
                    <View style={[styles.actionDot, { backgroundColor: getActionDotColor(item) }]} />
                    <View style={styles.actionCopy}>
                      <Text style={[styles.actionLabel, item.destructive ? styles.destructiveText : null]}>
                        {item.label}
                      </Text>
                      {item.description ? (
                        <Text style={styles.actionDescription}>{item.description}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </GlassBottomSheet>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: mobileTheme.glass.fakeBackground,
    borderColor: mobileTheme.glass.border,
    borderRadius: mobileTheme.radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 14,
  },
  actionCopy: {
    flex: 1,
  },
  actionDescription: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  actionDisabled: {
    opacity: 0.38,
  },
  actionDot: {
    borderRadius: mobileTheme.radius.pill,
    height: 8,
    width: 8,
  },
  actionLabel: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.semibold,
  },
  actionPressed: {
    opacity: 0.78,
  },
  actions: {
    maxHeight: 420,
  },
  actionsContent: {
    paddingBottom: mobileTheme.spacing.xs,
  },
  destructiveText: {
    color: mobileTheme.colors.danger,
  },
  footer: {
    marginTop: 10,
  },
  groupLabel: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.8,
    marginTop: mobileTheme.spacing.md,
    textTransform: 'uppercase',
  },
  overlay: {
    backgroundColor: 'rgba(10,15,30,0.32)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    marginHorizontal: 0,
  },
  sheetContent: {
    paddingHorizontal: 16,
  },
  subtitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginBottom: 14,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
    marginBottom: 2,
  },
});
