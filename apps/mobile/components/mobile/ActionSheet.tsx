import { ReactNode } from 'react';
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
            {items.map((item) => (
              <Pressable
                key={item.key}
                disabled={item.disabled}
                onPress={() => {
                  item.onPress();
                  onClose();
                }}
                style={[styles.action, item.disabled ? styles.actionDisabled : null]}
              >
                <Text style={[styles.actionLabel, item.destructive ? styles.destructiveText : null]}>
                  {item.label}
                </Text>
                {item.description ? (
                  <Text style={styles.actionDescription}>{item.description}</Text>
                ) : null}
              </Pressable>
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
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    gap: 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionDescription: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionLabel: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  actions: {
    maxHeight: 360,
  },
  actionsContent: {
    gap: 8,
    paddingBottom: 4,
  },
  destructiveText: {
    color: mobileTheme.colors.danger,
  },
  footer: {
    marginTop: 10,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: '#cbd5e1',
    borderRadius: 999,
    height: 5,
    marginBottom: 10,
    width: 48,
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
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  subtitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginBottom: 10,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
});
