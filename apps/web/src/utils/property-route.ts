export const PROPERTY_RETURN_TARGETS = [
  '/',
  '/feed',
  '/saved',
  '/profile',
  '/notifications',
  '/leaderboard',
] as const;

export type PropertyReturnTarget = (typeof PROPERTY_RETURN_TARGETS)[number];

export function buildPropertyRoute(
  propertyId: string,
  returnTo?: PropertyReturnTarget,
) {
  if (!returnTo) {
    return `/property/${propertyId}` as const;
  }

  return `/property/${propertyId}?returnTo=${encodeURIComponent(returnTo)}` as const;
}

export function normalizePropertyReturnTarget(
  value: string | string[] | undefined,
): PropertyReturnTarget | null {
  if (typeof value !== 'string') {
    return null;
  }

  return PROPERTY_RETURN_TARGETS.includes(value as PropertyReturnTarget)
    ? (value as PropertyReturnTarget)
    : null;
}
