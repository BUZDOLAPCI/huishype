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
import { useState, useEffect } from 'react';

function readIsLandscape(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth > window.innerHeight;
}

export function useIsLandscape(): boolean {
  // Keep the server render and the first client render identical so
  // responsive panels do not hydrate with mismatched DOM on square/narrow viewports.
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsLandscape(readIsLandscape());

    const handleResize = () => {
      setIsLandscape(readIsLandscape());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isLandscape;
}
