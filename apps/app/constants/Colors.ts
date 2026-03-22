/**
 * HuisHype color tokens — aligned with the warm-gold palette in tailwind.config.js.
 * Use these for inline styles where Tailwind classes are not available.
 */

// Brand gold primary
const tintColorLight = '#F5A623'; // primary-500 (gold)
const tintColorDark = '#F7C948'; // primary-400 (gold light)

export default {
  light: {
    text: '#2D2926', // warm-900
    background: '#FFFBF5', // warm-50 (surface background)
    tint: tintColorLight,
    tabIconDefault: '#C7BFB3', // warm-400
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#FFFBF5', // warm-50
    background: '#2D2926', // warm-900
    tint: tintColorDark,
    tabIconDefault: '#9C958A', // warm-500
    tabIconSelected: tintColorDark,
  },
};
