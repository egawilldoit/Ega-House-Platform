import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppScreen, Button, Card, EmptyState, FeedbackBanner, SearchField } from '@/components/mobile/ui';
import { useBottomChromeMetrics } from '@/components/mobile/navigation/bottomChrome';
import { mobileTheme } from '@/components/mobile/theme';
import { useGoalListQuery } from '@/features/goals/query';
import { useProjectListQuery } from '@/features/projects/query';
import { searchWorkspace } from '@/features/search/search';
import { useTaskListQuery } from '@/features/tasks/query';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_TASK_LIMIT = 200;
// Search list tuning (Wave 10.11): ScrollView+map is bounded (max 200 tasks + active projects/goals, typically <60 results).
// Virtualization (FlatList) would add windowSize tuning + extra complexity for 3 heterogeneous sections;
// current unbounded 200 is truncated via SEARCH_TASK_LIMIT with warning banner (`Showing first 200 …`), so O(N) render
// is cheap and avoids VirtualizedList nesting issues. Kept as ScrollView; if results grew >200, virtualize.
// Debounce 250ms + useMemo(searchWorkspace) avoids re-score on every keystroke → no freeze during typing.

export default function SearchScreen() {
  const { contentBottomPaddingNoFab } = useBottomChromeMetrics();
  const [rawQuery, setRawQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(rawQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [rawQuery]);

  const tasksQuery = useTaskListQuery({ limit: SEARCH_TASK_LIMIT });
  const projectsQuery = useProjectListQuery('active');
  const goalsQuery = useGoalListQuery('active');

  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data?.tasks]);
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data?.projects]);
  const goals = useMemo(() => goalsQuery.data?.goals ?? [], [goalsQuery.data?.goals]);

  const results = useMemo(
    () => searchWorkspace({ query: debouncedQuery, tasks, projects, goals }),
    [debouncedQuery, tasks, projects, goals],
  );

  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;
  // Perceived performance (Wave 10.11): placeholderData keeps stale visible; skeleton only when no usable data.
  const hasAnyData = tasks.length > 0 || projects.length > 0 || goals.length > 0 || !!tasksQuery.data || !!projectsQuery.data || !!goalsQuery.data;
  const isInitialLoading =
    !hasAnyData && (tasksQuery.isPending || projectsQuery.isPending || goalsQuery.isPending);
  const isFetchingAny = tasksQuery.isFetching || projectsQuery.isFetching || goalsQuery.isFetching;
  const isLoading = isInitialLoading;
  const isRefreshing = isFetchingAny && hasAnyData && !isInitialLoading;
  const isError = tasksQuery.isError || projectsQuery.isError || goalsQuery.isError;
  const totalTaskCount = tasksQuery.data?.counters.total ?? 0;
  const isTruncated = totalTaskCount > tasks.length;
  const totalResults = results.tasks.length + results.projects.length + results.goals.length;

  const handleRetry = () => {
    if (tasksQuery.isError) {
      tasksQuery.refetch().catch(() => {});
    }

    if (projectsQuery.isError) {
      projectsQuery.refetch().catch(() => {});
    }

    if (goalsQuery.isError) {
      goalsQuery.refetch().catch(() => {});
    }
  };

  return (
    <AppScreen>
      <SearchField
        autoFocus
        onChangeText={setRawQuery}
        placeholder="Search tasks, projects, goals"
        value={rawQuery}
      />

      {isTruncated ? (
        <View style={styles.noticeWrap}>
          <FeedbackBanner
            message={`Showing first ${tasks.length} of ${totalTaskCount} tasks. Refine your query for more results.`}
            tone="warning"
          />
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.mutedText}>Loading workspace...</Text>
        </View>
      ) : null}

      {isRefreshing && hasAnyData ? <Text style={styles.refreshingHint}>Refreshing…</Text> : null}

      {isError && !isLoading && tasks.length === 0 && projects.length === 0 && goals.length === 0 ? (
        <Card style={styles.errorCard}>
          <View style={styles.errorCardContent}>
            <Ionicons color={mobileTheme.colors.danger} name="alert-circle-outline" size={20} />
            <Text style={styles.errorText}>Unable to load search data. Check your connection.</Text>
            <Button onPress={handleRetry} size="sm" title="Retry" />
          </View>
        </Card>
      ) : null}

      {!isLoading && !hasQuery ? (
        <View style={styles.centered}>
          <EmptyState
            description="Search across tasks, projects, and goals. Results update as you type."
            icon="search-outline"
            title="Find anything"
          />
        </View>
      ) : null}

      {!isLoading && hasQuery && totalResults === 0 ? (
        <View style={styles.centered}>
          <EmptyState
            description={`No results for "${trimmedQuery}". Try a different keyword.`}
            icon="search-outline"
            title="No matches"
          />
        </View>
      ) : null}

      {!isLoading && hasQuery && totalResults > 0 ? (
        <ScrollView
          // Not virtualized: bounded 200 + active sets; see note above. Truncation banner handles overflow.
          contentContainerStyle={[styles.resultsContent, { paddingBottom: contentBottomPaddingNoFab }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.resultsHeader}>
            <Text style={styles.resultsCount}>
              {totalResults} result{totalResults === 1 ? '' : 's'} for &ldquo;{trimmedQuery}&rdquo;
            </Text>
            {isError ? (
              <Text style={styles.partialErrorText}>Some sections may be incomplete.</Text>
            ) : null}
          </View>

          {results.tasks.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons color={mobileTheme.colors.accent} name="checkbox-outline" size={16} />
                <Text style={styles.sectionTitle}>Tasks</Text>
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{results.tasks.length}</Text>
                </View>
              </View>
              <View style={styles.sectionGroup}>
                {results.tasks.map((task, idx) => (
                  <Pressable
                    accessibilityLabel={`Open task ${task.title}`}
                    accessibilityRole="button"
                    key={task.id}
                    onPress={() => {
                      router.push({ pathname: '/(app)/tasks/[id]', params: { id: task.id } });
                    }}
                    style={({ pressed }) => [
                      styles.resultRow,
                      idx < results.tasks.length - 1 ? styles.resultRowBorder : null,
                      pressed ? styles.resultRowPressed : null,
                    ]}
                  >
                    <View style={styles.resultCopy}>
                      <Text numberOfLines={1} style={styles.resultTitle}>
                        {task.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.resultMeta}>
                        {task.project.name}
                        {task.goal ? ` · ${task.goal.title}` : ''} · {task.status}
                      </Text>
                      {task.description ? (
                        <Text numberOfLines={1} style={styles.resultDescription}>
                          {task.description}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons color={mobileTheme.colors.textSubtle} name="chevron-forward" size={16} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {results.projects.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons color={mobileTheme.colors.info} name="folder-outline" size={16} />
                <Text style={styles.sectionTitle}>Projects</Text>
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{results.projects.length}</Text>
                </View>
              </View>
              <View style={styles.sectionGroup}>
                {results.projects.map((project, idx) => (
                  <Pressable
                    accessibilityLabel={`Open project ${project.name}`}
                    accessibilityRole="button"
                    key={project.id}
                    onPress={() => {
                      router.push({ pathname: '/(app)/projects/[slug]', params: { slug: project.slug } });
                    }}
                    style={({ pressed }) => [
                      styles.resultRow,
                      idx < results.projects.length - 1 ? styles.resultRowBorder : null,
                      pressed ? styles.resultRowPressed : null,
                    ]}
                  >
                    <View style={styles.resultCopy}>
                      <Text numberOfLines={1} style={styles.resultTitle}>
                        {project.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.resultMeta}>
                        {project.slug} · {project.status}
                      </Text>
                    </View>
                    <Ionicons color={mobileTheme.colors.textSubtle} name="chevron-forward" size={16} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {results.goals.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons color={mobileTheme.colors.success} name="trophy-outline" size={16} />
                <Text style={styles.sectionTitle}>Goals</Text>
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{results.goals.length}</Text>
                </View>
              </View>
              <View style={styles.sectionGroup}>
                {results.goals.map((goal, idx) => (
                  <Pressable
                    accessibilityLabel={`Open goal ${goal.title}`}
                    accessibilityRole="button"
                    key={goal.id}
                    onPress={() => {
                      router.push({ pathname: '/(app)/goals/[id]', params: { id: goal.id } });
                    }}
                    style={({ pressed }) => [
                      styles.resultRow,
                      idx < results.goals.length - 1 ? styles.resultRowBorder : null,
                      pressed ? styles.resultRowPressed : null,
                    ]}
                  >
                    <View style={styles.resultCopy}>
                      <Text numberOfLines={1} style={styles.resultTitle}>
                        {goal.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.resultMeta}>
                        {goal.projectName ? `${goal.projectName} · ` : ''}
                        {goal.status}
                      </Text>
                    </View>
                    <Ionicons color={mobileTheme.colors.textSubtle} name="chevron-forward" size={16} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    gap: mobileTheme.spacing.sm,
    paddingTop: mobileTheme.spacing.xl,
  },
  countPill: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accentSoft,
    borderRadius: mobileTheme.radius.pill,
    justifyContent: 'center',
    minWidth: 22,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  countPillText: {
    color: mobileTheme.colors.accentDark,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
  },
  errorCard: {
    marginTop: mobileTheme.spacing.md,
  },
  errorCardContent: {
    alignItems: 'center',
    gap: mobileTheme.spacing.sm,
  },
  errorText: {
    color: mobileTheme.colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  mutedText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
  },
  refreshingHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
  noticeWrap: {
    marginTop: mobileTheme.spacing.sm,
  },
  partialErrorText: {
    color: mobileTheme.colors.danger,
    fontSize: 11,
    marginTop: 4,
  },
  resultCopy: {
    flex: 1,
    gap: 2,
  },
  resultDescription: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
  },
  resultMeta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
  },
  resultRow: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceLow,
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    minHeight: 56,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: 10,
  },
  resultRowBorder: {
    borderBottomColor: mobileTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultRowPressed: {
    backgroundColor: mobileTheme.colors.surfaceMid,
  },
  resultTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
  },
  resultsContent: {
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingTop: mobileTheme.spacing.md,
  },
  resultsCount: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
    textTransform: 'uppercase',
  },
  resultsHeader: {
    marginBottom: mobileTheme.spacing.sm,
  },
  section: {
    marginTop: mobileTheme.spacing.md,
  },
  sectionGroup: {
    backgroundColor: mobileTheme.colors.surfaceLow,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: mobileTheme.spacing.sm,
    overflow: 'hidden',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  sectionTitle: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: mobileTheme.font.extrabold,
  },
});
