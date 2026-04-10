/**
 * Cross-platform shadow definitions for HuisHype.
 *
 * Web: Use the Tailwind `shadow-*` classes defined in tailwind.config.js.
 * Native: Apply these objects via the `style` prop. iOS uses shadowColor/
 *         shadowOffset/shadowOpacity/shadowRadius. Android uses `elevation`.
 *
 * Usage pattern:
 *   <View className="shadow-card" style={shadows.card}>
 */

import { Platform, type ViewStyle } from 'react-native';

/**
 * Named shadows matching the design spec (Section 5.1).
 *
 * Shadow tint families:
 *   Gold-tinted (#B47712): card, card-alt, preview, bottom-sheet
 *   Neutral (#000000): tab-bar, search, dropdown
 *   Brand glow (#F5A623): auth-glow
 */
export const shadows = {
  /** Property cards, feed cards, comment cards */
  card: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#B47712',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
    },
    android: { elevation: 2 },
    default: {},
  }),

  /** Cards on warm backgrounds (lighter shadow) */
  'card-alt': Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#1A1918',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.03,
      shadowRadius: 6,
    },
    android: { elevation: 1 },
    default: {},
  }),

  /** Floating preview cards, GroupPreviewCard */
  preview: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#B47712',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
    },
    android: { elevation: 6 },
    default: {},
  }),

  /** Floating tab bar pill */
  'tab-bar': Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
    },
    android: { elevation: 4 },
    default: {},
  }),

  /** Search bar container */
  search: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.07,
      shadowRadius: 5,
    },
    android: { elevation: 3 },
    default: {},
  }),

  /** Search results dropdown (double shadow) */
  dropdown: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.09,
      shadowRadius: 8,
    },
    android: { elevation: 8 },
    default: {},
  }),

  /** Auth modal card — gold glow effect */
  'auth-glow': Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#F5A623',
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.22,
      shadowRadius: 28,
    },
    android: { elevation: 16 },
    default: {
      boxShadow: '0 18px 56px rgba(245, 166, 35, 0.22), 0 32px 96px rgba(245, 166, 35, 0.08)',
    } as ViewStyle,
  }),

  /** Bottom sheet top edge */
  'bottom-sheet': Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#B47712',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
    },
    android: { elevation: 8 },
    default: {},
  }),
} as const;

export type ShadowName = keyof typeof shadows;
