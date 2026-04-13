import { Platform, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

export function WebMapRouteShell() {
  if (Platform.OS !== 'web') {
    return null;
  }

  return <View pointerEvents="none" style={styles.routeLayer} testID="web-map-route-shell" />;
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

const styles = StyleSheet.create({
  routeLayer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
