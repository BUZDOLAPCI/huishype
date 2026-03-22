/**
 * Cross-platform Phosphor icon component.
 *
 * Imports from `phosphor-react-native` on native and `@phosphor-icons/react`
 * on web. Metro's platform resolution handles this automatically via the
 * .native.tsx / .web.tsx split files.
 *
 * This base .tsx file is the Jest/fallback target and re-exports the web
 * version (which works under jsdom since it renders SVG via React DOM).
 */
export { Icon, type IconProps, type IconName, type IconWeight, ICON_SIZES } from './Icon.web';
