import React from 'react';
import { Stack } from 'expo-router';

import { OwnFollowListScreen } from '@/src/screens/OwnFollowListScreen';

export default function FollowersScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <OwnFollowListScreen kind="followers" />
    </>
  );
}
