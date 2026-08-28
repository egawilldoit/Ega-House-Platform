import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomNavigation } from '@/components/mobile/ui/BottomNavigation';
import { mobileTheme } from '@/components/mobile/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function TabIcon({ name, color, focused }: { name: IconName; color: string; focused: boolean }) {
  return (
    <View style={tabStyles.iconWrap}>
      <Ionicons name={name} size={focused ? 23 : 21} color={color} />
    </View>
  );
}

export default function AppTabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomNavigation {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: mobileTheme.colors.accent,
        tabBarInactiveTintColor: mobileTheme.colors.textSubtle,
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="sunny-outline" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: 'Work',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? 'briefcase' : 'briefcase-outline'}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'Goals',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'flag' : 'flag-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="timer"
        options={{
          title: 'Timer',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'timer' : 'timer-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'mail' : 'mail-outline'} color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    marginBottom: 2,
    width: 40,
  },
});
