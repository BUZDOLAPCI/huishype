import { Platform } from 'react-native';
import { usePathname } from 'expo-router';

export default function MapBaseRouteScreen() {
  const pathname = usePathname();

  if (Platform.OS === 'web') {
    const MapScreen =
      require('@/app/(tabs)/index.web').default as typeof import('@/app/(tabs)/index.web').default;
    return <MapScreen pathnameOverride={pathname} />;
  }

  const MapScreen =
    require('@/app/(tabs)/index').default as typeof import('@/app/(tabs)/index').default;
  return <MapScreen />;
}
