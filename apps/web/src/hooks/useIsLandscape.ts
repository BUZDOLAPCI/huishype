/**
 * useIsLandscape — Detect landscape orientation on web via window dimensions.
 *
 * Extracted from PropertyBottomSheet.web.tsx for reuse across responsive
 * layout components (ResponsivePanel, PropertyBottomSheet, etc.).
 *
 * On native (where this module is not consumed), orientation is always
 * portrait for phone form-factor, so callers use the native-specific
 * component variants instead.
 */
import { useSyncExternalStore } from 'react';

function readIsLandscape(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth > window.innerHeight;
}

export function useIsLandscape(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') {
        return () => undefined;
      }

      window.addEventListener('resize', onStoreChange);
      return () => window.removeEventListener('resize', onStoreChange);
    },
    readIsLandscape,
    () => false,
  );
}
