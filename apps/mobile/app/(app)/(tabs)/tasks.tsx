import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { FloatingActionButton } from '@/components/mobile/ui/FloatingActionButton';
import { HeaderActions } from '@/components/mobile/ui/HeaderActions';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { mobileTheme } from '@/components/mobile/theme';
import { TasksListView } from '@/features/tasks/components/TasksListView';

export default function TasksCompatScreen() {
  return (
    <AppScreen padded={false} testID="tasks-compat-screen">
      <View style={styles.headerWrap}>
        <ScreenHeader
          eyebrow="Execution"
          title="Tasks"
          description="Everything synced from your workspace"
          rightSlot={<HeaderActions />}
        />
      </View>
      <View style={styles.body}>
        <TasksListView />
      </View>
      <FloatingActionButton label="New Task" onPress={() => router.push('/(app)/tasks/create')} testID="tasks-compat-fab" />
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
