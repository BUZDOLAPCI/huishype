import React from 'react';
import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="language" />
      <Stack.Screen name="legal" />
      <Stack.Screen name="open-source-licenses" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="cookies" />
      <Stack.Screen name="data-privacy" />
      <Stack.Screen name="sharing-permissions" />
      <Stack.Screen name="contact" />
      <Stack.Screen name="help/index" />
      <Stack.Screen name="help/category/[slug]" />
      <Stack.Screen name="help/article/[slug]" />
      <Stack.Screen name="glossary/index" />
      <Stack.Screen name="glossary/[slug]" />
    </Stack>
  );
}
