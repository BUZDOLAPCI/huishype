import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { router, usePathname, useRootNavigationState } from 'expo-router';

import { extractAppPathFromUrl } from '@/src/lib/deepLink';
import { toInternalAppHref } from '@/src/utils/property-route';

export function DeepLinkRouteSync() {
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const pathnameRef = useRef(pathname);
  const didApplyInitialUrlRef = useRef(false);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const syncUrl = useCallback((url: string | null | undefined) => {
    const appPath = extractAppPathFromUrl(url);
    if (!appPath || appPath === pathnameRef.current) {
      return;
    }

    router.replace(toInternalAppHref(appPath));
  }, []);

  useEffect(() => {
    if (!rootNavigationState?.key) {
      return undefined;
    }

    if (!didApplyInitialUrlRef.current) {
      didApplyInitialUrlRef.current = true;

      void Linking.getInitialURL().then((url) => {
        syncUrl(url);
      });
    }

    const subscription = Linking.addEventListener('url', ({ url }) => {
      syncUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, [rootNavigationState?.key, syncUrl]);

  return null;
}
