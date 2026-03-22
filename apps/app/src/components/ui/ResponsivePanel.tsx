/**
 * ResponsivePanel — platform-agnostic fallback.
 *
 * Metro resolves .native.tsx (mobile) or .web.tsx (web) automatically.
 * This bare .tsx file is the Jest/fallback target and re-exports the web
 * version (which works under jsdom since it renders HTML divs).
 */
export { ResponsivePanel, type ResponsivePanelProps } from './ResponsivePanel.web';
