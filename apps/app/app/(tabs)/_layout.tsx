import React from 'react';
import { Tabs } from 'expo-router';

import { CustomTabBar } from '@/src/components/navigation/CustomTabBar';
import { useT } from '@/src/i18n';
import { PropertyFilterProvider } from '@/src/providers/PropertyFilterProvider';

export default function TabLayout() {
  const t = useT();

  return (
    <PropertyFilterProvider>
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
          title: t('tabs.map'),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: t('tabs.feed'),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: t('tabs.saved'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
        }}
      />
      <Tabs.Screen
        name="@[camera]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="[...address]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="map/index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="map/[...address]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="map/[city]/[postcode]/[street]/[house]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="map/[country]/[city]/[postcode]/[street]/[house]"
        options={{
          href: null,
        }}
      />
      </Tabs>
    </PropertyFilterProvider>
  );
}
