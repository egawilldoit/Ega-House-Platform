import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';

export default function ProtectedLayout() {
  const { isAuthenticated, isReady } = useAuth();

  if (!isReady) {
    return (
      <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(public)/welcome" />;
  }

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="tasks/index" options={{ headerShown: false }} />
      <Stack.Screen name="projects/index" options={{ headerShown: false }} />
      <Stack.Screen
        name="tasks/create"
        options={{
          headerShown: true,
          presentation: 'modal',
          title: 'Create Task',
        }}
      />
      <Stack.Screen
        name="projects/create"
        options={{
          headerShown: true,
          presentation: 'modal',
          title: 'Create Project',
        }}
      />
      <Stack.Screen
        name="projects/[slug]"
        options={{
          headerShown: true,
          title: 'Project',
        }}
      />
      <Stack.Screen
        name="goals/[id]"
        options={{
          headerShown: true,
          title: 'Goal',
        }}
      />
      <Stack.Screen
        name="goals/create"
        options={{
          headerShown: true,
          presentation: 'modal',
          title: 'Create Goal',
        }}
      />
      <Stack.Screen
        name="search"
        options={{
          headerShown: true,
          title: 'Search',
        }}
      />
      <Stack.Screen
        name="profile"
        options={{
          headerShown: true,
          title: 'Profile',
        }}
      />
      <Stack.Screen
        name="tasks/[id]"
        options={{
          headerShown: true,
          title: 'Task',
        }}
      />
    </Stack>
  );
}
