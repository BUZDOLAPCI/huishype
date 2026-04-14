import { Platform } from 'react-native';

import MapScreen from '@/app/(tabs)/index';

export function MapPreviewRouteShell({
  pathnameOverride,
}: {
  pathnameOverride: string;
}) {
  if (Platform.OS !== 'web') {
    return <MapScreen pathnameOverride={pathnameOverride} />;
  }

  return null;
}
