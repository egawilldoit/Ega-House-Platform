import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useBottomChromeMetrics } from '@/components/mobile/navigation/bottomChrome';
import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { HeaderActions } from '@/components/mobile/ui/HeaderActions';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { SkeletonCard } from '@/components/mobile/ui/Skeleton';
import { useTaskListQuery } from '@/features/tasks/query';
import { TimerScreenContent } from '@/features/timer/components/TimerScreenContent';
import {
  useStartTimerMutation,
  useStopTimerMutation,
  useTimerWorkspaceQuery,
} from '@/features/timer/query';

const MAX_PICKER_TASKS = 12;

function formatMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}

export default function TimerScreen() {
  const { contentBottomPaddingNoFab } = useBottomChromeMetrics();
  const workspaceQuery = useTimerWorkspaceQuery();
  const startMutation = useStartTimerMutation();
  const stopMutation = useStopTimerMutation();
  const tasksQuery = useTaskListQuery({ limit: 50 });

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const workspace = workspaceQuery.data ?? null;
  const activeSession = workspace?.activeSession ?? null;

  const candidateTasks = useMemo(
    () =>
      (tasksQuery.data?.tasks ?? [])
        .filter((task) => task.status !== 'done')
        .slice(0, MAX_PICKER_TASKS),
    [tasksQuery.data],
  );

  const summary = workspace?.summary ?? null;

  async function handleStart() {
    if (!selectedTaskId || activeSession) {
      return;
    }

    setActionError(null);

    try {
      await startMutation.mutateAsync(selectedTaskId);
    } catch (error) {
      setActionError(formatMessage(error, 'Unable to start the timer.'));
    }
  }

  async function handleStop() {
    if (!activeSession) {
      return;
    }

    setActionError(null);

    try {
      await stopMutation.mutateAsync(activeSession.sessionId);
    } catch (error) {
      setActionError(formatMessage(error, 'Unable to stop the timer.'));
    }
  }

  if (workspaceQuery.isPending && !workspace) {
    return (
      <AppScreen testID="timer-loading">
        <ScreenHeader
          eyebrow="Focus"
          title="Timer"
          description="Loading your timer..."
          rightSlot={<HeaderActions />}
        />
        <View style={styles.skeletonWrap}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </AppScreen>
    );
  }

  if (workspaceQuery.isError && !workspace) {
    const loadError =
      workspaceQuery.error instanceof Error ? workspaceQuery.error.message : 'Unable to load the timer right now.';

    return (
      <AppScreen testID="timer-error">
        <ScreenHeader
          eyebrow="Focus"
          title="Timer"
          description="Server unavailable"
          rightSlot={<HeaderActions />}
        />
        <Card style={styles.offlineCard} contentStyle={styles.offlineContent} testID="timer-offline-card">
          <Ionicons color={mobileTheme.colors.danger} name="cloud-offline-outline" size={20} />
          <Text style={styles.offlineText}>{loadError}</Text>
          <Text style={styles.offlineHint}>
            Nothing is running locally. The timer only runs on the server, so reconnect and retry.
          </Text>
          <Button
            title="Retry"
            variant="secondary"
            onPress={() => {
              workspaceQuery.refetch().catch(() => {
                // handled by query error state
              });
            }}
            testID="timer-retry"
          />
        </Card>
      </AppScreen>
    );
  }

  const showStaleBanner = workspaceQuery.isError && !workspaceQuery.isFetching;

  return (
    <AppScreen padded={false} testID="timer-screen">
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: contentBottomPaddingNoFab }]}
        refreshControl={
          <RefreshControl
            refreshing={workspaceQuery.isRefetching}
            onRefresh={() => {
              workspaceQuery.refetch().catch(() => {
                // handled by query error state
              });
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="Focus"
          title="Timer"
          description={activeSession ? 'Session running' : showStaleBanner ? 'Offline' : 'Ready when you are'}
          rightSlot={<HeaderActions />}
        />

        {showStaleBanner ? (
          <View style={styles.staleBanner} testID="timer-stale-banner">
            <Ionicons color={mobileTheme.colors.textMuted} name="cloud-offline-outline" size={14} />
            <Text style={styles.staleBannerText}>Can&apos;t reach the server — showing the last synced state.</Text>
          </View>
        ) : null}

        {actionError ? (
          <FeedbackBanner tone="danger" message={actionError} testID="timer-action-error" />
        ) : null}

        <TimerScreenContent
          activeSession={activeSession}
          candidateTasks={candidateTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          onStart={handleStart}
          onStop={handleStop}
          isStarting={startMutation.isPending}
          isStopping={stopMutation.isPending}
          summary={summary}
        />

        {tasksQuery.isFetching && !tasksQuery.data ? (
          <ActivityIndicator color={mobileTheme.colors.accent} style={styles.tasksLoading} testID="timer-tasks-loading" />
        ) : null}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: mobileTheme.spacing.md,
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  offlineCard: {
    borderColor: mobileTheme.colors.danger,
    marginTop: mobileTheme.spacing.md,
  },
  offlineContent: {
    alignItems: 'flex-start',
    gap: mobileTheme.spacing.sm,
  },
  offlineHint: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  offlineText: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.semibold,
  },
  skeletonWrap: {
    gap: mobileTheme.spacing.md,
    marginTop: mobileTheme.spacing.lg,
  },
  staleBanner: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.md,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 10,
  },
  staleBannerText: {
    color: mobileTheme.colors.textMuted,
    flex: 1,
    fontSize: 12,
    fontWeight: mobileTheme.font.semibold,
  },
  tasksLoading: {
    marginTop: mobileTheme.spacing.sm,
  },
});
