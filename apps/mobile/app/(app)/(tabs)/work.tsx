import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { HeaderActions } from '@/components/mobile/ui/HeaderActions';
import { Card } from '@/components/mobile/ui/Card';
import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';
import { FloatingActionButton } from '@/components/mobile/ui/FloatingActionButton';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { mobileTheme } from '@/components/mobile/theme';
import { useTaskListQuery } from '@/features/tasks/query';
import { useProjectListQuery } from '@/features/projects/query';

type WorkMode = 'tasks' | 'projects';

export default function WorkScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const initialMode: WorkMode = params.mode === 'projects' ? 'projects' : 'tasks';
  const [mode, setMode] = useState<WorkMode>(initialMode);

  useEffect(() => {
    if (params.mode === 'projects' || params.mode === 'tasks') {
      setMode(params.mode);
    }
  }, [params.mode]);

  const tasksQuery = useTaskListQuery({ limit: 20 });
  const projectsQuery = useProjectListQuery('active');

  const tasks = tasksQuery.data?.tasks ?? [];
  const projects = projectsQuery.data?.projects ?? [];

  const taskSummary = useMemo(() => {
    const total = tasksQuery.data?.counters.total ?? tasks.length;
    return { visible: tasks.length, total };
  }, [tasks.length, tasksQuery.data]);

  const projectSummary = useMemo(() => {
    return { visible: projects.length };
  }, [projects.length]);

  const isLoading = mode === 'tasks' ? tasksQuery.isPending : projectsQuery.isPending;
  const isRefreshing = mode === 'tasks' ? tasksQuery.isRefetching : projectsQuery.isFetching;

  const onRefresh = () => {
    if (mode === 'tasks') tasksQuery.refetch().catch(() => {});
    else projectsQuery.refetch().catch(() => {});
  };

  return (
    <AppScreen padded={false} testID="work-screen">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerWrap}>
          <ScreenHeader
            eyebrow="Execution"
            title="Work"
            description={mode === 'tasks' ? 'Tasks and projects in one place' : 'Projects group your goals and tasks'}
            rightSlot={<HeaderActions />}
          />

          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as WorkMode)}
            options={[
              { label: 'Tasks', value: 'tasks' },
              { label: 'Projects', value: 'projects' },
            ]}
          />

          <View style={styles.summaryRow}>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{mode === 'tasks' ? taskSummary.visible : projectSummary.visible}</Text>
              <Text style={styles.summaryLabel}>{mode === 'tasks' ? 'Tasks shown' : 'Projects shown'}</Text>
              {mode === 'tasks' ? <Text style={styles.summaryMeta}>{taskSummary.total} total · first 20</Text> : null}
            </Card>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{mode === 'tasks' ? '↗' : '◯'}</Text>
              <Text style={styles.summaryLabel}>{mode === 'tasks' ? 'Open work' : 'Active focus'}</Text>
              <Text style={styles.summaryMeta}>{mode === 'tasks' ? 'Switch to Projects →' : 'Switch to Tasks →'}</Text>
            </Card>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={mobileTheme.colors.accent} />
            <Text style={styles.loadingText}>Loading {mode}…</Text>
          </View>
        ) : mode === 'tasks' ? (
          <View style={styles.listWrap}>
            {tasks.length === 0 ? (
              <Card>
                <Text style={styles.emptyTitle}>No tasks yet</Text>
                <Text style={styles.emptyDescription}>Capture the next execution step.</Text>
                <Button title="Create task" onPress={() => router.push('/(app)/tasks/create')} style={styles.emptyAction} />
              </Card>
            ) : (
              tasks.slice(0, 8).map((task) => (
                <Card key={task.id} style={styles.rowCard} accentColor={mobileTheme.colors.border}>
                  <Text numberOfLines={1} style={styles.rowTitle}>
                    {task.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    {task.project.name} · {task.status.replaceAll('_', ' ')} · {task.priority}
                  </Text>
                </Card>
              ))
            )}
            {tasks.length > 8 ? (
              <Button
                title={`View all ${taskSummary.total} tasks`}
                variant="secondary"
                onPress={() => router.push('/(app)/(tabs)/tasks')}
                style={styles.viewAll}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.listWrap}>
            {projects.length === 0 ? (
              <Card>
                <Text style={styles.emptyTitle}>No projects yet</Text>
                <Text style={styles.emptyDescription}>Group goals and tasks under a shared outcome.</Text>
                <Button
                  title="Create project"
                  onPress={() => router.push('/(app)/projects/create')}
                  style={styles.emptyAction}
                />
              </Card>
            ) : (
              projects.slice(0, 8).map((project) => (
                <Card key={project.id} style={styles.rowCard} accentColor={mobileTheme.colors.border}>
                  <Text numberOfLines={1} style={styles.rowTitle}>
                    {project.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    {project.slug} · {project.status.replaceAll('_', ' ')} · {project.taskCount} tasks
                  </Text>
                </Card>
              ))
            )}
            {projects.length > 8 ? (
              <Button
                title="View all projects"
                variant="secondary"
                onPress={() => router.push('/(app)/(tabs)/projects')}
                style={styles.viewAll}
              />
            ) : null}
          </View>
        )}

        <View style={styles.compatHint}>
          <Text style={styles.compatText}>Compat routes remain: /(app)/(tabs)/tasks and /projects (hidden, deep-linkable).</Text>
        </View>
      </ScrollView>

      <FloatingActionButton
        label={mode === 'tasks' ? 'New Task' : 'New Project'}
        onPress={() => {
          if (mode === 'tasks') router.push('/(app)/tasks/create');
          else router.push('/(app)/projects/create');
        }}
        testID="work-fab"
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  compatHint: {
    marginTop: mobileTheme.spacing.md,
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  compatText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    textAlign: 'center',
  },
  content: {
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingTop: mobileTheme.spacing.sm,
  },
  emptyAction: {
    marginTop: mobileTheme.spacing.md,
  },
  emptyDescription: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  emptyTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
  },
  headerWrap: {
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  listWrap: {
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
    paddingHorizontal: mobileTheme.spacing.lg,
  },
  loadingText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 8,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingTop: mobileTheme.spacing.xl,
  },
  rowCard: {
    padding: 12,
  },
  rowMeta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  rowTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
  },
  summaryCard: {
    flex: 1,
    padding: 12,
  },
  summaryLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: mobileTheme.font.bold,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  summaryMeta: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  summaryValue: {
    color: mobileTheme.colors.text,
    fontSize: 20,
    fontWeight: mobileTheme.font.black,
  },
  viewAll: {
    marginTop: mobileTheme.spacing.sm,
  },
});
