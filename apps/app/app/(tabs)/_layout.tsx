import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';

import { CustomTabBar } from '@/src/components/navigation/CustomTabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        // All system headers are disabled — each screen manages its own.
        headerShown: false,
        ...(Platform.OS === 'web'
          ? {
              sceneStyle: { backgroundColor: 'transparent' },
            }
          : {}),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
        }}
      />
    </Tabs>
  );
}
