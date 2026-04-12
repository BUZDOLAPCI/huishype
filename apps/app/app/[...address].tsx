import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { type Href, Stack, router, useLocalSearchParams } from 'expo-router';

import { CommentsRouteScreen } from './comments/[propertyId]';
import { GuessesRouteScreen } from './guesses/[propertyId]';
import { PropertyDetailRouteScreen } from './property/[id]';
import MapScreen from './(tabs)/index';
import { useResolvedMapRoute } from '@/src/lib/useResolvedMapRoute';
import {
  buildPropertyMapRoute,
  buildPropertyRoute,
  toInternalAppHref,
} from '@/src/utils/property-route';

function RedirectingScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container} testID="address-route-redirecting">
        <ActivityIndicator size="large" color="#F5A623" />
      </View>
    </>
  );
}

export default function CanonicalAddressRouteScreen() {
  const { returnTo } = useLocalSearchParams<{
    returnTo?: string | string[];
  }>();
  const routeState = useResolvedMapRoute();
  const { pathname, resolvedRoute } = routeState;

  const handleNavigate = useCallback((target: string) => {
    const href = toInternalAppHref(target);
    router.replace(href);
  }, []);

  useEffect(() => {
    if (!resolvedRoute) {
      return;
    }

    if (resolvedRoute.kind === 'invalid') {
      router.replace('/');
      return;
    }

    if (
      resolvedRoute.canonicalPath !== pathname &&
      resolvedRoute.kind !== 'root' &&
      resolvedRoute.kind !== 'camera'
    ) {
      router.replace(resolvedRoute.canonicalPath as Href);
    }
  }, [pathname, resolvedRoute]);

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
        returnTo={returnTo ?? buildPropertyRoute(
          resolvedRoute.routeInput,
          buildPropertyMapRoute(resolvedRoute.routeInput),
        )}
        {...(Platform.OS === 'web' ? { onNavigate: handleNavigate } : {})}
      />
    );
  }

  if (resolvedRoute.kind === 'guesses') {
    return (
      <GuessesRouteScreen
        propertyId={resolvedRoute.property.id}
        returnTo={returnTo ?? buildPropertyRoute(
          resolvedRoute.routeInput,
          buildPropertyMapRoute(resolvedRoute.routeInput),
        )}
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
    return <MapScreen />;
  }

  return <RedirectingScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFBF5',
  },
});
