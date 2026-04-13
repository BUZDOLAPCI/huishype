import { Platform } from 'react-native';

import MapScreen from './(tabs)/index';
import { WebMapStackRouteShell } from '@/src/screens/WebMapRouteShell';

export default function CameraRouteScreen() {
  if (Platform.OS !== 'web') {
    return <MapScreen />;
  }

  return <WebMapStackRouteShell />;
}
