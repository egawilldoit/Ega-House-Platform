import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

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
  const hasDueDate = dueLabel.toLowerCase() !== 'no due date';

  return (
    <View style={styles.cardShell}>
      <SurfaceCard style={styles.card}>
        <View style={[styles.leftAccent, { backgroundColor: statusColors.color }]} />
        <Pressable disabled={saving} onPress={onOpen} style={styles.mainTapArea}>
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
              dot={statusColors.dot}
              label={formatStatus(status)}
              textColor={statusColors.color}
            />
            <InfoBadge
              backgroundColor={priorityColors.background}
              dot={priorityColors.dot}
              label={priority}
              textColor={priorityColors.color}
            />
          </View>

          <View style={styles.metaPillRow}>
            <View style={styles.metaPill}>
              <Ionicons
                color={hasDueDate ? mobileTheme.colors.text : mobileTheme.colors.textSubtle}
                name="calendar-outline"
                size={13}
              />
              <Text
                numberOfLines={1}
                style={[styles.metaStrong, !hasDueDate ? styles.metaQuiet : null]}
              >
                {dueLabel}
              </Text>
            </View>
            {estimateLabel ? (
              <View style={styles.metaPill}>
                <Ionicons color={mobileTheme.colors.textSubtle} name="timer-outline" size={13} />
                <Text numberOfLines={1} style={styles.metaQuiet}>
                  {estimateLabel}
                </Text>
              </View>
            ) : null}
          </View>

          {blockedReason ? (
            <View style={styles.blockedBox}>
              <Ionicons
                color={mobileTheme.colors.blocked}
                name="alert-circle-outline"
                size={14}
              />
              <Text numberOfLines={2} style={styles.blockedText}>
                {blockedReason}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <View style={styles.actionsRow}>
          <Pressable disabled={saving} onPress={onOpen} style={styles.secondaryAction}>
            {saving ? (
              <ActivityIndicator color={mobileTheme.colors.accentDark} size="small" />
            ) : (
              <>
                <Ionicons color={mobileTheme.colors.accentDark} name="open-outline" size={15} />
                <Text style={styles.secondaryActionText}>Edit</Text>
              </>
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="Open task actions"
            disabled={saving}
            onPress={onActions}
            style={styles.iconAction}
          >
            <Ionicons color={mobileTheme.colors.textMuted} name="ellipsis-horizontal" size={18} />
          </Pressable>
        </View>
      </SurfaceCard>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  blockedBox: {
    alignItems: 'flex-start',
    backgroundColor: mobileTheme.colors.dangerBg,
    borderLeftColor: mobileTheme.colors.blocked,
    borderLeftWidth: 3,
    borderRadius: mobileTheme.radius.sm,
    flexDirection: 'row',
    gap: 7,
    marginTop: mobileTheme.spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  blockedText: {
    color: mobileTheme.colors.blocked,
    flex: 1,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
    lineHeight: 17,
  },
  card: {
    overflow: 'hidden',
    paddingLeft: mobileTheme.spacing.xl,
    position: 'relative',
  },
  cardShell: {
    borderRadius: mobileTheme.radius.card,
    ...mobileTheme.shadow.cardHover,
  },
  iconAction: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  indicatorsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: mobileTheme.spacing.sm,
  },
  mainTapArea: {
    borderRadius: mobileTheme.radius.sm,
  },
  leftAccent: {
    borderBottomLeftRadius: mobileTheme.radius.card,
    borderTopLeftRadius: mobileTheme.radius.card,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 4,
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 6,
  },
  metaQuiet: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  metaPill: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  metaPillRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: mobileTheme.spacing.sm,
  },
  metaStrong: {
    color: mobileTheme.colors.text,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accentSoft,
    borderRadius: mobileTheme.radius.pill,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryActionText: {
    color: mobileTheme.colors.accentDark,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.2,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
});
