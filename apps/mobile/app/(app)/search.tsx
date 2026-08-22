import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EmptyState, MobileScreen } from '@/components/mobile/primitives';
import { GlassButton, GlassCard, GlassInput, GlassPill } from '@/components/mobile/glass';
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

  // The bounded search set is small (<=200 tasks plus project/goal lists), so
  // direct pure computation is clearer than memoizing unstable fallback arrays.
  const results = searchWorkspace({ query: debouncedQuery, tasks, projects, goals });

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
    <MobileScreen>
      <GlassInput
        accessibilityLabel="Search tasks, projects, and goals"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        clearButtonMode="while-editing"
        onChangeText={setRawQuery}
        placeholder="Search tasks, projects, goals"
        returnKeyType="search"
        value={rawQuery}
        leftIcon={<Ionicons color={mobileTheme.colors.textSubtle} name="search" size={16} />}
        rightIcon={
          rawQuery.length > 0 ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setRawQuery('')}
              style={styles.clearButton}
            >
              <Ionicons color={mobileTheme.colors.textMuted} name="close-circle" size={18} />
            </Pressable>
          ) : undefined
        }
      />

      {isTruncated ? (
        <GlassCard variant="fake" style={styles.noticeCard}>
          <View style={styles.noticeRow}>
            <Ionicons color={mobileTheme.colors.warning} name="warning-outline" size={16} />
            <Text style={styles.noticeText}>
              Showing first {tasks.length} of {totalTaskCount} tasks. Refine your query for more
              results.
            </Text>
          </View>
        </GlassCard>
      ) : null}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.mutedText}>Loading workspace...</Text>
        </View>
      ) : null}

      {isError && !isLoading && tasks.length === 0 && projects.length === 0 && goals.length === 0 ? (
        <GlassCard variant="fake" style={styles.errorCard}>
          <Ionicons color={mobileTheme.colors.danger} name="alert-circle-outline" size={20} />
          <Text style={styles.errorText}>Unable to load search data. Check your connection.</Text>
          <GlassButton onPress={handleRetry} size="sm" title="Retry" />
        </GlassCard>
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
                <GlassPill label={`${results.tasks.length}`} tone="primary" />
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
                <GlassPill label={`${results.projects.length}`} tone="primary" />
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
                <GlassPill label={`${results.goals.length}`} tone="primary" />
              </View>
              {results.goals.map((goal) => (
                <Pressable
                  accessibilityLabel={`Open goals tab for ${goal.title}`}
                  accessibilityRole="button"
                  key={goal.id}
                  onPress={() => {
                    router.push('/(app)/(tabs)/goals');
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
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    gap: mobileTheme.spacing.sm,
    paddingTop: mobileTheme.spacing.xl,
  },
  clearButton: {
    padding: 4,
  },
  errorCard: {
    alignItems: 'center',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
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
  noticeCard: {
    marginTop: mobileTheme.spacing.sm,
  },
  noticeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  noticeText: {
    color: mobileTheme.colors.textMuted,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
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
    borderColor: mobileTheme.glass.border,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.sm,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
