import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import MapScreen from '@/app/(tabs)/index';

export function MapPreviewRouteShell({
  pathnameOverride,
}: {
  pathnameOverride: string;
}) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.container} testID="map-preview-route-loading">
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      </>
    );
  }

  return <MapScreen pathnameOverride={pathnameOverride} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFBF5',
  },
});
