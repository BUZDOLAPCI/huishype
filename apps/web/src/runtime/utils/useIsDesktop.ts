import { useSyncExternalStore } from 'react';

function readViewportIsDesktop() {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.innerWidth >= 1024;
}

export function useIsDesktop() {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') {
        return () => undefined;
      }

      window.addEventListener('resize', onChange);
      return () => window.removeEventListener('resize', onChange);
    },
    readViewportIsDesktop,
    () => true,
  );
}
