import { usePathname } from 'expo-router';

import { MapPreviewRouteShell } from '@/src/screens/MapPreviewRouteShell';

export default function MapPreviewRouteScreen() {
  const pathnameOverride = usePathname();

  return <MapPreviewRouteShell pathnameOverride={pathnameOverride} />;
}
