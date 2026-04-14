import { Platform } from 'react-native';
import { Stack } from 'expo-router';

export function WebMapRouteShell() {
  if (Platform.OS !== 'web') {
    return null;
  }

  return null;
}

export function WebMapStackRouteShell() {
  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
      <WebMapRouteShell />
    </>
  );
}
