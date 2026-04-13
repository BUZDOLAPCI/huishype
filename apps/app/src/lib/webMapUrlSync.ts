export function getCurrentBrowserPathname(fallbackPathname: string): string {
  if (typeof window === 'undefined') {
    return fallbackPathname;
  }

  return window.location.pathname || fallbackPathname;
}

export function replacePassiveBrowserPath(pathname: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  if (window.location.pathname === pathname) {
    return false;
  }

  window.history.replaceState(window.history.state, '', pathname);
  return true;
}
