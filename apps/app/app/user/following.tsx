import React from 'react';
import { Stack } from 'expo-router';

import { OwnFollowListScreen } from '@/src/screens/OwnFollowListScreen';

export default function FollowingScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <OwnFollowListScreen kind="following" />
    </>
  );
}
