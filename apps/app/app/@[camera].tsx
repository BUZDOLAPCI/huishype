import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import MapScreen from './(tabs)/index';

export default function CameraRouteScreen() {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.container} testID="camera-route-loading">
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      </>
    );
  }

  return <MapScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFBF5',
  },
});
