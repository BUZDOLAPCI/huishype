/**
 * PropertyBottomSheet — platform-agnostic fallback.
 *
 * Metro resolves .native.tsx (mobile) or .web.tsx (web) automatically.
 * This bare .tsx file is kept for environments without platform resolution (e.g. Jest).
 * It re-exports the native implementation as the default fallback.
 */
export { PropertyBottomSheet } from './PropertyBottomSheet.native';
