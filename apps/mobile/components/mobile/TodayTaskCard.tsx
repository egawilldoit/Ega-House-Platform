import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { InfoBadge, SurfaceCard } from '@/components/mobile/primitives';
import { mobileTheme, priorityTone, statusTone } from '@/components/mobile/theme';

function formatStatus(value: string) {
  return value.replace(/_/g, ' ');
}

export function TodayTaskCard({
  title,
  project,
  goal,
  status,
  priority,
  dueLabel,
  blockedReason,
  primaryActionLabel,
  muted,
  busy,
  onPrimaryAction,
  onOpen,
  onActions,
}: {
  title: string;
  project: string;
  goal?: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueLabel: string;
  blockedReason?: string | null;
  primaryActionLabel: string;
  muted?: boolean;
  busy?: boolean;
  onPrimaryAction: () => void;
  onOpen: () => void;
  onActions: () => void;
}) {
  const statusColors = statusTone(status);
  const priorityColors = priorityTone(priority);

  return (
    <SurfaceCard style={muted ? styles.mutedCard : undefined}>
      <Text numberOfLines={2} style={[styles.title, muted ? styles.titleMuted : null]}>
        {title}
      </Text>
      <Text numberOfLines={1} style={styles.meta}>
        {project}
        {goal ? ` · ${goal}` : ''}
      </Text>

      <View style={styles.metaRow}>
        <InfoBadge
          backgroundColor={statusColors.background}
          label={formatStatus(status)}
          textColor={statusColors.color}
        />
        <InfoBadge
          backgroundColor={priorityColors.background}
          label={priority}
          textColor={priorityColors.color}
        />
        <Text style={[styles.due, status === 'blocked' ? styles.blockedDue : null]}>{dueLabel}</Text>
      </View>

      {blockedReason ? (
        <Text numberOfLines={2} style={styles.blockedReason}>
          {blockedReason}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable disabled={busy} onPress={onPrimaryAction} style={styles.primary}>
          <Text style={styles.primaryText}>{busy ? 'Working...' : primaryActionLabel}</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={onOpen} style={styles.secondary}>
          <Text style={styles.secondaryText}>Open</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={onActions} style={styles.icon}>
          <FontAwesome color={mobileTheme.colors.textMuted} name="ellipsis-h" size={16} />
        </Pressable>
      </View>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  blockedDue: {
    color: mobileTheme.colors.danger,
  },
  blockedReason: {
    color: mobileTheme.colors.danger,
    fontSize: 12,
    marginTop: 8,
  },
  due: {
    color: mobileTheme.colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  icon: {
    alignItems: 'center',
    backgroundColor: '#edf2f8',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 5,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  mutedCard: {
    opacity: 0.75,
  },
  primary: {
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  primaryText: {
    color: mobileTheme.colors.info,
    fontSize: 13,
    fontWeight: '800',
  },
  secondary: {
    alignItems: 'center',
    backgroundColor: '#eef2f7',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 66,
    paddingHorizontal: 10,
  },
  secondaryText: {
    color: mobileTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  titleMuted: {
    color: '#475569',
  },
});
