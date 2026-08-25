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
import { mobileTheme } from '@/components/mobile/theme';
import { useGoalListQuery } from '@/features/goals/query';
import { useProjectListQuery } from '@/features/projects/query';
import { searchWorkspace } from '@/features/search/search';
import { useTaskListQuery } from '@/features/tasks/query';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_TASK_LIMIT = 200;

export default function SearchScreen() {
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

  const tasks = tasksQuery.data?.tasks ?? [];
  const projects = projectsQuery.data?.projects ?? [];
  const goals = goalsQuery.data?.goals ?? [];

  const results = useMemo(
    () => searchWorkspace({ query: debouncedQuery, tasks, projects, goals }),
    [debouncedQuery, tasks, projects, goals],
  );

  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;
  const isLoading = tasksQuery.isPending || projectsQuery.isPending || goalsQuery.isPending;
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
          contentContainerStyle={styles.resultsContent}
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
              {results.tasks.map((task) => (
                <Pressable
                  accessibilityLabel={`Open task ${task.title}`}
                  accessibilityRole="button"
                  key={task.id}
                  onPress={() => {
                    router.push({ pathname: '/(app)/tasks/[id]', params: { id: task.id } });
                  }}
                  style={({ pressed }) => [styles.resultRow, pressed ? styles.resultRowPressed : null]}
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
              {results.projects.map((project) => (
                <Pressable
                  accessibilityLabel={`Open project ${project.name}`}
                  accessibilityRole="button"
                  key={project.id}
                  onPress={() => {
                    router.push({ pathname: '/(app)/projects/[slug]', params: { slug: project.slug } });
                  }}
                  style={({ pressed }) => [styles.resultRow, pressed ? styles.resultRowPressed : null]}
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
              {results.goals.map((goal) => (
                <Pressable
                  accessibilityLabel={`Open goal ${goal.title}`}
                  accessibilityRole="button"
                  key={goal.id}
                  onPress={() => {
                    router.push({ pathname: '/(app)/goals/[id]', params: { id: goal.id } });
                  }}
                  style={({ pressed }) => [styles.resultRow, pressed ? styles.resultRowPressed : null]}
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
    backgroundColor: mobileTheme.colors.surface,
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.sm,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...mobileTheme.shadow.card,
  },
  resultRowPressed: {
    opacity: 0.7,
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
