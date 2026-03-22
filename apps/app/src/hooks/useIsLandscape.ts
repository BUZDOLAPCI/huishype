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

export function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth > window.innerHeight;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isLandscape;
}
