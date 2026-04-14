import type { CSSProperties } from 'react';

export const shadows = {
  card: {
    boxShadow: '0 12px 28px rgba(180, 119, 18, 0.12), 0 3px 10px rgba(0, 0, 0, 0.05)',
  } satisfies CSSProperties,
  'card-alt': {
    boxShadow: '0 10px 24px rgba(26, 25, 24, 0.05), 0 2px 6px rgba(0, 0, 0, 0.03)',
  } satisfies CSSProperties,
  preview: {
    boxShadow: '0 16px 34px rgba(180, 119, 18, 0.16), 0 5px 14px rgba(0, 0, 0, 0.08)',
  } satisfies CSSProperties,
  'tab-bar': {
    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.10), 0 3px 10px rgba(0, 0, 0, 0.06)',
  } satisfies CSSProperties,
  search: {
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.10), 0 2px 8px rgba(0, 0, 0, 0.05)',
  } satisfies CSSProperties,
  dropdown: {
    boxShadow: '0 18px 34px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.05)',
  } satisfies CSSProperties,
  'auth-glow': {
    boxShadow: '0 18px 56px rgba(245, 166, 35, 0.22), 0 32px 96px rgba(245, 166, 35, 0.08)',
  } satisfies CSSProperties,
  'bottom-sheet': {
    boxShadow: '0 -8px 28px rgba(180, 119, 18, 0.10), 0 -2px 8px rgba(0, 0, 0, 0.05)',
  } satisfies CSSProperties,
} as const;

export type ShadowName = keyof typeof shadows;
