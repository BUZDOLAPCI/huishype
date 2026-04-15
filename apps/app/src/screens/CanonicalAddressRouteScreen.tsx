import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import {
  type Href,
  Stack,
  router,
  useLocalSearchParams,
  usePathname,
  useRootNavigationState,
} from 'expo-router';

import {
  useRegisterDetailSurfaceEntry,
  useDetailSurfaceSynthesis,
} from '@/src/detail-surfaces/DetailSurfaceHostContext';
import { useResolvedMapRoute } from '@/src/lib/useResolvedMapRoute';
import { replacePassiveBrowserPath } from '@/src/lib/webMapUrlSync';
import {
  buildCanonicalRouteHref,
  buildPropertyCommentsRoute,
  buildPropertyGuessesRoute,
  buildPropertyRoute,
  normalizePropertyReturnTarget,
} from '@/src/utils/property-route';

function TransparentScreen() {
  return (
    <Stack.Screen
      options={{
        animation: 'none',
        contentStyle: { backgroundColor: 'transparent' },
        headerShown: false,
        presentation: 'transparentModal',
      }}
    />
  );
}

export default function CanonicalAddressRouteScreen() {
  const { returnTo } = useLocalSearchParams<{
    returnTo?: string | string[];
  }>();
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const [webRedirectPathname, setWebRedirectPathname] = useState<string | null>(null);
  const pathnameOverride =
    Platform.OS === 'web' && webRedirectPathname && pathname !== webRedirectPathname
      ? webRedirectPathname
      : Platform.OS === 'web'
        ? pathname
        : undefined;
  const routeState = useResolvedMapRoute(pathnameOverride);
  const { pathname: resolvedPathname, resolvedRoute } = routeState;
  const normalizedReturnTarget = normalizePropertyReturnTarget(returnTo);
  const { enqueueSynthesisPlan } = useDetailSurfaceSynthesis();

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

  const entry = useMemo(() => {
    if (!resolvedRoute) {
      return null;
    }

    if (
      resolvedRoute.kind !== 'property' &&
      resolvedRoute.kind !== 'comments' &&
      resolvedRoute.kind !== 'guesses'
    ) {
      return null;
    }

    const baseHref = normalizedReturnTarget ?? '/';
    const propertyHref = buildPropertyRoute(resolvedRoute.routeInput, baseHref);
    const commentsHref = buildPropertyCommentsRoute(
      resolvedRoute.routeInput,
      propertyHref,
    );
    const guessesHref = buildPropertyGuessesRoute(
      resolvedRoute.routeInput,
      propertyHref,
    );
    const finalHref =
      resolvedRoute.kind === 'property'
        ? propertyHref
        : resolvedRoute.kind === 'comments'
          ? commentsHref
          : guessesHref;

    return {
      status: routeState.isLoading ? ('loading' as const) : ('ready' as const),
      routeKind: resolvedRoute.kind,
      canonicalPath: buildCanonicalRouteHref(resolvedRoute.canonicalPath, returnTo),
      propertyId: resolvedRoute.property.id,
      baseHref,
      propertyHref,
      commentsHref,
      guessesHref,
      hasPresentingRoute:
        normalizedReturnTarget !== null ||
        (rootNavigationState?.routes.length ?? 0) > 1,
    };
  }, [
    normalizedReturnTarget,
    resolvedRoute,
    rootNavigationState?.routes.length,
    routeState.isLoading,
    returnTo,
  ]);

  useEffect(() => {
    if (!entry || routeState.isLoading) {
      return;
    }

    if (entry.hasPresentingRoute) {
      return;
    }

    const finalHref =
      entry.routeKind === 'property'
        ? entry.propertyHref
        : entry.routeKind === 'comments'
          ? entry.commentsHref
          : entry.guessesHref;

    enqueueSynthesisPlan({
      baseHref: entry.baseHref,
      propertyHref: entry.propertyHref,
      finalHref,
    });
  }, [
    enqueueSynthesisPlan,
    entry,
    routeState.isLoading,
  ]);

  useRegisterDetailSurfaceEntry(entry);

  return <TransparentScreen />;
}
