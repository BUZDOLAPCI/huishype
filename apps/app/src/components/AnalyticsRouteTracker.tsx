import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useMemo } from 'react';

import { getAnalyticsConsent, trackScreenView } from '@/src/lib/analytics';

export function AnalyticsRouteTracker() {
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams();
  const searchSignature = useMemo(() => {
    return JSON.stringify(
      Object.keys(searchParams)
        .sort()
        .map((key) => [key, searchParams[key]]),
    );
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function trackRoute() {
      await getAnalyticsConsent();
      if (cancelled) {
        return;
      }

      trackScreenView(pathname, normalizeSearchParams(searchParams));
    }

    void trackRoute();

    return () => {
      cancelled = true;
    };
  }, [pathname, searchParams, searchSignature]);

  return null;
}

function normalizeSearchParams(
  params: ReturnType<typeof useGlobalSearchParams>,
): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      normalized[key] = value.join(',');
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value;
    }
  }

  return normalized;
}
