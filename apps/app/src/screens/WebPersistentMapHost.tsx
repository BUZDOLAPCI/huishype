import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';

import PersistentWebMapScreen from '@/src/screens/PersistentWebMapScreen';
import { parseMapRoutePath } from '@/src/lib/mapRoute';
import { isStaticAppRoutePath } from '@/src/utils/property-route';

function isPersistentMapRoute(pathname: string): boolean {
  if (isStaticAppRoutePath(pathname)) {
    return false;
  }

  const route = parseMapRoutePath(pathname);

  return (
    route.kind === 'root' ||
    route.kind === 'camera' ||
    route.kind === 'city' ||
    route.kind === 'postcode' ||
    route.kind === 'preview'
  );
}

export function WebPersistentMapHost() {
  const pathname = usePathname();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  if (Platform.OS !== 'web' || !isHydrated) {
    return null;
  }

  const shouldRenderMap = pathname ? isPersistentMapRoute(pathname) : false;

  return (
    <View pointerEvents="box-none" style={styles.host}>
      {shouldRenderMap ? <PersistentWebMapScreen pathnameOverride={pathname} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
});
