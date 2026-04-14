import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'expo-router';

import {
  parseMapRoutePath,
  resolveMapRoute,
  type ParsedMapRoute,
  type ResolvedMapRoute,
} from './mapRoute';

export interface ResolvedMapRouteState {
  pathname: string;
  parsedRoute: ParsedMapRoute;
  resolvedRoute: ResolvedMapRoute | null;
  isLoading: boolean;
}

interface ResolvedRouteSnapshot {
  pathname: string;
  route: ResolvedMapRoute | null;
}

export function useResolvedMapRoute(
  pathnameOverride?: string | null,
): ResolvedMapRouteState {
  const currentPathname = usePathname();
  const pathname = pathnameOverride ?? currentPathname;
  const [hasMounted, setHasMounted] = useState(false);
  const parsedRoute = useMemo(() => parseMapRoutePath(pathname), [pathname]);
  const [resolvedSnapshot, setResolvedSnapshot] = useState<ResolvedRouteSnapshot>(
    () => ({
      pathname,
      route: pathname === '/' ? { kind: 'root', canonicalPath: '/' } : null,
    }),
  );
  const [isLoading, setIsLoading] = useState<boolean>(pathname !== '/');
  const resolvedRoute =
    resolvedSnapshot.pathname === pathname ? resolvedSnapshot.route : null;

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!hasMounted) {
      return;
    }

    if (parsedRoute.kind === 'root') {
      setResolvedSnapshot({
        pathname,
        route: { kind: 'root', canonicalPath: '/' },
      });
      setIsLoading(false);
      return;
    }

    if (parsedRoute.kind === 'camera') {
      setResolvedSnapshot({
        pathname,
        route: {
          kind: 'camera',
          canonicalPath: pathname,
          camera: parsedRoute.camera,
        },
      });
      setIsLoading(false);
      return;
    }

    if (parsedRoute.kind === 'invalid') {
      setResolvedSnapshot({
        pathname,
        route: { kind: 'invalid', canonicalPath: '/', reason: parsedRoute.reason },
      });
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setResolvedSnapshot({ pathname, route: null });
    setIsLoading(true);

    void resolveMapRoute(pathname).then((nextRoute) => {
      if (cancelled) {
        return;
      }

      setResolvedSnapshot({ pathname, route: nextRoute });
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [hasMounted, parsedRoute, pathname]);

  return {
    pathname,
    parsedRoute,
    resolvedRoute,
    isLoading,
  };
}
