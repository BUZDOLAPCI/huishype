import { Platform, StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';

import PersistentWebMapScreen from '@/src/screens/PersistentWebMapScreen';
import { parseMapRoutePath } from '@/src/lib/mapRoute';

function isPersistentMapRoute(pathname: string): boolean {
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

  if (Platform.OS !== 'web') {
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
  },
});
