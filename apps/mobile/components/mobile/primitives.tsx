import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mobileTheme } from '@/components/mobile/theme';

export function MobileScreen({
  children,
  padded = true,
}: {
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.bgTopGlow} />
      <View style={styles.accentStrip}>
        <View style={styles.accentStripStart} />
        <View style={styles.accentStripEnd} />
      </View>
      <View style={[styles.content, !padded ? styles.contentUnpadded : null]}>{children}</View>
    </SafeAreaView>
  );
}

export function MobileScreenHeader({
  eyebrow,
  title,
  description,
  rightAction,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  rightAction?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {rightAction ? <View>{rightAction}</View> : null}
    </View>
  );
}

export function MobileSectionHeader({
  title,
  count,
}: {
  title: string;
  count?: number;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {typeof count === 'number' ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
  );
}

export function SurfaceCard({
  children,
  style,
  accentColor,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accentColor?: string;
}) {
  return (
    <View
      style={[
        styles.card,
        accentColor
          ? {
              borderLeftColor: accentColor,
              borderLeftWidth: 3,
              paddingLeft: mobileTheme.spacing.lg - 3,
            }
          : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function InfoBadge({
  label,
  backgroundColor,
  textColor,
  dot,
}: {
  label: string;
  backgroundColor: string;
  textColor: string;
  dot?: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor }]}> 
      <View style={[styles.dot, { backgroundColor: dot ?? textColor }]} />
      <Text style={[styles.badgeText, { color: textColor }]}>{label}</Text>
    </View>
  );
}

type SegmentedOption<T extends string> = {
  label: string;
  value: T;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.segmentedInner}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.segment, selected ? styles.segmentActive : null]}
            >
              <Text style={[styles.segmentText, selected ? styles.segmentTextActive : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function PrimaryFab({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.fab}>
      <View style={styles.fabToneLayer} />
      <Ionicons color={mobileTheme.colors.textOnAccent} name="add" size={16} />
      <Text style={styles.fabText}>{label}</Text>
    </Pressable>
  );
}

export function SkeletonCard() {
  return (
    <View style={skStyles.card}>
      <View style={[skStyles.line, { width: '60%', height: 16 }]} />
      <View style={[skStyles.line, { width: '35%', height: 12, marginTop: 8 }]} />
      <View style={skStyles.badgeRow}>
        <View style={[skStyles.badge, { width: 56 }]} />
        <View style={[skStyles.badge, { width: 48 }]} />
      </View>
    </View>
  );
}

export function EmptyState({
  icon,
  iconSize = 36,
  title,
  description,
  action,
}: {
  icon: string;
  iconSize?: number;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <View style={emStyles.container}>
      <View style={emStyles.iconWrap}>
        <Ionicons
          name={icon as keyof typeof Ionicons.glyphMap}
          size={iconSize}
          color={mobileTheme.colors.textSubtle}
        />
      </View>
      <Text style={emStyles.title}>{title}</Text>
      <Text style={emStyles.description}>{description}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  accentStrip: {
    flexDirection: 'row',
    height: 3,
    opacity: 0.6,
  },
  accentStripEnd: {
    backgroundColor: mobileTheme.colors.accentBarEnd,
    flex: 1,
  },
  accentStripStart: {
    backgroundColor: mobileTheme.colors.accent,
    flex: 1,
  },
  badge: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.2,
    textTransform: 'capitalize',
  },
  bgTopGlow: {
    backgroundColor: mobileTheme.colors.overlayLight,
    height: 34,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  card: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    padding: mobileTheme.spacing.lg,
    ...mobileTheme.shadow.card,
  },
  content: {
    flex: 1,
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  contentUnpadded: {
    paddingHorizontal: 0,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  eyebrow: {
    color: mobileTheme.colors.accent,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  fab: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    bottom: 20,
    flexDirection: 'row',
    gap: 8,
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingVertical: 14,
    position: 'absolute',
    right: 18,
    ...mobileTheme.shadow.fab,
  },
  fabText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 14,
    fontWeight: mobileTheme.font.black,
    letterSpacing: 0.2,
    position: 'relative',
    zIndex: 2,
  },
  fabToneLayer: {
    backgroundColor: mobileTheme.colors.accentDark,
    borderRadius: mobileTheme.radius.pill,
    bottom: 0,
    left: 0,
    opacity: 0.2,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    marginTop: mobileTheme.spacing.sm,
  },
  headerCopy: {
    flex: 1,
    paddingRight: mobileTheme.spacing.md,
  },
  screen: {
    backgroundColor: mobileTheme.colors.background,
    flex: 1,
  },
  sectionCount: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: 10,
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sectionHeader: {
    alignItems: 'center',
    borderLeftColor: mobileTheme.colors.accent,
    borderLeftWidth: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 14,
    paddingLeft: 4,
  },
  sectionTitle: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0.1,
  },
  segment: {
    borderRadius: mobileTheme.radius.pill,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  segmentActive: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: mobileTheme.radius.pill,
    ...mobileTheme.shadow.control,
  },
  segmented: {
    backgroundColor: mobileTheme.colors.backgroundDeep,
    borderRadius: mobileTheme.radius.pill,
    padding: 3,
  },
  segmentedInner: {
    gap: 4,
  },
  segmentText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    textTransform: 'capitalize',
  },
  segmentTextActive: {
    color: mobileTheme.colors.text,
    fontWeight: mobileTheme.font.extrabold,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 28,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.8,
    lineHeight: 32,
    marginTop: 2,
  },
});

const skStyles = StyleSheet.create({
  badge: {
    backgroundColor: mobileTheme.colors.backgroundDeep,
    borderRadius: mobileTheme.radius.pill,
    height: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  card: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    marginBottom: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.lg,
  },
  line: {
    backgroundColor: mobileTheme.colors.skeleton,
    borderRadius: mobileTheme.radius.sm,
  },
});

const emStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingVertical: mobileTheme.spacing.xl,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.xl,
    height: 64,
    justifyContent: 'center',
    marginBottom: 10,
    width: 64,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
  },
});
