import FontAwesome from '@expo/vector-icons/FontAwesome';
import { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
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
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function InfoBadge({
  label,
  backgroundColor,
  textColor,
}: {
  label: string;
  backgroundColor: string;
  textColor: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor }]}>
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
      <FontAwesome color="#ffffff" name="plus" size={14} />
      <Text style={styles.fabText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: mobileTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  card: {
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    padding: mobileTheme.spacing.md,
  },
  content: {
    flex: 1,
    paddingHorizontal: mobileTheme.spacing.md,
  },
  contentUnpadded: {
    paddingHorizontal: 0,
  },
  description: {
    color: mobileTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  eyebrow: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  fab: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    bottom: 16,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'absolute',
    right: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
  },
  fabText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: mobileTheme.spacing.md,
  },
  headerCopy: {
    flex: 1,
    paddingRight: 12,
  },
  screen: {
    backgroundColor: mobileTheme.colors.background,
    flex: 1,
  },
  sectionCount: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 8,
  },
  sectionTitle: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  segment: {
    borderRadius: mobileTheme.radius.control,
    minHeight: 38,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: '#ffffff',
  },
  segmented: {
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.control,
    padding: 4,
  },
  segmentedInner: {
    gap: 4,
  },
  segmentText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  segmentTextActive: {
    color: mobileTheme.colors.text,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 31,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 36,
    marginTop: 4,
  },
});
