const DEV_CLIENT_HOST = 'expo-development-client';
const DEV_CLIENT_PATH_PREFIX = `/${DEV_CLIENT_HOST}`;
const METRO_ROUTE_PREFIX = '/--/';

function decodeUrl(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function stripMetroRoutePrefix(pathname: string): string {
  return pathname.startsWith(METRO_ROUTE_PREFIX)
    ? pathname.slice(METRO_ROUTE_PREFIX.length - 1)
    : pathname;
}

export function extractAppPathFromUrl(
  url: string | null | undefined,
  depth = 0,
): string | null {
  if (!url || depth > 2) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const isDevClientWrapper =
    url.includes(`://${DEV_CLIENT_HOST}/`) ||
    url.includes(`://${DEV_CLIENT_HOST}?`) ||
    parsed.hostname === DEV_CLIENT_HOST ||
    parsed.pathname === DEV_CLIENT_PATH_PREFIX ||
    parsed.pathname.startsWith(`${DEV_CLIENT_PATH_PREFIX}/`);

  if (isDevClientWrapper) {
    const nestedUrl = parsed.searchParams.get('url');
    if (!nestedUrl) {
      return null;
    }

    const decodedNestedUrl = decodeUrl(nestedUrl);
    return decodedNestedUrl
      ? extractAppPathFromUrl(decodedNestedUrl, depth + 1)
      : null;
  }

  const pathname = stripMetroRoutePrefix(parsed.pathname);
  return `${pathname || '/'}${parsed.search}`;
}
