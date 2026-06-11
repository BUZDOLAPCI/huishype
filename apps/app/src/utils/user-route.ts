import { handleSchema } from '@huishype/shared';

export function normalizeUserProfileHandle(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = handleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function buildUserProfileRoute(handle: string): `/user/@${string}` {
  const normalized = normalizeUserProfileHandle(handle);
  return `/user/@${normalized ?? handle.trim().replace(/^@+/, '').toLowerCase()}`;
}

export function parseUserProfileRouteParam(value: string | null | undefined): string | null {
  if (!value?.startsWith('@')) {
    return null;
  }

  return normalizeUserProfileHandle(value);
}
