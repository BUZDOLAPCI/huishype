/**
 * useReducedMotion — Cross-platform reduced-motion preference hook.
 *
 * Web: Listens to `prefers-reduced-motion` media query.
 * Native: Reads `AccessibilityInfo.isReduceMotionEnabled()` on mount
 *         and subscribes to changes.
 *
 * Usage:
 *   const reducedMotion = useReducedMotion();
 *   const duration = reducedMotion ? 0 : 300;
 */

import { useState, useEffect } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      // Web: use matchMedia API
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReducedMotion(mql.matches);

        const handler = (event: MediaQueryListEvent) => {
          setReducedMotion(event.matches);
        };
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
      }
    } else {
      // Native: use AccessibilityInfo
      AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
      const subscription = AccessibilityInfo.addEventListener(
        'reduceMotionChanged',
        setReducedMotion
      );
      return () => subscription.remove();
    }
  }, []);

  return reducedMotion;
}
