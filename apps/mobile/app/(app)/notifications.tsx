import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { EmptyState } from '@/components/mobile/ui/EmptyState';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { useMarkAllReadMutation, useMarkOpenedMutation, useNotificationsQuery } from '@/features/notifications/query';
import { notificationTargetToRoute } from '@/lib/notifications/target';

function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

export default function NotificationsScreen() {
  const router = useRouter();
  const query = useNotificationsQuery();
  const markOpened = useMarkOpenedMutation();
  const markAll = useMarkAllReadMutation();

  const notifications = useMemo(() => query.data?.notifications ?? [], [query.data]);

  const sections = useMemo(() => {
    const today: typeof notifications = [];
    const earlier: typeof notifications = [];
    for (const n of notifications) {
      if (isToday(n.createdAt)) today.push(n);
      else earlier.push(n);
    }
    const result: Array<{ title: string; data: typeof notifications }> = [];
    if (today.length > 0) result.push({ title: 'Today', data: today });
    if (earlier.length > 0) result.push({ title: 'Earlier', data: earlier });
    if (result.length === 0 && notifications.length > 0) result.push({ title: 'All', data: notifications });
    return result;
  }, [notifications]);

  const hasUnread = notifications.some((n) => !n.readAt);

  const onPressItem = useCallback(
    async (item: (typeof notifications)[number]) => {
      try {
        await markOpened.mutateAsync(item.id);
      } catch {
        // ignore
      }
      const target = item.target;
      const route = notificationTargetToRoute(target ? { type: target.type, id: target.id } : null);
      router.push(route.href as never);
    },
    [markOpened, router],
  );

  const onMarkAll = useCallback(async () => {
    try {
      await markAll.mutateAsync();
    } catch {
      // ignore
    }
  }, [markAll]);

  if (query.isPending) {
    return (
      <AppScreen>
        <View style={styles.centered}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.subtitle}>Loading notifications…</Text>
        </View>
      </AppScreen>
    );
  }

  if (query.isError) {
    return (
      <AppScreen>
        <View style={styles.centered}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.errorText}>Unable to load notifications.</Text>
          <Button onPress={() => query.refetch()} title="Retry" />
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen padded={false} testID="notifications-screen">
      <View style={styles.pagePadding}>
        <ScreenHeader
          eyebrow="Inbox"
          title="Notifications"
          description={notifications.length === 0 ? 'No notifications yet' : `${notifications.length} notification${notifications.length === 1 ? '' : 's'}`}
          rightSlot={hasUnread ? <Button onPress={onMarkAll} size="sm" title="Mark all read" variant="secondary" /> : undefined}
        />
      </View>

      {notifications.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Card>
            <EmptyState
              icon="notifications-outline"
              title="No notifications yet"
              description="Task reminders will appear here."
            />
          </Card>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const unread = !item.readAt;
            return (
              <Pressable
                accessibilityHint="Opens the related item"
                accessibilityLabel={`${unread ? 'Open unread notification' : 'Open notification'}: ${item.title}`}
                accessibilityRole="button"
                onPress={() => onPressItem(item)}
                style={({ pressed }) => [styles.item, pressed ? styles.itemPressed : null, unread ? styles.itemUnread : null]}
              >
                <View style={styles.itemIcon}>
                  <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={18} color={unread ? mobileTheme.colors.accent : mobileTheme.colors.textMuted} />
                  {unread ? <View style={styles.unreadDot} /> : null}
                </View>
                <View style={styles.itemBody}>
                  <Text style={[styles.itemTitle, unread ? styles.itemTitleUnread : null]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.body ? (
                    <Text style={styles.itemText} numberOfLines={2}>
                      {item.body}
                    </Text>
                  ) : null}
                  <Text style={styles.itemTime}>{relativeTime(item.createdAt)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={mobileTheme.colors.textSubtle} />
              </Pressable>
            );
          }}
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  pagePadding: { paddingHorizontal: mobileTheme.spacing.lg, paddingTop: mobileTheme.spacing.sm },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: mobileTheme.font.bold as never, color: mobileTheme.colors.text },
  subtitle: { color: mobileTheme.colors.textMuted, fontSize: 13, marginTop: 8 },
  errorText: { color: mobileTheme.colors.danger, fontSize: 13, textAlign: 'center' },
  listContent: { paddingBottom: mobileTheme.layout.floatingTabClearance, paddingHorizontal: mobileTheme.spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, backgroundColor: mobileTheme.colors.background },
  sectionTitle: { fontSize: 13, fontWeight: mobileTheme.font.semibold as never, color: mobileTheme.colors.textMuted, textTransform: 'uppercase' },
  sectionCount: { fontSize: 12, color: mobileTheme.colors.textSubtle, backgroundColor: mobileTheme.colors.surface, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: mobileTheme.colors.surface, borderRadius: mobileTheme.radius.card, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: mobileTheme.colors.border },
  itemUnread: { borderColor: mobileTheme.colors.accentMid, backgroundColor: '#f0f6ff' },
  itemPressed: { opacity: 0.7 },
  itemIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: mobileTheme.colors.surfaceMuted, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  unreadDot: { position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: mobileTheme.colors.accent, borderWidth: 2, borderColor: mobileTheme.colors.surface },
  itemBody: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 14, fontWeight: mobileTheme.font.semibold as never, color: mobileTheme.colors.text },
  itemTitleUnread: { fontWeight: mobileTheme.font.bold as never },
  itemText: { fontSize: 13, color: mobileTheme.colors.textSecondary, lineHeight: 18 },
  itemTime: { fontSize: 11, color: mobileTheme.colors.textSubtle, marginTop: 2 },
  emptyWrap: { flex: 1, padding: mobileTheme.spacing.lg },
});
