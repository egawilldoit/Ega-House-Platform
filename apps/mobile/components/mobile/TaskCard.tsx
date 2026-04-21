import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { InfoBadge, SurfaceCard } from '@/components/mobile/primitives';
import { mobileTheme, priorityTone, statusTone } from '@/components/mobile/theme';

function formatStatus(value: string) {
  return value.replace(/_/g, ' ');
}

export function TaskCard({
  title,
  project,
  goal,
  status,
  priority,
  dueLabel,
  estimateLabel,
  blockedReason,
  saving,
  onOpen,
  onActions,
}: {
  title: string;
  project: string;
  goal?: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueLabel: string;
  estimateLabel?: string;
  blockedReason?: string | null;
  saving?: boolean;
  onOpen: () => void;
  onActions: () => void;
}) {
  const statusColors = statusTone(status);
  const priorityColors = priorityTone(priority);

  return (
    <SurfaceCard>
      <Text numberOfLines={2} style={styles.title}>
        {title}
      </Text>
      <Text numberOfLines={1} style={styles.meta}>
        {project}
        {goal ? ` · ${goal}` : ''}
      </Text>

      <View style={styles.indicatorsRow}>
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
        <Text style={styles.metaStrong}>{dueLabel}</Text>
        {estimateLabel ? <Text style={styles.metaQuiet}>{estimateLabel}</Text> : null}
      </View>

      {blockedReason ? (
        <Text numberOfLines={2} style={styles.blocked}>
          Blocked: {blockedReason}
        </Text>
      ) : null}

      <View style={styles.actionsRow}>
        <Pressable disabled={saving} onPress={onOpen} style={styles.primaryAction}>
          <Text style={styles.primaryActionText}>{saving ? 'Saving...' : 'Open'}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Open task actions"
          disabled={saving}
          onPress={onActions}
          style={styles.iconAction}
        >
          <FontAwesome color={mobileTheme.colors.textMuted} name="ellipsis-h" size={16} />
        </Pressable>
      </View>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  blocked: {
    color: mobileTheme.colors.danger,
    fontSize: 12,
    marginTop: 8,
  },
  iconAction: {
    alignItems: 'center',
    backgroundColor: '#edf2f8',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  indicatorsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 6,
  },
  metaQuiet: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: '600',
  },
  metaStrong: {
    color: mobileTheme.colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  primaryActionText: {
    color: mobileTheme.colors.info,
    fontSize: 13,
    fontWeight: '800',
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    lineHeight: 22,
  },
});
