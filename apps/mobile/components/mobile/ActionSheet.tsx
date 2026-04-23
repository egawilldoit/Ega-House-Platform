import { ReactNode, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
        <View style={styles.sheet}>
          <View style={styles.handle} />
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
                    style={[styles.action, item.disabled ? styles.actionDisabled : null]}
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
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderBottomColor: mobileTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 4,
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
  actions: {
    maxHeight: 420,
  },
  actionsContent: {
    paddingBottom: 4,
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
    marginTop: 8,
    textTransform: 'uppercase',
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: mobileTheme.colors.borderStrong,
    borderRadius: 999,
    height: 4,
    marginBottom: 14,
    width: 40,
  },
  overlay: {
    backgroundColor: mobileTheme.colors.overlay,
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: mobileTheme.colors.surface,
    borderTopLeftRadius: mobileTheme.radius.sheet,
    borderTopRightRadius: mobileTheme.radius.sheet,
    paddingBottom: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    ...mobileTheme.shadow.sheet,
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
