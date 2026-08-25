import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { FloatingActionButton } from '@/components/mobile/ui/FloatingActionButton';
import { HeaderActions } from '@/components/mobile/ui/HeaderActions';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { mobileTheme } from '@/components/mobile/theme';
import { ProjectsListView } from '@/features/projects/components/ProjectsListView';

export default function ProjectsCompatScreen() {
  return (
    <AppScreen padded={false} testID="projects-compat-screen">
      <View style={styles.headerWrap}>
        <ScreenHeader
          eyebrow="Planning"
          title="Projects"
          description="The containers for your goals and tasks"
          rightSlot={<HeaderActions />}
        />
      </View>
      <View style={styles.body}>
        <ProjectsListView />
      </View>
      <FloatingActionButton label="New Project" onPress={() => router.push('/(app)/projects/create')} testID="projects-compat-fab" />
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
