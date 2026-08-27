import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { EmptyState } from '@/components/mobile/ui/EmptyState';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { mobileTheme } from '@/components/mobile/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <AppScreen testID="not-found-screen">
        <ScreenHeader
          eyebrow="404"
          title="Not found"
          description="This screen does not exist or was moved."
        />
        <Card style={styles.card}>
          <EmptyState
            icon="alert-circle-outline"
            title="This screen does not exist."
            description="Check the URL or return to your workspace. All your tasks, projects, and goals are still safe."
            action={
              <Link href="/(app)/(tabs)/today" asChild>
                <Button title="Go to home screen" testID="not-found-home" />
              </Link>
            }
          />
        </Card>
        <View style={styles.footer}>
          <Link href="/" style={styles.link}>
            <Text style={styles.linkText}>Go to home screen!</Text>
          </Link>
        </View>
      </AppScreen>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: mobileTheme.spacing.md,
  },
  footer: {
    alignItems: 'center',
    marginTop: mobileTheme.spacing.lg,
  },
  link: {
    marginTop: mobileTheme.spacing.sm,
    minHeight: mobileTheme.layout.minTouchTarget,
    justifyContent: 'center',
    paddingVertical: mobileTheme.spacing.sm,
  },
  linkText: {
    color: mobileTheme.colors.accent,
    fontSize: 14,
    fontWeight: mobileTheme.font.semibold,
    textAlign: 'center',
  },
});
