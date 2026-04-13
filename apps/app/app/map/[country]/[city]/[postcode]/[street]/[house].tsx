import { usePathname } from 'expo-router';

import { MapPreviewRouteShell } from '@/src/screens/MapPreviewRouteShell';

export default function MapPreviewRouteWithCountry() {
  const pathnameOverride = usePathname();

  return <MapPreviewRouteShell pathnameOverride={pathnameOverride} />;
}
