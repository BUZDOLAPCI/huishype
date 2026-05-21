import React from 'react';
import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="properties" />
      <Stack.Screen name="comments" />
      <Stack.Screen name="activity" />
      <Stack.Screen name="reports/[id]" />
    </Stack>
  );
}
