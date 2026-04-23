import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { type ComponentProps } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function TabIcon({ name, color, focused }: { name: IconName; color: string; focused: boolean }) {
  return (
    <View style={[tabStyles.iconWrap, focused ? tabStyles.iconWrapActive : null]}>
      <Ionicons name={name} size={22} color={color} />
    </View>
  );
}

export default function AppTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: mobileTheme.colors.accent,
        tabBarInactiveTintColor: mobileTheme.colors.textSubtle,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: mobileTheme.font.bold,
          letterSpacing: 0.3,
          marginBottom: Platform.OS === 'ios' ? 0 : 6,
        },
        tabBarStyle: {
          backgroundColor: mobileTheme.colors.overlayLight,
          borderTopWidth: 1,
          borderTopColor: mobileTheme.colors.border,
          height: Platform.OS === 'ios' ? 82 : 68,
          paddingTop: 6,
          paddingBottom: Platform.OS === 'ios' ? 22 : 10,
        },
        tabBarBackground: () => (
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor:
                  Platform.OS === 'ios'
                    ? mobileTheme.colors.tabBarBgIos
                    : mobileTheme.colors.tabBarBgAndroid,
              },
            ]}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'sunny' : 'sunny-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? 'checkbox' : 'checkbox-outline'}
              color={color}
              focused={focused}
            />
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
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? 'person-circle' : 'person-circle-outline'}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    marginBottom: 2,
    width: 40,
  },
  iconWrapActive: {
    backgroundColor: mobileTheme.colors.accentSoft,
  },
});
