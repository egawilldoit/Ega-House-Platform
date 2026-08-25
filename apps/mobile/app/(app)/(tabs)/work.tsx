import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HeaderActions } from '@/components/mobile/ui/HeaderActions';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { FloatingActionButton } from '@/components/mobile/ui/FloatingActionButton';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { mobileTheme } from '@/components/mobile/theme';
import { TasksListView } from '@/features/tasks/components/TasksListView';
import { ProjectsListView } from '@/features/projects/components/ProjectsListView';
import { WorkModeSelector, type WorkMode } from '@/features/work/WorkModeSelector';

export default function WorkScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const initialMode: WorkMode = params.mode === 'projects' ? 'projects' : 'tasks';
  const [mode, setMode] = useState<WorkMode>(initialMode);

  useEffect(() => {
    if (params.mode === 'projects' || params.mode === 'tasks') {
      setMode(params.mode);
    }
  }, [params.mode]);

  return (
    <AppScreen padded={false} testID="work-screen">
      <View style={styles.headerWrap}>
        <ScreenHeader
          eyebrow="Execution"
          title="Work"
          description={mode === 'tasks' ? 'Tasks and projects in one place' : 'Projects group your goals and tasks'}
          rightSlot={<HeaderActions />}
        />
        <WorkModeSelector value={mode} onChange={setMode} />
      </View>

      <View style={styles.body}>{mode === 'tasks' ? <TasksListView /> : <ProjectsListView />}</View>

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
  body: {
    flex: 1,
  },
  headerWrap: {
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
});
