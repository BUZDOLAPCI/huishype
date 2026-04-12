import { usePathname } from 'expo-router';

import { MapPreviewRouteShell } from '@/src/screens/MapPreviewRouteShell';

export default function MapPreviewRouteWithCountry() {
  const pathname = usePathname();

  return <MapPreviewRouteShell pathnameOverride={pathname} />;
}
