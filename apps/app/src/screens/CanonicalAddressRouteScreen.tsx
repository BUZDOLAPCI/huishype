import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  type Href,
  Stack,
  router,
  useLocalSearchParams,
  usePathname,
} from 'expo-router';

import { RouteLoadingShell } from '@/src/components/RouteLoadingShell';
import { useResolvedMapRoute } from '@/src/lib/useResolvedMapRoute';
import { replacePassiveBrowserPath } from '@/src/lib/webMapUrlSync';
import { CommentsRouteScreen } from '@/src/screens/CommentsRouteScreen';
import { GuessesRouteScreen } from '@/src/screens/GuessesRouteScreen';
import { PropertyDetailRouteScreen } from '@/src/screens/PropertyDetailRouteScreen';
import {
  buildCanonicalRouteHref,
  buildPropertyMapRoute,
  buildPropertyRoute,
  toInternalAppHref,
} from '@/src/utils/property-route';

function RedirectingScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <RouteLoadingShell
        title="Loading route"
        subtitle="Resolving address details..."
      />
    </>
  );
}

function CanonicalAddressRouteContent() {
  const { returnTo } = useLocalSearchParams<{
    returnTo?: string | string[];
  }>();
  const pathname = usePathname();
  const [webRedirectPathname, setWebRedirectPathname] = useState<string | null>(null);
  const pathnameOverride =
    Platform.OS === 'web' && webRedirectPathname && pathname !== webRedirectPathname
      ? webRedirectPathname
      : Platform.OS === 'web'
        ? pathname
        : undefined;
  const routeState = useResolvedMapRoute(pathnameOverride);
  const { pathname: resolvedPathname, resolvedRoute } = routeState;

  const handleNavigate = useCallback((target: string) => {
    const href = toInternalAppHref(target);
    router.navigate(href);
  }, []);

  useEffect(() => {
    if (
      Platform.OS === 'web' &&
      webRedirectPathname &&
      pathname === webRedirectPathname
    ) {
      setWebRedirectPathname(null);
    }
  }, [pathname, webRedirectPathname]);

  useEffect(() => {
    if (!resolvedRoute) {
      return;
    }

    if (resolvedRoute.kind === 'invalid') {
      if (Platform.OS === 'web') {
        if (resolvedPathname !== '/') {
          replacePassiveBrowserPath('/');
          setWebRedirectPathname('/');
        }
        return;
      }

      router.replace('/');
      return;
    }

    if (
      resolvedRoute.canonicalPath !== resolvedPathname &&
      resolvedRoute.kind !== 'root' &&
      resolvedRoute.kind !== 'camera'
    ) {
      router.replace(
        buildCanonicalRouteHref(resolvedRoute.canonicalPath, returnTo) as Href,
      );
    }
  }, [resolvedPathname, resolvedRoute, returnTo]);

  if (!resolvedRoute || routeState.isLoading) {
    return <RedirectingScreen />;
  }

  if (resolvedRoute.kind === 'property') {
    return (
      <PropertyDetailRouteScreen
        propertyId={resolvedRoute.property.id}
        returnTo={returnTo ?? buildPropertyMapRoute(resolvedRoute.routeInput)}
        {...(Platform.OS === 'web' ? { onNavigate: handleNavigate } : {})}
      />
    );
  }

  if (resolvedRoute.kind === 'comments') {
    return (
      <CommentsRouteScreen
        propertyId={resolvedRoute.property.id}
        returnTo={returnTo ?? buildPropertyRoute(resolvedRoute.routeInput)}
        {...(Platform.OS === 'web' ? { onNavigate: handleNavigate } : {})}
      />
    );
  }

  if (resolvedRoute.kind === 'guesses') {
    return (
      <GuessesRouteScreen
        propertyId={resolvedRoute.property.id}
        returnTo={returnTo ?? buildPropertyRoute(resolvedRoute.routeInput)}
        {...(Platform.OS === 'web' ? { onNavigate: handleNavigate } : {})}
      />
    );
  }

  if (
    resolvedRoute.kind === 'root' ||
    resolvedRoute.kind === 'camera' ||
    resolvedRoute.kind === 'city' ||
    resolvedRoute.kind === 'postcode' ||
    resolvedRoute.kind === 'preview'
  ) {
    if (Platform.OS === 'web') {
      const MapScreen = require('@/app/(tabs)/index.web').default as typeof import('@/app/(tabs)/index.web').default;
      return <MapScreen pathnameOverride={resolvedPathname} />;
    }

    const MapScreen = require('@/app/(tabs)/index').default as typeof import('@/app/(tabs)/index').default;
    return <MapScreen />;
  }

  return <RedirectingScreen />;
}

export default function CanonicalAddressRouteScreen() {
  const [isHydrated, setIsHydrated] = useState(Platform.OS !== 'web');

  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsHydrated(true);
    }
  }, []);

  if (Platform.OS === 'web' && !isHydrated) {
    return <RedirectingScreen />;
  }

  return <CanonicalAddressRouteContent />;
}
