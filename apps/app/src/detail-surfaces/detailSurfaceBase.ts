import { isStaticAppRoutePath, normalizePropertyReturnTarget } from '@/src/utils/property-route';

export type DetailSurfaceBaseKind =
  | 'map'
  | 'feed'
  | 'saved'
  | 'profile'
  | 'notifications'
  | 'leaderboard';

export interface DetailSurfaceBase {
  kind: DetailSurfaceBaseKind;
  href: string;
}

export function resolveDetailSurfaceBase(href: string): DetailSurfaceBase {
  const normalizedHref = normalizePropertyReturnTarget(href) ?? '/';
  const pathname = normalizedHref.split('?')[0] ?? normalizedHref;

  if (!isStaticAppRoutePath(pathname)) {
    return { kind: 'map', href: normalizedHref };
  }

  switch (pathname) {
    case '/feed':
      return { kind: 'feed', href: normalizedHref };
    case '/saved':
      return { kind: 'saved', href: normalizedHref };
    case '/profile':
      return { kind: 'profile', href: normalizedHref };
    case '/notifications':
      return { kind: 'notifications', href: normalizedHref };
    case '/leaderboard':
      return { kind: 'leaderboard', href: normalizedHref };
    default:
      return { kind: 'map', href: '/' };
  }
}
