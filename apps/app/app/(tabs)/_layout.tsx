import React from 'react';
import { Tabs } from 'expo-router';

import { CustomTabBar } from '@/src/components/navigation/CustomTabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        // All system headers are disabled — each screen manages its own.
        headerShown: false,
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
      <Tabs.Screen
        name="map/index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="(map-state)/@[camera]"
        options={{
          href: null,
          sceneStyle: { zIndex: -1 },
        }}
      />
      <Tabs.Screen
        name="map/[...address]"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
