export function getCurrentBrowserPathname(fallbackPathname: string): string {
  if (typeof window === 'undefined') {
    return fallbackPathname;
  }

  return window.location.pathname || fallbackPathname;
}

export function getCurrentBrowserPathWithSearch(fallbackPath: string): string {
  if (typeof window === 'undefined') {
    return fallbackPath;
  }

  const pathname = window.location.pathname || '/';
  const search = window.location.search || '';
  return `${pathname}${search}` || fallbackPath;
}

export function replacePassiveBrowserPath(pathname: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (currentPath === pathname) {
    return false;
  }

  window.history.replaceState(window.history.state, '', pathname);
  return true;
}
