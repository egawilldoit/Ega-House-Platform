import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { FloatingActionButton } from '@/components/mobile/ui/FloatingActionButton';
import { HeaderActions } from '@/components/mobile/ui/HeaderActions';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { mobileTheme } from '@/components/mobile/theme';
import { GoalsListView } from '@/features/goals/components/GoalsListView';

export default function GoalsScreen() {
  return (
    <AppScreen padded={false} testID="goals-screen">
      <View style={styles.headerWrap}>
        <ScreenHeader
          eyebrow="Planning"
          title="Goals"
          description="Outcomes with a health signal and a next step"
          rightSlot={<HeaderActions />}
        />
      </View>

      <View style={styles.body}>
        <GoalsListView />
      </View>

      <FloatingActionButton
        label="New Goal"
        onPress={() => router.push('/(app)/goals/create')}
        testID="goals-fab"
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
