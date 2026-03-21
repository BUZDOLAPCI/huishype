# Visual Design Overhaul Specification

**Date**: 2026-03-21 (revised from 2026-03-17 original)
**Status**: Design spec — updated to match finalized Pen design file
**Scope**: Complete visual overhaul of the HuisHype app. Color system, typography, component tokens, screen-by-screen treatment.
**Source of truth**: `docs/visual-references/design-overhaul/huishype-visual-overhaul.pen`

---


## Current State

The app uses a generic Tailwind blue primary (`#3B82F6`) defined in `apps/app/tailwind.config.js`, with the tab bar tint from `apps/app/constants/Colors.ts` set to `#2f95dc`. Backgrounds are pure white `#FFFFFF`. Text colors use Tailwind's default cool-gray scale. There is no brand font — everything renders in system default. Icons use `@expo/vector-icons` (Ionicons + FontAwesome). The overall feel is clinical and generic.

**Files to change** (design token layer):
- `apps/app/tailwind.config.js` — primary color scale, extended palette, font families
- `apps/app/constants/Colors.ts` — tab bar tint, semantic colors
- `apps/app/global.css` — CSS variables for web shadows, background color
- `apps/app/app/_layout.tsx` — font loading (Inter + Outfit + DM Sans via expo-font)

**Component files with hardcoded blue** (`#3B82F6` / `primary-500` / `primary-600`):
- `PropertyCard.tsx`, `PropertyFeedCard.tsx`, `PropertyPreviewCard.tsx`, `GroupPreviewCard.tsx`
- `FMVVisualization.tsx`, `FeedFilterChips.tsx`, `ConsensusAlignment.tsx`
- `PriceGuessSlider.tsx`, `PriceSection.tsx`, `PropertyDetails.tsx`
- `ListingLinks.tsx`, `PriceGuessSection.tsx`, `ListingSubmissionSheet.tsx`
- `QuickActions.tsx`, `CommentInput.tsx`, `CommentsSection.tsx`
- `CommentList.tsx`, `Comment.tsx`, `CommentsList.tsx`, `KarmaBadge.tsx`
- `SearchResults.tsx`, `FeedErrorState.tsx`
- `apps/app/app/(tabs)/_layout.tsx` (header auth button)
- `apps/app/app/(tabs)/profile.tsx` (karma rank colors)

---

## 1. Color Palette

### 1.1 Brand Gold (replaces blue primary)

The HuisHype logo is a golden speech-bubble with a house icon. Gold is the primary brand color.

| Token | Hex | Usage |
|-------|-----|-------|
| `gold-50` | `#FFFBEB` | Lightest tint backgrounds, selected states |
| `gold-100` | `#FFF3C4` | Light badges, hover states |
| `gold-200` | `#FCE588` | Soft highlights |
| `gold-300` | `#FADB5F` | — |
| `gold-400` | `#F7C948` | Secondary buttons, icons |
| `gold-500` | `#F5A623` | **Primary brand color** — active tabs, CTAs, Send button, brand text |
| `gold-600` | `#DE911D` | Pressed/hover state on primary |
| `gold-700` | `#B47712` | Text on light gold backgrounds |
| `gold-800` | `#8C5E0A` | Dark brand accents |
| `gold-900` | `#6B4706` | Darkest gold text |

**Tailwind config key**: `primary` (so existing `primary-500`, `primary-600` classes remap automatically).

```js
primary: {
  50:  '#FFFBEB',
  100: '#FFF3C4',
  200: '#FCE588',
  300: '#FADB5F',
  400: '#F7C948',
  500: '#F5A623',
  600: '#DE911D',
  700: '#B47712',
  800: '#8C5E0A',
  900: '#6B4706',
},
```

### 1.2 Warm Neutrals (replaces cool-gray)

All grays shift warm. No blue tint. Cream-based backgrounds replace pure white.

| Token | Hex | Usage |
|-------|-----|-------|
| `warm-50` | `#FFFBF5` | **App background** (screen-level) |
| `warm-100` | `#FFF8F0` | Alternate card backgrounds, input fields |
| `warm-200` | `#F5F0E8` | Dividers, disabled surfaces |
| `warm-300` | `#E8E0D4` | Borders, subtle outlines |
| `warm-400` | `#C7BFB3` | Placeholder text, inactive icons |
| `warm-500` | `#9C958A` | Secondary text |
| `warm-600` | `#736C62` | Body text |
| `warm-700` | `#504A42` | Strong secondary text |
| `warm-800` | `#3D3832` | — |
| `warm-900` | `#2D2926` | **Primary text** (near-black, warm) |

```js
warm: {
  50:  '#FFFBF5',
  100: '#FFF8F0',
  200: '#F5F0E8',
  300: '#E8E0D4',
  400: '#C7BFB3',
  500: '#9C958A',
  600: '#736C62',
  700: '#504A42',
  800: '#3D3832',
  900: '#2D2926',
},
```

### 1.3 Surface Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `surface-background` | `#FFFBF5` (warm-50) | Screen backgrounds |
| `surface-card` | `#FFFFFF` | Cards, bottom sheets, modals |
| `surface-elevated` | `#FFFFFF` | Floating elements (search bar, preview cards) |
| `surface-input` | `#FFF8F0` (warm-100) | Text inputs, search field backgrounds |
| `surface-muted` | `#F5F0E8` (warm-200) | Inactive chip backgrounds, disabled states |

### 1.4 Semantic Colors

The pen file defines semantic colors as single primary values with specific names. We retain the tiered approach (50/100/500/700) for implementation flexibility (backgrounds, fills, text-on-light) while adopting the pen's naming and primary values.

**Key distinction**: `$hot-red` (`#FF6B35`) is the activity/heat indicator, NOT the error color. `$error-red` (`#E53935`) is the true error color. The old spec conflated these — the pen separates them.

| Token | Hex | Usage |
|-------|-----|-------|
| **Crowd Green** (`$crowd-green`) | | |
| `crowd-green-50` | `#ECFDF5` | Success/consensus background |
| `crowd-green-100` | `#D1FAE5` | Light success surface |
| `crowd-green-500` | `#4CAF50` | **Primary** — crowd consensus, karma verified, accurate guess |
| `crowd-green-700` | `#15803D` | Success text on light bg |
| **Error Red** (`$error-red`) | | |
| `error-red-50` | `#FFEBEE` | Error background |
| `error-red-100` | `#FFCDD2` | Light error surface |
| `error-red-500` | `#E53935` | **Primary** — form validation errors, destructive actions, system errors |
| `error-red-700` | `#C62828` | Error text on light bg |
| **Hot Red** (`$hot-red`) | | |
| `hot-red-50` | `#FFF5F0` | Hot activity background |
| `hot-red-100` | `#FFE0D6` | Light hot surface |
| `hot-red-500` | `#FF6B35` | **Primary** — hot activity indicator, hearts/likes, overpriced deviation |
| `hot-red-700` | `#C43E00` | Hot text on light bg |
| **Info Blue** (`$info-blue`) | | |
| `info-blue-50` | `#E3F2FD` | Info background |
| `info-blue-100` | `#BBDEFB` | Light info surface |
| `info-blue-500` | `#42A5F5` | **Primary** — informational badges, help text |
| `info-blue-700` | `#1565C0` | Info text on light bg |
| **Warning Orange** (`$warning-orange`) | | |
| `warning-orange-50` | `#FFF8E1` | Warning background |
| `warning-orange-100` | `#FFECB3` | Light warning surface |
| `warning-orange-500` | `#FF9500` | **Primary** — deviation alerts, price mismatch, asking price marker |
| `warning-orange-700` | `#B45309` | Warning text on light bg |

```js
'crowd-green': { 50: '#ECFDF5', 100: '#D1FAE5', 500: '#4CAF50', 700: '#15803D' },
'error-red':   { 50: '#FFEBEE', 100: '#FFCDD2', 500: '#E53935', 700: '#C62828' },
'hot-red':     { 50: '#FFF5F0', 100: '#FFE0D6', 500: '#FF6B35', 700: '#C43E00' },
'info-blue':   { 50: '#E3F2FD', 100: '#BBDEFB', 500: '#42A5F5', 700: '#1565C0' },
'warning-orange': { 50: '#FFF8E1', 100: '#FFECB3', 500: '#FF9500', 700: '#B45309' },
```

**Migration note**: Old spec's `error-500` (`#FF6B35`) mapped to likes and hot indicators. That value is now `hot-red-500`. Actual error states (`#E53935`) should use `error-red-500`. Search codebase for `error-500` and evaluate each usage: if it's a heart/like/hot-indicator, replace with `hot-red-500`; if it's a true error, replace with `error-red-500`.

### 1.5 Standalone Color Tokens

These pen variables are single values without a scale:

| Token | Hex | Usage |
|-------|-----|-------|
| `$white` | `#FFFFFF` | Card backgrounds, elevated surfaces |
| `$bot-bubble` | `#FFF3E0` | HuisHype bot chat bubble background |

### 1.6 Auth Modal Cool Grays

The auth modal intentionally uses a cool gray palette that is separate from the warm neutral system. This is a deliberate design choice — the auth modal is a neutral overlay that doesn't carry the warm brand feel.

| Token | Hex | Usage |
|-------|-----|-------|
| `auth-bg` | `#F4F4F5` | Auth modal background |
| `auth-text-muted` | `#71717A` | Auth subtitle text, secondary labels |
| `auth-border` | `#E4E4E7` | Auth input borders, dividers |
| `auth-text` | `#1A1A1A` | Auth title text, primary labels |

These should NOT be added to the global Tailwind theme. Define them as CSS variables or inline them in the AuthModal component, scoped to that context only.

### 1.7 Activity Level Colors

| Level | Dot color | Background | Text color | Label |
|-------|-----------|------------|------------|-------|
| Hot | `#FF6B35` (hot-red-500) | `#FFF5F0` (hot-red-50) | `#C43E00` (hot-red-700) | "Hot" |
| Warm | `#F5A623` (gold-500) | `#FFFBEB` (gold-50) | `#B47712` (gold-700) | "Active" |
| Cold | `#C7BFB3` (warm-400) | `#F5F0E8` (warm-200) | `#9C958A` (warm-500) | "Quiet" |

### 1.8 Price Visualization Colors

| Role | Hex | Usage |
|------|-----|-------|
| Crowd consensus | `#4CAF50` (crowd-green-500) | Crowd guess pill, FMV distribution "consensus" zone |
| FMV / Brand | `#F5A623` (gold-500) | FMV price text, FMV pill, median marker |
| Asking price | `#FF9500` (warning-orange-500) | Asking price marker on bar |
| Deviation / Over | `#FF6B35` (hot-red-500) | Price above estimate indicator |
| Deviation / Under | `#4CAF50` (crowd-green-500) | Price below estimate indicator |
| Bar gradient | `#4CAF50 -> #FADB5F -> #FF9500 -> #FF6B35` | Multi-segment price distribution bar |

### 1.9 Chat Bubble Colors

| Role | Background | Border | Text |
|------|------------|--------|------|
| User message | `#F5F0E8` (warm-200) | none | `#2D2926` (warm-900) |
| HuisHype bot | `#FFF3E0` ($bot-bubble) | `#FCE588` (gold-200) | `#2D2926` (warm-900) |
| System message | `#FFFBEB` (gold-50) | none | `#9C958A` (warm-500) |

### 1.10 Karma Tier Colors

The pen uses English tier names. Update `services/api/src/services/karma.ts` to return English names and update `KarmaBadge.tsx` and `profile.tsx` accordingly.

| Tier | Level | Min Karma | Background | Text | Badge bg (20% opacity) |
|------|-------|-----------|------------|------|------------------------|
| Newcomer | 1 | 0 | `#F5F0E8` | `#9C958A` | warm-200 / warm-500 |
| Contributor | 2 | 10 | `#D1FAE5` | `#15803D` | crowd-green-100 / crowd-green-700 |
| Rising Star | 3 | 50 | `#BBDEFB` | `#1565C0` | info-blue-100 / info-blue-700 |
| Local Expert | 4 | 100 | `#EDE9FE` | `#7C3AED` | purple-100 / purple-700 |
| Expert | 5 | 200 | `#FFF3C4` | `#B47712` | gold-100 / gold-700 |
| Local Legend | 6 | 500 | `#FFCDD2` | `#C62828` | error-red-100 / error-red-700 |
| Master | 7 | 1000 | `#FFE0D6` | `#C43E00` | hot-red-100 / hot-red-700 |

**Note**: The pen shows 7 tiers (old spec had 6). Add "Master" as the highest tier.

---

## 2. Typography

### 2.1 Font Families

Three font families — each with a distinct role:

| Font | Role | Usage |
|------|------|-------|
| **Inter** | Primary UI font | All body text, navigation, buttons, captions, labels, stats |
| **Outfit** | Accent / display font | Property detail titles (street name), auth modal title, crowd estimate price, price labels, section headers, leaderboard entries |
| **DM Sans** | Search results only | Search result address text |

Install all three via `expo-font` + `@expo-google-fonts/*`:

```bash
npx expo install @expo-google-fonts/inter @expo-google-fonts/outfit @expo-google-fonts/dm-sans
```

**Loading** (in `apps/app/app/_layout.tsx`):

```tsx
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  DMSans_400Regular,
  DMSans_500Medium,
} from '@expo-google-fonts/dm-sans';
import { useFonts } from 'expo-font';

const [fontsLoaded] = useFonts({
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  DMSans_400Regular,
  DMSans_500Medium,
});
```

**Tailwind config**:

```js
fontFamily: {
  // Inter (primary)
  sans:           ['Inter_400Regular', 'System', 'sans-serif'],
  'sans-medium':  ['Inter_500Medium', 'System', 'sans-serif'],
  'sans-semibold':['Inter_600SemiBold', 'System', 'sans-serif'],
  'sans-bold':    ['Inter_700Bold', 'System', 'sans-serif'],
  // Outfit (display/accent font)
  display:            ['Outfit_500Medium', 'System', 'sans-serif'],
  'display-semibold': ['Outfit_600SemiBold', 'System', 'sans-serif'],
  'display-bold':     ['Outfit_700Bold', 'System', 'sans-serif'],
  // DM Sans (search)
  search:           ['DMSans_400Regular', 'System', 'sans-serif'],
  'search-medium':  ['DMSans_500Medium', 'System', 'sans-serif'],
},
```

**NativeWind v4 fontWeight workaround**: `fontWeight` is intentionally omitted from `fontSize` config entries. NativeWind v4.1.23 does not translate `fontWeight` from fontSize config to React Native's `fontWeight` style prop. Instead, pair each size class with the appropriate font-family class to get the desired weight. This is still the correct approach with Inter/Outfit/DM Sans — each weight is a separate font file, so you select it via the font-family utility class.

### 2.2 Type Scale

The pen uses a more granular type scale than the old spec's 8-level system. Each entry documents the font family and weight observed in the pen designs.

| Name | Size | Font | Weight | Letter Spacing | Line Height | Usage |
|------|------|------|--------|----------------|-------------|-------|
| `display` | 32px | Outfit | Bold (700) | -0.5px | 1.2 | Crowd estimate price |
| `title-lg` | 26px | Inter | Bold (700) | -0.3px | 1.25 | Notifications screen title |
| `title` | 24px | Inter | Bold (700) | -0.3px | 1.3 | Stat numbers, modal headers |
| `h1` | 22px | Inter | Bold (700) | -0.2px | 1.3 | Screen titles, brand text |
| `h1-accent` | 22px | Outfit | SemiBold (600) | -0.2px | 1.3 | Property street name, leaderboard entries |
| `h2` | 20px | Inter | SemiBold (600) | -0.2px | 1.35 | Profile name, saved header |
| `h2-accent` | 20px | Outfit | SemiBold (600) | -0.2px | 1.35 | Auth modal title |
| `h3` | 18px | Inter | SemiBold (600) | 0 | 1.4 | Section titles, page headers, location text |
| `h4` | 17px | Inter | SemiBold (600) | 0 | 1.4 | Achievements title |
| `body-lg` | 16px | Inter | SemiBold (600) | 0 | 1.5 | Feed card address, status bar text, comments header, property info |
| `body` | 15px | Inter | SemiBold (600) | 0 | 1.5 | Preview card address, crowd card title |
| `body-medium` | 15px | Inter | Medium (500) | 0 | 1.5 | Auth buttons, edit links |
| `body-regular` | 15px | Inter | Regular (400) | 0 | 1.5 | Body text, descriptions |
| `caption-lg` | 14px | Inter | Medium (500) | 0 | 1.4 | Notification text, auth subtitle |
| `caption-lg-search` | 14px | DM Sans | Medium (500) | 0 | 1.4 | Search result address |
| `caption` | 13px | Inter | SemiBold (600) | 0.1px | 1.4 | Filter chips active, comment author name, quick actions, stats |
| `caption-medium` | 13px | Inter | Medium (500) | 0.1px | 1.4 | Chips inactive, activity text |
| `small` | 12px | Inter | Medium (500) | 0.1px | 1.35 | Social card stats, feed stats, badge detail |
| `small-regular` | 12px | Inter | Regular (400) | 0.1px | 1.35 | Comment timestamps, notification times |
| `overline` | 11px | Inter | SemiBold (600) | 0.8px | 1.3 | ALL CAPS section labels, stat labels, karma badge |
| `overline-medium` | 11px | Inter | Medium (500) | 0.5px | 1.3 | Active badge text, achievements |
| `micro` | 10px | Inter | SemiBold (600) | 0.5px | 1.2 | Tab labels, distribution bar labels, podium rank |

**Tailwind config** (extend `fontSize`):

```js
fontSize: {
  'display':    ['32px', { lineHeight: '1.2', letterSpacing: '-0.5px' }],
  'title-lg':   ['26px', { lineHeight: '1.25', letterSpacing: '-0.3px' }],
  'title':      ['24px', { lineHeight: '1.3', letterSpacing: '-0.3px' }],
  'h1':         ['22px', { lineHeight: '1.3', letterSpacing: '-0.2px' }],
  'h2':         ['20px', { lineHeight: '1.35', letterSpacing: '-0.2px' }],
  'h3':         ['18px', { lineHeight: '1.4', letterSpacing: '0px' }],
  'h4':         ['17px', { lineHeight: '1.4', letterSpacing: '0px' }],
  'body-lg':    ['16px', { lineHeight: '1.5', letterSpacing: '0px' }],
  'body':       ['15px', { lineHeight: '1.5', letterSpacing: '0px' }],
  'caption-lg': ['14px', { lineHeight: '1.4', letterSpacing: '0px' }],
  'caption':    ['13px', { lineHeight: '1.4', letterSpacing: '0.1px' }],
  'small':      ['12px', { lineHeight: '1.35', letterSpacing: '0.1px' }],
  'overline':   ['11px', { lineHeight: '1.3', letterSpacing: '0.8px' }],
  'micro':      ['10px', { lineHeight: '1.2', letterSpacing: '0.5px' }],
},
```

**Usage convention**: Combine size + font-family classes. Examples:

| Shorthand | Tailwind classes | Result |
|-----------|-----------------|--------|
| Display (crowd price) | `text-display font-accent-bold` | 32px Outfit 700 |
| Property street | `text-h1 font-accent` | 22px Outfit 600 |
| Screen title | `text-h1 font-sans-bold` | 22px Inter 700 |
| Auth title | `text-h2 font-accent` | 20px Outfit 600 |
| Section header | `text-h3 font-sans-semibold` | 18px Inter 600 |
| Feed card address | `text-body-lg font-sans-semibold` | 16px Inter 600 |
| Preview card address | `text-body font-sans-semibold` | 15px Inter 600 |
| Auth button | `text-body font-sans-medium` | 15px Inter 500 |
| Body text | `text-body font-sans` | 15px Inter 400 |
| Notification text | `text-caption-lg font-sans-medium` | 14px Inter 500 |
| Search result address | `text-caption-lg font-search-medium` | 14px DM Sans 500 |
| Active chip | `text-caption font-sans-semibold` | 13px Inter 600 |
| Comment timestamp | `text-small font-sans` | 12px Inter 400 |
| Section label (caps) | `text-overline font-sans-semibold uppercase` | 11px Inter 600 |
| Tab label | `text-micro font-sans-semibold` | 10px Inter 600 |

---

## 3. Spacing & Layout

### 3.1 Base Unit

**4px** base. All spacing values are multiples of 4.

### 3.2 Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `1` | 4px | Tight gaps (icon-to-label) |
| `2` | 8px | Inline spacing, small gaps |
| `3` | 12px | Compact padding |
| `4` | 16px | **Standard card padding, screen horizontal margin** |
| `5` | 20px | Section gaps |
| `6` | 24px | Between sections in bottom sheet |
| `8` | 32px | Large section gaps |
| `10` | 40px | Screen vertical padding |
| `12` | 48px | Hero spacing |
| `16` | 64px | Major section dividers |

### 3.3 Layout Constants

Based on pen measurements (design frame: 402 x 874).

| Element | Value | Notes |
|---------|-------|-------|
| Screen horizontal padding | 16px | `px-4` |
| Card internal padding | 16px | `p-4` |
| Card gap (between cards) | 16px | `gap-4` or `mb-4` |
| Tab bar pill height | 62px | Floating pill with `rounded-[36px]`, not system tab bar |
| Tab bar bottom offset | 16px | Above safe area bottom |
| Tab bar horizontal margin | 16px | Inset from screen edges (`mx-4`) |
| Search bar height | 48px | Outer container |
| Search bar inner height | 44px | Input area within container |
| Search bar top offset | `SafeAreaInsets.top + 8px` | Floats below status bar |
| Bottom sheet handle area | 24px | Pull handle centered |
| Preview card width | 320px (native) / 340px (web) | Geo-anchored overlay |
| Preview card max-height | 200px | Compact for map overlay |
| Property image height | 200px | In feed cards and detail view |
| Filter chip height | 36px | Feed filter bar |
| Avatar sizes | 32px (inline), 40px (comment), 80px (profile) | Consistent avatar scale |
| Quick action icon container | 44px | Touch target |

---

## 4. Border Radius

| Element | Radius | Tailwind |
|---------|--------|----------|
| Cards | 16px | `rounded-2xl` |
| Tab bar pill | 36px | `rounded-[36px]` |
| Auth card / modal | 24px | `rounded-3xl` |
| Bottom sheet top corners | 24px | Custom style |
| Filter chips | 20px | `rounded-[20px]` |
| Preview card | 16px | `rounded-2xl` |
| Comment input | 16px | `rounded-2xl` |
| Buttons (standard) | 12px | `rounded-xl` |
| Input fields | 12px | `rounded-xl` |
| Search bar | 12px | `rounded-xl` |
| Photo containers (in card) | 12px top only | `rounded-t-xl` |
| Tooltip / Popover | 12px | `rounded-xl` |
| Badges / Tags | 8px | `rounded-lg` |
| Avatars | 9999px (circle) | `rounded-full` |

---

## 5. Shadows & Elevation

### 5.1 Shadow Catalog

The pen uses a more granular shadow system than 3 tiers. Shadows fall into three tint families:

- **Gold-tinted** (`#B47712` base): Cards, preview cards — warm brand feel
- **Neutral** (`#000000` base): Tab bar, search bar, dropdowns — unobtrusive chrome
- **Brand glow** (`#F5A623` base): Auth modal — dramatic emphasis

| Name | Offset | Blur | Color (hex+alpha) | Usage |
|------|--------|------|-------------------|-------|
| `card` | (0, 2) | 12 | `#B4771215` | Property cards, feed cards, comment cards |
| `card-alt` | (0, 2) | 12 | `#1A191808` | Cards on warm backgrounds (lighter shadow) |
| `preview` | (0, 4) | 20 | `#B4771220` | Floating preview cards, GroupPreviewCard |
| `tab-bar` | (0, 2) | 12 | `#00000010` | Floating tab bar pill |
| `search` | (0, 2) | 10 | `#00000012` | Search bar container |
| `dropdown` | (0, 4) | 16+4 | `#00000018`, `#00000010` | Search results dropdown (double shadow) |
| `auth-glow` | (0, 12) | 48 | `#F5A62330` | Auth modal card — gold glow effect |
| `bottom-sheet` | (0, -4) | 24 | `#B4771216` | Bottom sheet top edge |

### 5.2 Tailwind Extension (web only)

```js
boxShadow: {
  'card':         '0 2px 12px #B4771215',
  'card-alt':     '0 2px 12px #1A191808',
  'preview':      '0 4px 20px #B4771220',
  'tab-bar':      '0 2px 12px #00000010',
  'search':       '0 2px 10px #00000012',
  'dropdown':     '0 4px 16px #00000018, 0 1px 4px #00000010',
  'auth-glow':    '0 12px 48px #F5A62330',
  'bottom-sheet': '0 -4px 24px #B4771216',
},
```

### 5.3 Platform Shadow Helper (native)

`shadow-*` utility classes from the `boxShadow` Tailwind extension **only work on web**. NativeWind v4 does not translate `boxShadow` to React Native shadow/elevation props. Every component that needs shadows on native must use the `shadows.ts` helper with inline `style` props.

```ts
// src/lib/shadows.ts
import { Platform, type ViewStyle } from 'react-native';

export const shadows = {
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: '#B47712', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
    android: { elevation: 2 },
    default: {},
  }),
  'card-alt': Platform.select<ViewStyle>({
    ios: { shadowColor: '#1A1918', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 6 },
    android: { elevation: 1 },
    default: {},
  }),
  preview: Platform.select<ViewStyle>({
    ios: { shadowColor: '#B47712', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10 },
    android: { elevation: 6 },
    default: {},
  }),
  'tab-bar': Platform.select<ViewStyle>({
    ios: { shadowColor: '#000000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6 },
    android: { elevation: 4 },
    default: {},
  }),
  search: Platform.select<ViewStyle>({
    ios: { shadowColor: '#000000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 5 },
    android: { elevation: 3 },
    default: {},
  }),
  dropdown: Platform.select<ViewStyle>({
    ios: { shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.09, shadowRadius: 8 },
    android: { elevation: 8 },
    default: {},
  }),
  'auth-glow': Platform.select<ViewStyle>({
    ios: { shadowColor: '#F5A623', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.19, shadowRadius: 24 },
    android: { elevation: 12 },
    default: {},
  }),
  'bottom-sheet': Platform.select<ViewStyle>({
    ios: { shadowColor: '#B47712', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12 },
    android: { elevation: 8 },
    default: {},
  }),
} as const;
```

**Usage pattern**: Apply both web class and native style prop on every shadowed component:

```tsx
<View className="shadow-card" style={shadows.card}>
```

### 5.4 Backdrop Blur

Several pen components use background blur (glassmorphism):

| Component | Blur amount | Background |
|-----------|------------|------------|
| Tab bar pill | 20px | `rgba(255, 255, 255, 0.92)` |
| Search bar (on map) | 12px | `rgba(255, 255, 255, 0.95)` |
| Bottom sheet overlay | 8px | `rgba(0, 0, 0, 0.3)` |

**Web**: Use CSS `backdrop-filter: blur(Npx)` via Tailwind's `backdrop-blur-*` utilities.

**Native**: Install `expo-blur` and use `<BlurView>`:

```bash
npx expo install expo-blur
```

```tsx
import { BlurView } from 'expo-blur';

<BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill}>
  {/* Tab bar content */}
</BlurView>
```

**Note**: `expo-blur` is NOT currently installed. It must be added as part of implementation.

**Android caveat**: In Expo SDK 54 (expo-blur ~15.x), Android blur is experimental. The Samsung S10e debug device (Android 11 / SDK 30) uses RenderScript-based blur which may have performance limitations, or fall back to a semi-transparent overlay. Test blur-heavy components (tab bar, search bar, location button) on device. Stable Android blur (RenderNode API) arrives in SDK 55.

---

## 6. Icons

### 6.1 Library

Migrate from `@expo/vector-icons` (Ionicons + FontAwesome) to **Lucide** (`lucide-react-native`). Lucide provides a consistent, modern stroke-based icon set with both outlined and filled variants where needed.

```bash
npx expo install lucide-react-native react-native-svg
```

`react-native-svg` is a required peer dependency and is NOT currently installed — it must be added explicitly. Requires a native rebuild (`npx expo run:android`) after installation.

**One exception**: Phosphor Icons for the filled heart icon in comment reactions. Use `phosphor-react-native` for `HeartFill` only.

```bash
npx expo install phosphor-react-native
```

### 6.2 Icon Style Rules

| State | Style | Color |
|-------|-------|-------|
| Active tab | Lucide icon (stroke-width 2.5 or filled variant) | `#F5A623` (gold-500) |
| Inactive tab | Lucide icon (stroke-width 1.5) | `#C7BFB3` (warm-400) |
| Action icon (enabled) | Stroke-width 1.5 | `#504A42` (warm-700) |
| Action icon (disabled) | Stroke-width 1.5 | `#C7BFB3` (warm-400) |
| Heart (liked) | Phosphor `HeartFill` | `#FF6B35` (hot-red-500) |
| Heart (not liked) | Lucide `Heart` (stroke only) | `#C7BFB3` (warm-400) |
| Bookmark (saved) | Lucide `Bookmark` with `fill="currentColor"` | `#F5A623` (gold-500) |
| Bookmark (not saved) | Lucide `Bookmark` (stroke only) | `#C7BFB3` (warm-400) |

### 6.3 Icon Size Scale

Pen measurements use smaller defaults than the old spec.

| Size | px | Usage |
|------|-----|-------|
| `xs` | 14px | Inline with small/overline text, badge icons |
| `sm` | 16px | Inline with caption text, chip icons, comment action icons |
| `md` | 18px | **Standard** — quick action icons, list items, body-inline, send button |
| `lg` | 22px | Tab bar icons, header action buttons |
| `xl` | 28px | Empty state illustrations, large CTAs |
| `2xl` | 36px | Profile section icons, onboarding |

### 6.4 Tab Bar Icon Mapping

| Tab | Lucide icon | Inactive | Active |
|-----|-------------|----------|--------|
| Map | `Map` | stroke-width 1.5 | stroke-width 2.5 |
| Feed | `List` | stroke-width 1.5 | stroke-width 2.5 |
| Saved | `Bookmark` | stroke-width 1.5 | stroke-width 2.5 + fill |
| Profile | `User` | stroke-width 1.5 | stroke-width 2.5 |

### 6.5 Full Icon Catalog

Icons observed in the pen designs, mapped to Lucide names:

**Navigation & Chrome**:
- `ArrowLeft` — back navigation
- `X` — close/dismiss
- `Search` — search bar icon
- `Bell` — notifications
- `Settings` — settings gear
- `ChevronRight` — list item disclosure
- `ChevronDown` — dropdown indicator
- `MoreHorizontal` — overflow menu

**Property & Real Estate**:
- `Home` — property/house icon
- `MapPin` — location marker
- `Ruler` — floor area / square meters
- `Calendar` — year built
- `Bed` — bedrooms (where available)
- `Bath` — bathrooms (where available)
- `ExternalLink` — open listing in browser

**Social & Interaction**:
- `Heart` — like (outlined)
- `HeartFill` (Phosphor) — like (filled)
- `Bookmark` — save
- `MessageCircle` — comments
- `Share2` — share
- `Send` — send comment/message
- `ThumbsUp` — comment reaction
- `Flag` — report

**User & Profile**:
- `User` — profile, avatar placeholder
- `LogIn` — sign in
- `LogOut` — sign out
- `Award` — karma/achievements
- `Trophy` — leaderboard
- `Star` — rating/featured
- `Edit3` — edit profile

**Map & Location**:
- `Map` — map view
- `Navigation` — current location / compass
- `Plus` — zoom in
- `Minus` — zoom out
- `Layers` — map layer toggle
- `Filter` — filter toggle

**Status & Info**:
- `TrendingUp` — trending/hot
- `Clock` — recent/time
- `AlertCircle` — warning/error
- `Info` — informational
- `CheckCircle` — success/verified
- `Eye` — view count

### 6.6 Migration Notes

When replacing `@expo/vector-icons` with Lucide:

1. **Import change**: `import { Ionicons } from '@expo/vector-icons'` becomes `import { IconName } from 'lucide-react-native'`
2. **Props change**: `<Ionicons name="map-outline" size={24} color="#ccc" />` becomes `<Map size={24} color="#ccc" strokeWidth={1.5} />`
3. **No filled/outline variants**: Lucide uses a single component per icon. Control visual weight via `strokeWidth` (1.5 for light/inactive, 2 or 2.5 for bold/active) and `fill` prop for filled appearance.
4. **Do not remove `@expo/vector-icons`** from `package.json` until all icon references are migrated. Expo Router's tab bar may still use it internally.


## 7. Component Design Tokens

This section specifies every UI component with pixel-precise values extracted from the finalized Pen design file. All components use the color palette from Section 1, the typography from Section 2, and the spacing/radius/shadow scales from Sections 3-5.

**Font families**: Inter (primary UI), Outfit (accent for titles and prices), DM Sans (search results). **Icon library**: Lucide (replaces Ionicons/FontAwesome from the old spec).

---

### 7.1 Tab Bar (Floating Pill)

The tab bar is a **floating translucent pill** — not a standard flat tab bar. This requires a fully custom `tabBar` component for Expo Router, replacing the platform default entirely.

**Outer wrapper (safe area container)**:

| Property | Value | Notes |
|----------|-------|-------|
| Padding | `[12, 21, 21, 21]` (top, right, bottom, left) | Accounts for safe area inset at bottom |

**Pill container**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 62px | Fixed |
| Corner radius | 36px | Fully rounded ends |
| Padding (internal) | 4px | Between pill edge and tab capsules |
| Fill (map screen) | `#FFFFFFCC` | 80% white, translucent over map |
| Fill (other screens) | `#FFFFFF` | Solid white on cream backgrounds |
| Stroke | 1px inside, `$warm-200` (`#F5F0E8`) | Subtle inner border |
| Backdrop blur | radius 20 | `expo-blur` (BlurView) on native, `backdrop-filter: blur(20px)` on web |
| Shadow | outer, blur 12, color `#00000010`, offset (0, 2) | Soft float shadow |
| Layout | Horizontal, items fill equally | Flex row |

**Tab item (inactive)**:

| Property | Value | Notes |
|----------|-------|-------|
| Layout | Vertical center | Icon above label |
| Corner radius | 26px | Capsule shape (never visible without fill) |
| Gap | 4px | Between icon and label |
| Fill | None (transparent) | |
| Icon | Lucide, 18px, `$warm-400` (`#C7BFB3`) | |
| Label | Inter 10/600, letterSpacing 0.5, uppercase, `$warm-400` | |

**Tab item (active)**:

| Property | Value | Notes |
|----------|-------|-------|
| Fill | `$gold-500` (`#F5A623`) | Gold capsule background |
| Corner radius | 26px | |
| Icon | Lucide, 18px, `#FFFFFF` | White on gold |
| Label | Inter 10/600, letterSpacing 0.5, uppercase, `#FFFFFF` | White on gold |

**Tab icon mapping** (Lucide names):

| Tab | Icon name |
|-----|-----------|
| Map | `map` |
| Feed | `list` |
| Saved | `bookmark` |
| Profile | `user` |

**Implementation notes**:
- This is NOT Expo Router's default tab bar. Requires a fully custom `tabBar` component prop on `<Tabs>`.
- Backdrop blur on native requires `expo-blur` (`BlurView`). On web, use CSS `backdrop-filter: blur(20px)`.
- On the map screen the pill is translucent (`#FFFFFFCC`); on Feed, Saved, Profile it is opaque (`#FFFFFF`).
- Update `Colors.ts`: `tint: '#F5A623'`, `tabIconDefault: '#C7BFB3'`.
- Font migration: From Ionicons/FontAwesome to **Lucide** (`lucide-react-native`).

---

### 7.2 Search Bar

**Container**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 48px | Outer wrapper |
| Padding | `[0, 16]` (vertical, horizontal) | Centers the input field |
| Layout | Horizontal center | |

**Input field (inactive/unfocused)**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 44px | |
| Corner radius | 12px | |
| Fill | `#FFFFFFCC` | Translucent white (over map) |
| Stroke | 1px inside, `$warm-300` (`#E8E0D4`) | |
| Padding | `[0, 14]` (vertical, horizontal) | |
| Gap | 10px | Between icon, text, and mic icon |
| Backdrop blur | radius 15 | |
| Shadow | blur 10, color `#00000012`, offset (0, 2) | |
| Search icon | Lucide `search`, 18px, `$warm-400` (`#C7BFB3`) | Left side |
| Placeholder | Inter 14/400, `$warm-400` (`#C7BFB3`), "Search address..." | |
| Mic icon | Lucide `mic`, 18px, `$warm-400` (`#C7BFB3`) | Right side |

**Input field (active/focused)**:

| Property | Value | Notes |
|----------|-------|-------|
| Fill | `#FFFFFF` | Solid white |
| Stroke | 2px inside, `$gold-400` (`#F7C948`) | Gold focus ring |
| Shadow | blur 8, color `#F7C94830`, offset (0, 0) | Gold glow effect |
| Search icon | Lucide `search`, 18px, `$gold-500` (`#F5A623`) | Turns gold |
| Text | DM Sans 14/400, `$warm-900` (`#2D2926`) | |
| Clear button | Lucide `x`, 16px, `$warm-400` (`#C7BFB3`) | Appears when text present |

---

### 7.3 Search Dropdown

| Property | Value | Notes |
|----------|-------|-------|
| Width | 370px | Fixed, or `screen - 32px` on narrow screens |
| Position | x=16, y=158 (below search bar) | Absolute positioned |
| Corner radius | 12px | |
| Fill | `#FFFFFF` | Solid white |
| Clip | true | Clips children to rounded corners |
| Shadow (primary) | blur 16, color `#B4771220`, offset (0, 4) | Warm gold shadow |
| Shadow (secondary) | blur 4, color `#00000008`, offset (0, 1) | Subtle depth |

**Result row**:

| Property | Value | Notes |
|----------|-------|-------|
| Layout | Horizontal, vertically centered | |
| Gap | 12px | Between icon and text |
| Padding | `[14, 16]` (vertical, horizontal) | |
| Pin icon | Lucide `map-pin`, 20px, `$gold-500` (`#F5A623`) | |
| Address text | DM Sans 14/500, `$warm-900` (`#2D2926`) | |
| City text | DM Sans 12/400, `$warm-500` (`#9C958A`) | Below address |
| Divider | 1px, `$warm-200` (`#F5F0E8`) | Between rows, full width |

---

### 7.4 Feed Filter Chips

**Container**:

| Property | Value | Notes |
|----------|-------|-------|
| Layout | Horizontal, center-aligned | Horizontal scroll |
| Gap | 10px | Between chips |
| Padding | `[0, 20]` (vertical, horizontal) | |

**Active chip**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 20px | Pill shape |
| Fill | `$gold-500` (`#F5A623`) | |
| Padding | `[8, 16]` (vertical, horizontal) | |
| Gap | 6px | Between emoji/icon and text |
| Text | Inter 13/600, `#FFFFFF` | |
| Emoji | Inline prefix for "Trending" chip (fire emoji) | |

**Inactive chip**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 20px | |
| Fill | `#FFFFFF` | |
| Stroke | 1px, `$warm-300` (`#E8E0D4`) | |
| Padding | `[8, 16]` (vertical, horizontal) | |
| Text | Inter 13/500, `$warm-700` (`#504A42`) | |

**Overflow indicator**: `"..."` in Inter 18/700, `$warm-400` (`#C7BFB3`).

---

### 7.5 Feed Card

**Container**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 16px | |
| Fill | `#FFFFFF` | White card on cream `$warm-50` background |
| Clip | true | Clips image to top corners |
| Shadow | blur 12, color `#B4771215`, offset (0, 2) | Warm-tinted card shadow |

**Image section**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 180px | |
| Width | Fill container | |
| Fill mode | Cover | Aspect-fill |

**Body section**:

| Property | Value | Notes |
|----------|-------|-------|
| Padding | `[14, 16, 16, 16]` (top, right, bottom, left) | |
| Gap | 8px | Between child elements |

**Address row** (space-between layout):

| Property | Value | Notes |
|----------|-------|-------|
| Street | Inter 16/600, `$warm-900` (`#2D2926`) | |
| City | Inter 13/400, `$warm-500` (`#9C958A`) | Below street |

**"Hot" activity badge**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 8px | |
| Fill | `$hot-red` (`#FF6B35`) | |
| Padding | `[4, 8]` (vertical, horizontal) | |
| Gap | 4px | Between flame icon and text |
| Icon | Lucide `flame`, 12px, `#FFFFFF` | |
| Text | Inter 11/600, `#FFFFFF` | |

**Price row** (space-between layout):

| Property | Value | Notes |
|----------|-------|-------|
| Left side | "Asking Price" Inter 13/400 `$warm-500` + formatted price | |
| Right side | Lucide `house` 14px `$gold-500` + price Inter 16/700 `$warm-900` | House icon inline before price |

**Stats section**:

| Property | Value | Notes |
|----------|-------|-------|
| Divider | 1px, `$warm-200` (`#F5F0E8`) | Above stats row |
| Layout | Horizontal, evenly distributed pills | |

**Stat pill** (each):

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 10px | |
| Padding | `[3, 7]` (vertical, horizontal) | |
| Gap | 4px | Between icon and count |
| Width | Fill container (flex) | |
| Likes | bg `#E91E6315`, icon + text in matching `#E91E63` | Pink tint |
| Comments | bg `#42A5F515`, icon + text in matching `#42A5F5` | Blue tint |
| Guesses | bg `#4CAF5015`, icon + text in matching `#4CAF50` | Green tint |
| Views | bg `#F5A62315`, icon + text in matching `#F5A623` | Gold tint |

---

### 7.6 Preview Card (Map Overlay)

The preview card is geo-anchored to a map feature with an arrow pointer.

**Wrapper**: Vertically centered alignment.

**Card**:

| Property | Value | Notes |
|----------|-------|-------|
| Width | 270px | Fixed |
| Corner radius | 16px | |
| Fill | `#FFFFFF` | |
| Clip | true | |
| Shadow | blur 20, color `#B4771220`, offset (0, 4) | Stronger float shadow |

**Image section**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 100px | |
| Width | 270px (fill card) | |

**Close button** (absolute positioned):

| Property | Value | Notes |
|----------|-------|-------|
| Position | x=238, y=5 (top-right inset) | Absolute inside image |
| Size | 26x26px | |
| Corner radius | 13px (circle) | |
| Fill | `#FFFFFFCC` | Translucent white |
| Stroke | 1px inside, `$warm-200` (`#F5F0E8`) | |
| Backdrop blur | radius 12 | |
| Shadow | blur 4, color `#00000012` | |
| Icon | Lucide `x`, 14px, `$warm-700` (`#504A42`) | |

**Body section**:

| Property | Value | Notes |
|----------|-------|-------|
| Padding | `[8, 12, 2, 12]` (top, right, bottom, left) | |
| Gap | 2px | Tight vertical spacing |

**Address**: Inter 15/600, `$warm-900` (`#2D2926`).

**Active badge**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 10px | |
| Fill | `#E8F5E920` (very light green, 12% opacity) | |
| Padding | `[3, 8]` (vertical, horizontal) | |
| Gap | 5px | Between dot and text |
| Dot | 7px circle, `#4CAF50` | |
| Text | Inter 11/500, `#4CAF50` | |

**City**: Inter 13/400, `$warm-500` (`#9C958A`).

**Price row**:

| Property | Value | Notes |
|----------|-------|-------|
| Gap | 5px | Between price elements |
| Padding | `[2, 0, 0, 0]` (top only) | |
| Crowd price pill | cornerRadius 10, fill `#F5A62318`, padding `[3, 7]`, Lucide `heart` 14px `$gold-500`, value Inter 13/600 `$gold-600` (`#DE911D`) | |
| Separator | `"\|"` character, `$warm-300` (`#E8E0D4`) | |
| Comment count | cornerRadius 10, fill `#42A5F518`, Lucide `message-circle` 14px `$info-blue` (`#42A5F5`), text Inter 13/600 `#1E88E5` | |
| House price | Lucide `house` 14px `$gold-500`, Inter 15/700 `$warm-900` | |

**Quick actions row**:

| Property | Value | Notes |
|----------|-------|-------|
| Divider | `$warm-200` (`#F5F0E8`), 1px | Above actions |
| Layout | Horizontal, space-around | |
| Padding | `[10, 0, 12, 0]` (top, right, bottom, left) | |

**Action buttons**:

| Action | Icon | Icon size | Icon color | Count font | Count color |
|--------|------|-----------|------------|------------|-------------|
| Like | Lucide `heart` | 18px | `#BEA3AB` | Inter 13/600 | `#BEA3AB` |
| Comment | Lucide `message-circle` | 18px | `#9DB3A5` | Inter 13/600 | `#9DB3A5` |
| Guess | Lucide `tag` | 18px | `#B8B89A` | Inter 13/600 | `#B8B89A` |

**Arrow pointer**:

| Property | Value | Notes |
|----------|-------|-------|
| Size | 20px wide x 10px tall | Triangle pointing down |
| Fill | `#FFFFFF` | Matches card background |
| Shadow | blur 4, color `#00000018`, offset (0, 2) | Seamless blend with card shadow |

---

### 7.7 Property Detail Page

**BREAKING CHANGE**: The property detail is now a **full-page scroll view**, not a bottom sheet. All bottom-sheet-specific tokens (pull handle, snap points, sheet shadow, top corner radius) from the old spec are removed.

**Hero section**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 240px | Full-width image |
| Clip | true | |

**Overlay buttons** (absolute positioned, circular):

| Property | Value | Notes |
|----------|-------|-------|
| Size | 36x36px | |
| Corner radius | 18px (circle) | |
| Fill | `#00000040` | 25% black |
| Backdrop blur | radius 12 | |

| Button | Icon | Icon size | Color | Position |
|--------|------|-----------|-------|----------|
| Back | Lucide `chevron-left` | 20px | `#FFFFFF` | x=16, y=16 |
| Share | Lucide `share-2` | 18px | `#FFFFFF` | x=306, y=16 |
| Like | Lucide `heart` | 18px | `#FFFFFF` | x=350, y=16 |

**Photo count badge**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 100 (full pill) | |
| Fill | `#00000040` | |
| Backdrop blur | radius 12 | |
| Icon | Lucide `camera`, 14px, `#FFFFFF` | |
| Text | Outfit 12/600, `#FFFFFF` | |

**Content area**:

| Property | Value | Notes |
|----------|-------|-------|
| Padding | `[16, 16, 24, 16]` (top, right, bottom, left) | |
| Gap | 20px | Between major sections |

**Address + Price section** (gap 16):

| Property | Value | Notes |
|----------|-------|-------|
| Street | Outfit 22/600, `$warm-900` (`#2D2926`), letterSpacing -0.3 | |
| City | Outfit 15/500, `$warm-600` (`#736C62`) | |

**Info pills** (year built, area, views):

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 100 (full pill) | |
| Fill | `$warm-200` (`#F5F0E8`) | |
| Padding | `[4, 10]` (vertical, horizontal) | |
| Gap | 4px | Between icon and text |
| Icons | Lucide (`calendar` / `ruler` / `eye`), 13px, `$warm-500` (`#9C958A`) | |
| Text | Outfit 12/500, `$warm-700` (`#504A42`) | |

**Crowd Estimate card**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 16px | |
| Fill | `#FFFFFF` | |
| Shadow | blur 12, color `#1A191808` | Very subtle |
| Price value | Outfit 32/700, `#3D8A5A`, letterSpacing -1 | Green for consensus |
| Confidence badge | cornerRadius 100, fill `#C8F0D8` | Light green pill |

**WOZ + Asking price cards** (side-by-side):

| Property | Value | Notes |
|----------|-------|-------|
| Gap | 12px | Between the two cards |
| Card style | Same as Crowd Estimate (cornerRadius 16, white, shadow) | |

**Price comparison bar**:

| Property | Value | Notes |
|----------|-------|-------|
| Track height | 6px | |
| Track corner radius | 3px | |
| Track gradient | `$warm-300` (`#E8E0D4`) to `$warm-200` (`#F5F0E8`) | Subtle warm gradient |

**Dot markers on comparison bar**:

| Marker | Size | Fill | Stroke |
|--------|------|------|--------|
| WOZ | 12px circle | `#1A1918` | 2px white |
| Crowd | 12px circle | `#4CAF50` | 2px white |
| Asking | 12px circle | `$gold-500` (`#F5A623`) | 2px white |
| User guess | 12px circle | `$info-blue` (`#42A5F5`) | 2px white |

**Listings section**:

| Property | Value | Notes |
|----------|-------|-------|
| Card corner radius | 12px | |
| Stroke | 1px, `$warm-200` (`#F5F0E8`) | |
| Padding | 14px | |
| Gap | 12px | Between listing rows |

**Source circles**:

| Source | Size | Background |
|--------|------|------------|
| Funda | 40px circle | `#FFF3C4` (warm yellow) |
| Pararius | 40px circle | `#E3F2FD` (light blue) |

**Comments section**:

| Property | Value | Notes |
|----------|-------|-------|
| Card corner radius | 16px | |
| Shadow | warm-sm | |
| Padding | 14px | |
| Gap | 10px | Between comments |

**Karma badges** (inline with username):

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 100 (full pill) | |
| Fill | `#FFF3C4` (`$gold-100`) | |
| Text | Inter 10/600, `$gold-700` (`#B47712`) | |

**Comment text**: Outfit 14/400, `#6D6C6A`, lineHeight 1.5.

**Send button** (comment input):

| Property | Value | Notes |
|----------|-------|-------|
| Size | 34px circle | |
| Fill | `$gold-500` (`#F5A623`) | |
| Icon | Lucide `send`, 16px, `#FFFFFF` | |

**Property Info section**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 14px | |
| Stroke | 1px, `$warm-200` (`#F5F0E8`) | |

**Action row** (bottom of page):

| Property | Value | Notes |
|----------|-------|-------|
| Layout | Horizontal | |
| Gap | 12px | Between action buttons |
| Button corner radius | 12px | |
| Button stroke | 1px, `$warm-300` (`#E8E0D4`) | |
| Button padding | `[12, 8]` (vertical, horizontal) | |
| Button layout | Vertical center | |
| Button gap | 6px | Between icon and label |
| Icon size | 22px | |
| Label | Outfit 13/500 | |

---

### 7.8 Comments Page (Full Screen)

Full-screen comments view, no tab bar visible.

**Layout**: Vertical, full height (868px design frame).

**Header** (56px):

| Property | Value | Notes |
|----------|-------|-------|
| Padding | `[0, 16]` (vertical, horizontal) | |
| Gap | 12px | Between elements |

| Element | Spec | Notes |
|---------|------|-------|
| Back button | 32x32 circle, Lucide `arrow-left` 20px, `$warm-800` (`#3D3832`) | |
| Property thumbnail | 48x36px, cornerRadius 6, image fill | |
| Address | Inter 14/600, `$warm-900` (`#2D2926`) | |
| City | Inter 12/400, `$warm-500` (`#9C958A`) | |

**Sort toggle**:

| Property | Value | Notes |
|----------|-------|-------|
| Container corner radius | 12px | |
| Container fill | `#EDECEA` | Light warm gray |
| Container padding | 3px | |
| Gap | 2px | Between pills |

| State | Fill | Padding | Text |
|-------|------|---------|------|
| Active pill | `$gold-400` (`#F7C948`), cornerRadius 14 | `[5, 12]` | Inter 12/600, `$warm-900` |
| Inactive pill | `$warm-200` (`#F5F0E8`) | `[5, 12]` | Inter 12/500, `$warm-600` (`#736C62`) |

**Comment item**:

| Property | Value | Notes |
|----------|-------|-------|
| Layout | Horizontal | |
| Gap | 10px | Between avatar and content |

| Element | Spec |
|---------|------|
| Avatar | 34x34 circle, colored backgrounds (see 7.18), initial letter Inter 14/700 |
| Name | Inter 13/600, `$warm-900` (`#2D2926`) |
| Karma badge | cornerRadius 100, fill `#FFF3C4`, padding `[2, 8]`, Inter 10/600 `$gold-700` |
| Timestamp | Inter 11/400, `$warm-400` (`#C7BFB3`) |
| Comment text | Inter 13/400, `$warm-800` (`#3D3832`), lineHeight 1.45 |
| Reply link | Inter 13/500, `$warm-500` (`#9C958A`) |
| Heart (unfilled) | Lucide `heart`, 16px, `$warm-400` (`#C7BFB3`) |
| Heart (filled/liked) | Phosphor `heart-fill`, 18px, `$hot-red` (`#FF6B35`) |

**Reply thread**:

| Property | Value | Notes |
|----------|-------|-------|
| Padding-left | 16px | Indentation for nested replies |
| Left border | 2px solid, `$warm-300` (`#E8E0D4`) | Visual thread indicator |

**Input bar** (pinned to bottom):

| Property | Value | Notes |
|----------|-------|-------|
| Height | 70px | |
| Fill | `#FFFFFF` | |
| Stroke (top) | 1px, `$warm-200` (`#F5F0E8`) | Separator from content |
| Padding | `[10, 16]` (vertical, horizontal) | |
| Gap | 10px | Between avatar, input, send button |

| Element | Spec |
|---------|------|
| Avatar | 32x32, cornerRadius 16 (circle) |
| Input container | cornerRadius 100 (full pill), fill `$warm-50` (`#FFFBF5`), stroke 1px `$warm-200`, padding `[0, 14]`, height 38px |
| Placeholder | Inter 13/400, `$warm-400` (`#C7BFB3`) |
| Send button | 34x34 circle, fill `$gold-500` (`#F5A623`), Lucide `send` 16px `#FFFFFF` |

---

### 7.9 Price Guesses Page

Full-screen view, no tab bar.

**Header** (48px):

| Property | Value | Notes |
|----------|-------|-------|
| Padding | `[0, 16]` | |
| Gap | 12px | |
| Back button | 36x36 circle, fill `$warm-100` (`#FFF8F0`), Lucide `arrow-left` 20px `$warm-700` | |
| Title | Inter 18/600, `$warm-900`, letterSpacing -0.2, "Price Guesses" | |

**Image card**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 150px | |
| Corner radius | 16px | |
| Image | Cover fill | |
| Gradient overlay | Bottom-up, transparent to `#00000060` | For text readability |
| Address text | Inter 15/600, `#FFFFFF` | Over gradient |
| Postal text | Inter 12/400, `#FFFFFFCC` | Below address |

**Crowd estimate card**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 16px | |
| Fill | `#FFFFFF` | |
| Shadow | warm-md | |
| Padding | 16px | |
| Gap | 14px | |
| Diff badge | cornerRadius 100 (pill), fill `#FFF3C4`, padding `[4, 10]` | |

**Distribution card**: Same card style as crowd estimate. Bar charts use `$gold-500` fills on `$warm-100` (`#FFF8F0`) background.

**Recent guesses list**:

| Property | Value | Notes |
|----------|-------|-------|
| Entry corner radius | 12px | |
| Shadow | blur 6 | Subtle |
| Accurate icon | Lucide `circle-check`, `$crowd-green` (`#4CAF50`) | |
| Inaccurate icon | Lucide `circle-alert`, `$warning-orange` (`#FF9500`) | |

**CTA bar** (sticky bottom):

| Property | Value | Notes |
|----------|-------|-------|
| Fill | `$warm-50` (`#FFFBF5`) | |
| Shadow | upward, warm-md | Shadow casts upward |
| Padding | `[12, 20, 20, 20]` | |
| Button corner radius | 14px | |
| Button fill | `$gold-500` (`#F5A623`) | |
| Button height | 50px | |
| Button icon | Lucide `target`, 18px, `#FFFFFF` | |
| Button text | Inter 16/600, `#FFFFFF` | "Make Your Guess" |

---

### 7.10 Social Notifications Page

Full-screen view, no tab bar.

**Header**:

| Property | Value | Notes |
|----------|-------|-------|
| Padding | `[16, 24, 12, 24]` | |
| Title | Inter 26/700, `$warm-900`, letterSpacing -0.5, "Notifications" | |
| "Mark all read" | Inter 14/500, `$gold-700` (`#B47712`) | Right-aligned action |

**Section labels** (Today, This Week, Earlier):

| Property | Value | Notes |
|----------|-------|-------|
| Font | Inter 13/600, `$warm-500`, letterSpacing 0.3, uppercase | |
| Padding | `[0, 24, 8, 24]` | |

**Notification item**:

| Property | Value | Notes |
|----------|-------|-------|
| Layout | Horizontal | |
| Gap | 12px | |
| Padding | `[12, 24]` (vertical, horizontal) | |

| State | Background | Indicator |
|-------|------------|-----------|
| Unread | `$warm-100` (`#FFF8F0`) | 8px gold dot (`$gold-500`) |
| Read | None (transparent) | No dot |

| Element | Spec |
|---------|------|
| Thumbnail | 48x48px, cornerRadius 8 |
| Description | Inter 14/500, `$warm-800` (`#3D3832`), lineHeight 1.35 |
| Timestamp | Inter 12/400, `$warm-400` (`#C7BFB3`) |

---

### 7.11 Community Leaderboard Page

Full-screen view, no tab bar.

**Header** (44px):

| Property | Value | Notes |
|----------|-------|-------|
| Padding | `[0, 20]` | |
| Layout | Space-between | |
| Trophy icon | Lucide `trophy`, 22px, `$gold-500` | Left of title |
| Title | Outfit 22/600, `$warm-900`, letterSpacing -0.3, "Leaderboard" | |
| Period filter | cornerRadius 12, fill `$warm-100`, padding `[6, 12]`, Inter 12/500 `$warm-600` | Dropdown trigger |

**Featured card** ("Most Discussed This Week"):

| Property | Value | Notes |
|----------|-------|-------|
| Height | 180px | |
| Corner radius | 16px | |
| Image | Cover fill, gradient overlay | |
| Text | Inter 15/600, `#FFFFFF` | Over gradient |

**Podium section**:

**1st place**:

| Property | Value | Notes |
|----------|-------|-------|
| Card corner radius | 16px | |
| Fill | `#FFFFFF` | |
| Shadow | warm-md | |
| Crown | Lucide `crown`, 20px, `$gold-500` | Above avatar |
| Avatar | 52px circle, 2px stroke `$gold-400` | |
| Name | Inter 14/700 | |
| Badge | fill `#FFF3C4` | Karma tier badge |
| Points | Inter 12/600, `$gold-600` (`#DE911D`) | |

**2nd and 3rd place**:

| Property | Value | Notes |
|----------|-------|-------|
| Avatar | 44px circle, no stroke | Smaller than 1st |
| Name | Inter 13/600 | |
| Style | Same card but smaller, no crown | |

**Rankings list**:

| Property | Value | Notes |
|----------|-------|-------|
| Row corner radius | 12px | |
| Row padding | `[10, 12]` | |
| Rank number | Inter 14/600, `$warm-400` | |
| Avatar | 36px circle | |
| Name | Inter 13/600 | |
| Badge | Karma tier badge | |
| Points | Inter 13/700, `$warm-700` | |

**"Your Rank" row** (highlighted):

| Property | Value | Notes |
|----------|-------|-------|
| Fill | `#FFFBEB` (`$gold-50`) | Gold tint background |
| Stroke | 1px, `$gold-200` (`#FCE588`) | |
| Rank + points text | `$gold-600` (`#DE911D`) | Gold-tinted text |

---

### 7.12 Social Activity Feed

Same structural layout as Feed (section 7.5) with a different card format.

**Header**: "Recent Activity" Inter 22/700, `$warm-900`.

**Filter**: "Recent Activity" chip active (gold).

**Activity card**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 16px | |
| Fill | `#FFFFFF` | |
| Shadow | blur 12, color `#1A191810`, offset (0, 2) | |
| Clip | true | |
| Photo height | 200px | |
| Content padding | `[14, 16]` | |
| Content gap | 12px | |

**User row**: Avatar 36px + name Inter 14/600 `$warm-800` + timestamp Inter 12/400 `$warm-500`.

**Action badges** (pill-shaped):

| Action | Fill | Icon + text color |
|--------|------|-------------------|
| Liked | `#FFF0F0` | `$error-red` (`#E53935`) |
| Commented | `#EFF6FF` | `$info-blue` (`#42A5F5`) |
| Guessed | `#ECFDF5` | `$crowd-green` (`#4CAF50`) |

**Metrics row**: Lucide `heart` 15px `$warm-400` + count, Lucide `message-circle` 15px `$info-blue` + count.

---

### 7.13 Auth Modal

**Backdrop**:

| Property | Value | Notes |
|----------|-------|-------|
| Fill | `$warm-900` at 75% (`#2D2926BF`) | |
| Status bar | White text | Light content mode |

**Card**:

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 24px | |
| Fill | `#FFFFFF` | |
| Padding | `[20, 28, 28, 28]` (top, right, bottom, left) | |
| Gap | 16px | Between child elements |
| Width | ~320px (screen width - 82px) | |

**Shadows** (dual-layer):

| Layer | Blur | Color | Offset |
|-------|------|-------|--------|
| Gold glow | 48 | `#F5A62330` | (0, 12) |
| Depth | 16 | `#00000012` | (0, 4) |

**Close button**:

| Property | Value | Notes |
|----------|-------|-------|
| Size | 36x36px | |
| Corner radius | 18px (circle) | |
| Fill | `#F4F4F5` | Intentionally cool gray (see note below) |
| Icon | Lucide `x`, 18px, `#71717A` | Cool gray icon — matches auth modal's intentional cool gray aesthetic (Section 1.6) |

**Logo**: 64x64px, cornerRadius 16.

**Title**: "Welcome to HuisHype" Outfit 20/600, `$warm-900`.

**Subtitle**: Inter 14/400, `$warm-500`, lineHeight 1.4, center-aligned.

**Google button**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 52px | |
| Corner radius | 12px | |
| Fill | `#FFFFFF` | |
| Stroke | 1px, `#E4E4E7` | Cool gray border (intentional) |
| Icon | Google "G" logo, 22px | |
| Text | Inter 15/500, `$warm-700` | |

**Apple button**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 52px | |
| Corner radius | 12px | |
| Fill | `#1A1A1A` | Near-black (intentional cool) |
| Icon | Apple logo, 20px, `#FFFFFF` | |
| Text | Inter 15/500, `#FFFFFF` | |

**Divider**: Lines `#E4E4E7` with "or" Inter 13/400 `$warm-500` centered between.

**Email button**:

| Property | Value | Notes |
|----------|-------|-------|
| Height | 44px | |
| Corner radius | 10px | |
| Fill | `$gold-50` (`#FFFBEB`) | |
| Stroke | 1px, `$gold-400` (`#F7C948`) | |
| Icon | Lucide `mail`, 16px, `$gold-700` (`#B47712`) | |
| Text | Inter 14/500, `$gold-700` (`#B47712`) | |

> **Design intent**: The close button and auth provider buttons intentionally use cool grays (`#F4F4F5`, `#E4E4E7`, `#1A1A1A`) rather than the warm system. This matches the platform-native feel of Google and Apple sign-in UI. This is a deliberate departure from the warm palette used everywhere else.

---

### 7.14 Location Button (Map Screen)

| Property | Value | Notes |
|----------|-------|-------|
| Size | 44x44px | Meets touch target minimum |
| Corner radius | 22px (circle) | |
| Fill | `#FFFFFFDD` | ~87% white, translucent |
| Position | Bottom-right of map viewport | |
| Backdrop blur | radius 12 | |
| Shadow (primary) | blur 8, color `#00000018` | |
| Shadow (secondary) | blur 3, color `#00000010` | |
| Icon | Lucide `locate`, 22px, `$warm-700` (`#504A42`) | |

---

### 7.15 Map Screen Gradients

**Top gradient** (fades header/search area):

| Property | Value | Notes |
|----------|-------|-------|
| Height | 180px | |
| Direction | Linear 180deg (top to bottom) | |
| From | `#FFFFFFBB` (~73% white) | |
| To | `#FFFFFF00` (transparent) | |

**Bottom gradient** (fades into tab bar area):

| Property | Value | Notes |
|----------|-------|-------|
| Height | 140px | |
| Position | y=734 (bottom of viewport) | |
| Direction | Linear 180deg (top to bottom) | |
| From | `#FFFFFF00` (transparent) | |
| To | `#FFFFFFCC` (~80% white) | |

---

### 7.16 Notification Bell Badge

| Property | Value | Notes |
|----------|-------|-------|
| Bell icon | Lucide `bell`, 22px, `$warm-700` (`#504A42`) | |
| Button size | 32x32px, cornerRadius 16 (circle) | |
| Red dot size | 8px circle | |
| Red dot color | `#EF4444` | Standard notification red |
| Red dot position | Absolute, x=22, y=2 (top-right of bell) | |
| Red dot glow | Shadow blur 4, color `#EF444440` | Optional pulsing glow |

---

### 7.17 Karma / Rank Badges

**Inline pill** (used next to usernames):

| Property | Value | Notes |
|----------|-------|-------|
| Corner radius | 100 (full pill) | |
| Fill | `$gold-100` (`#FFF3C4`) | Default; tier-specific colors per Section 1.8 |
| Padding (small) | `[2, 8]` (vertical, horizontal) | Comments, compact contexts |
| Padding (medium) | `[3, 8]` | Leaderboard, profile |
| Padding (large) | `[4, 12]` | Featured/hero contexts |
| Text | Inter 10-11/600, `$gold-700` (`#B47712`) | Default; tier-specific text per Section 1.8 |

**Rank names** (Dutch, from API): "Nieuwkomer", "Bewoner", "Kenner", "Specialist", "Meester", "Legende".

---

### 7.18 User Avatars

Letter-based circles with warm-toned backgrounds. The background color is deterministically derived from the username hash.

**Avatar background palette**:

| Index | Hex | Hue |
|-------|-----|-----|
| 0 | `#E8D5C4` | Warm peach |
| 1 | `#D5C4E8` | Soft purple |
| 2 | `#C4D5E8` | Soft blue |
| 3 | `#E8C4C4` | Soft rose |
| 4 | `#D89575` | Terra cotta |
| 5 | `#42A5F5` | Blue |
| 6 | `#7B8EC2` | Slate blue |
| 7 | `#F7C948` | Gold |

**Size scale**:

| Context | Diameter | Letter font |
|---------|----------|-------------|
| Comments | 34px | Inter 14/700 |
| Social / Leaderboard | 36px | Inter 14/700 |
| Podium (2nd/3rd) | 44px | Inter 16/700 |
| Podium (1st) | 52px | Inter 18/700 |
| Profile | 72px | Inter 24/700 |

**Letter color**: A darker shade derived from the avatar background (typically 40% darker), ensuring readability.

---

### 7.19 Price Visualization Bar (FMVVisualization)

Replace current blue distribution bar with gold-warm palette:

| Element | Old Value | New Value |
|---------|-----------|-----------|
| P10-P90 range fill | `bg-blue-100` | `#FFF3C4` (`$gold-100`) |
| P25-P75 IQR fill | `bg-blue-300` | `#F7C948` (`$gold-400`) |
| Median marker | `bg-primary-700` | `#DE911D` (`$gold-600`) |
| Analytics icon | `#3B82F6` | `#F5A623` (`$gold-500`) |
| FMV value text | `text-primary-600` | `$gold-500` |
| User guess marker | `#4CAF50` | `#4CAF50` (unchanged) |
| Asking price marker | `#FF9500` | `#FF9500` (unchanged) |

---

### 7.20 Price Guess Slider

| Property | Value | Notes |
|----------|-------|-------|
| Track background | `$warm-300` (`#E8E0D4`) | |
| Track fill (left of thumb) | Green gradient `#C8F0D8` → `#3D8A5A` | Crowd consensus theme (green, not gold) |
| Thumb size | 28px circle | |
| Thumb color | White with `#3D8A5A` stroke | |
| Thumb border | 3px `#3D8A5A` | |
| Thumb shadow | warm-md | |
| Thumb (dragging) | Scale 1.15x | |
| Price label | Floating pill above thumb, warm-sm shadow | |
| Price label text | Outfit 17/600, `$warm-900` | |
| Reference markers | Small dots on track | WOZ: `#D89575` (warm coral), Asking: `#9C9B99`, FMV: `$gold-500` |
| Submit button | Full width, 50px height, cornerRadius 14, fill `#3D8A5A`, Lucide `target` 18px white + Inter 16/600 `#FFFFFF` | Green "Submit Your Guess" per pen |
| Submit disabled | Fill `$warm-300`, text `$warm-400` | |

---

## 8. Screen-by-Screen Visual Spec

Each screen is described as a vertical stack of elements from top to bottom, specifying exact layout, positioning, and component composition. Token references point back to Section 7.

---

### 8.1 Map Screen

The primary screen. A full-bleed map canvas with floating UI overlays.

| Layer | Element | Spec |
|-------|---------|------|
| Background | Map canvas | Custom OpenFreeMap Positron tiles with enhanced vegetation |
| Status bar | Dark icons | Light content mode over map |
| Top gradient | Fade overlay | 180px, `#FFFFFFBB` to transparent (Section 7.15) |
| Header | Brand row | Transparent background, no border. Padding `[0, 20]`. Left: HuisHype logo 28px + brand text Inter 22/700 `$gold-500`. Right: city name Inter 18/600 `$warm-800`. |
| Search bar | Floating | y=106, translucent `#FFFFFFCC`, backdrop blur, `$warm-300` border, Lucide `search` + `mic` icons (Section 7.2) |
| Map content | Interactive | 3D buildings, paper trees, property nodes, cluster markers |
| Preview card | Geo-anchored | 270px wide, arrow pointer toward map feature, spring entrance animation (Section 7.6) |
| Location button | Bottom-right | 44px translucent circle, backdrop blur (Section 7.14) |
| Bottom gradient | Fade overlay | 140px, transparent to `#FFFFFFCC` (Section 7.15) |
| Tab bar | Floating pill | Translucent `#FFFFFFCC`, gold active capsule on "Map" tab (Section 7.1) |

**Search active state**: When search bar is focused, map background dims with `#00000040` overlay. Top gradient strengthens to `#FFFFFFEE`. Search dropdown appears below (Section 7.3). Gold border + glow on input field.

---

### 8.2 Feed Screen

Cream-background content list with filter chips.

| Layer | Element | Spec |
|-------|---------|------|
| Background | Screen | `$warm-50` (`#FFFBF5`) cream |
| Status bar | Dark icons | Standard dark content |
| Header area | Title row | Padding `[0, 20]`. "Trending Properties" Inter 22/700 `$warm-900`, left-aligned. Right: notification bell with badge (Section 7.16). No logo row on feed — logo row is map screen only. |
| Filter chips | Horizontal scroll | Gold active chip, warm-300 border inactive chips. "Trending" (fire emoji), "Following", "Hot", "..." overflow (Section 7.4) |
| Card list | Vertical scroll | 16px gaps between cards. White cards on cream background with warm-gold shadow (Section 7.5) |
| Tab bar | Floating pill | Solid white `#FFFFFF`, gold active capsule on "Feed" tab (Section 7.1) |

**Empty state**: Centered house-outline icon in `$gold-200` (48px), "No properties yet" Inter 17/600 `$warm-700`, descriptive text Inter 15/400 `$warm-500`.

**Pull-to-refresh**: Gold `ActivityIndicator`.

---

### 8.3 Property Detail (Full Page)

**BREAKING CHANGE**: This is now a full-page scroll view navigated via Expo Router stack push, NOT a bottom sheet overlay. The user taps a card or preview to navigate to this page. Back navigation via the back button in the hero overlay.

| Layer | Element | Spec |
|-------|---------|------|
| Hero | Photo | 240px, full-width image with overlay buttons (back, share, like, photo count). See Section 7.7. |
| Content | Scroll view | Padding `[16, 16, 24, 16]`, 20px gap between sections |

**Content sections** (top to bottom, 20px vertical gaps):

1. **Address + city + info pills**: Street in Outfit 22/600, city in Outfit 15/500, row of pill badges for year built, floor area, view count (Section 7.7 info pills).

2. **Crowd Estimate card**: Large price in Outfit 32/700 green, confidence badge. Adjacent WOZ and Asking price cards side-by-side (12px gap). Price comparison bar with dot markers below (Section 7.7 price comparison bar).

3. **Listings section**: cornerRadius 12 cards with source logo circles (Funda yellow, Pararius blue), listing URL, and "Add Listing" CTA. See Section 7.7 listings.

4. **Price guess section**: FMV visualization with gold-tinted distribution bars (Section 7.19), consensus alignment indicator, "Make Your Guess" CTA.

5. **Comments section**: 2 recent comment cards with avatar, karma badge, text. "View all X comments" link. Comment input bar with gold send button. See Section 7.7 comments.

6. **Property info section**: Details card (cornerRadius 14, `$warm-200` stroke) with property metadata, activity stats row.

7. **Action row**: Horizontal row of action buttons (like, save, share) with outlined style, icons 22px, labels Outfit 13/500. See Section 7.7 action row.

---

### 8.4 Saved Screen

Same overall layout structure as Feed.

| Layer | Element | Spec |
|-------|---------|------|
| Background | Screen | `$warm-50` (`#FFFBF5`) |
| Header | Title area | "Saved Properties" Inter 20/600 `$warm-900`. Subtitle "3 properties saved" Inter 13/400 `$warm-500`. Notification bell right. |
| Cards | Property cards | Same component as feed cards (Section 7.5) |
| Tab bar | Floating pill | Solid white, gold active capsule on "Saved" tab |

**Empty state (unauthenticated)**: Centered Lucide `bookmark` icon (`$gold-400`, 48px), "Sign in to save properties" Inter 17/600 `$warm-700`, gold CTA button.

**Empty state (authenticated, no saves)**: Lucide `bookmark` outline (`$warm-300`, 48px), "No saved properties yet" Inter 17/600 `$warm-700`, "Explore the map to find homes you love" Inter 15/400 `$warm-500`.

---

### 8.5 Profile Screen

| Layer | Element | Spec |
|-------|---------|------|
| Background | Screen | `$warm-50` (`#FFFBF5`) |
| Header row | Top bar | Notification bell (left) + 3-dot menu (right) |
| Profile card | White card | cornerRadius 16, `card` shadow (Section 5.1). Contains: avatar 72px gold circle (Section 7.18), display name Inter 20/600, karma badge pill (Section 7.17), "Edit display name" Inter 15/500 `$gold-500`. |
| Stats grid | 3 columns | White stat cards with warm-sm shadow. Stat numbers Inter 24/700 — Karma and Accuracy values use `$gold-500` (#F5A623), Guesses count uses `$warm-900` (#2D2926). Labels: uppercase Inter 11/600 `$warm-500`. |
| Achievements | Icon row | Trophy, flame, target, globe icons in `$gold-50` circles |
| Recent Activity | Log rows | Activity entries with icons and timestamps |
| Tab bar | Floating pill | Solid white, gold active capsule on "Profile" tab |

**Dropdown menu** (from 3-dot button): Floating white card with warm-md shadow, "Sign out" row with Lucide `log-out` icon.

**Unauthenticated state**: Large logo (80px), "Join HuisHype" Outfit 20/600, description text Inter 15/400 `$warm-500`, gold CTA button.

---

### 8.6 Auth Modal

| Layer | Element | Spec |
|-------|---------|------|
| Backdrop | Overlay | `$warm-900` at 75% (`#2D2926BF`) |
| Status bar | White text | Light content mode forced |
| Card | Centered modal | Gold glow shadow, all tokens per Section 7.13 |

Content stack (top to bottom): Close button (top-right) -> Logo 64px -> "Welcome to HuisHype" title -> Subtitle text -> Google sign-in button -> Apple sign-in button -> "or" divider -> Email sign-in button.

**Animations**: Slide-up spring entrance (existing Reanimated animation), backdrop fade 300ms.

---

### 8.7 Search Results (Map Screen Overlay)

| Layer | Element | Spec |
|-------|---------|------|
| Background | Map canvas | Dimmed with `#00000040` overlay |
| Top gradient | Strengthened | `#FFFFFFEE` to transparent, 200px height |
| Search bar | Active/focused | Gold 2px border, gold glow shadow `#F7C94830`, gold search icon (Section 7.2 focused state) |
| Dropdown | Below search bar | White card, 370px wide, 5 result rows with gold pin icons, DM Sans text (Section 7.3) |
| Tab bar | Floating pill | Map tab active |

---

### 8.8 Social Activity Feed

Same layout structure as Feed screen (8.2) with different card format and title.

| Layer | Element | Spec |
|-------|---------|------|
| Background | Screen | `$warm-50` |
| Title | Header | "Recent Activity" Inter 22/700 `$warm-900` (not "Trending Properties") |
| Filter | Chips | "Recent Activity" chip active (gold), other chips inactive |
| Cards | Activity cards | User avatar + name, action badge (liked/commented/guessed), property photo 200px, metrics row. See Section 7.12. |
| Tab bar | Floating pill | Feed tab active |

---

### 8.9 Comments Page (Full Screen)

Full-screen overlay. No tab bar visible.

| Layer | Element | Spec |
|-------|---------|------|
| Header | 56px bar | Back button (32px circle) + property thumbnail (48x36) + address + city. See Section 7.8. |
| Sort toggle | Below header | "Popular" / "Recent" toggle pills, gold active, warm-200 inactive (Section 7.8 sort toggle) |
| Comment list | Scrollable | Threaded comments with avatars (34px), karma badges, timestamps, reaction buttons. Reply threads indented 16px with 2px left border. See Section 7.8. |
| Input bar | Pinned bottom | 70px, avatar (32px) + pill input + gold send button (34px circle). See Section 7.8 input bar. |

---

### 8.10 Price Guesses Page (Full Screen)

Full-screen view. No tab bar visible.

| Layer | Element | Spec |
|-------|---------|------|
| Header | 48px bar | Back button (36px circle, `$warm-100` fill) + "Price Guesses" title Inter 18/600. See Section 7.9. |
| Property image | Card | 150px height, cornerRadius 16, address overlay on gradient. |
| Crowd estimate | Card | Crowd FMV price, diff badge, confidence. |
| Distribution | Card | Bar chart visualization with `$gold-500` fills on `$warm-100` background. |
| Recent guesses | List | cornerRadius 12 entries with accuracy indicators (green check / orange alert). |
| CTA bar | Sticky bottom | "Make Your Guess" gold button, 50px height, Lucide `target` icon. See Section 7.9. |

---

### 8.11 Social Notifications (Full Screen)

Full-screen view. No tab bar visible.

| Layer | Element | Spec |
|-------|---------|------|
| Header | Title area | "Notifications" Inter 26/700 `$warm-900` letterSpacing -0.5. "Mark all read" Inter 14/500 `$gold-700`. |
| Section groups | Time-based | "Today", "This Week", "Earlier" section labels in Inter 13/600 `$warm-500` uppercase. |
| Items | Notification rows | Thumbnail (48x48, r8) + description + timestamp. Unread: `$warm-100` background + 8px gold dot. Read: no background, no dot. See Section 7.10. |

---

### 8.12 Community Leaderboard (Full Screen)

Full-screen view. No tab bar visible.

| Layer | Element | Spec |
|-------|---------|------|
| Header | 44px bar | Lucide `trophy` 22px `$gold-500` + "Leaderboard" Outfit 22/600. Period filter dropdown (right). See Section 7.11. |
| Featured | Property card | 180px image card with "MOST DISCUSSED THIS WEEK" text overlay. |
| Podium | Top 3 | 1st place: crown icon, 52px avatar with gold stroke, name, karma badge, points. 2nd/3rd: 44px avatars, no crown. See Section 7.11. |
| Rankings | Full list | Rows with rank number, 36px avatar, name, karma badge, points. "Your Rank" row highlighted with `$gold-50` fill and `$gold-200` stroke. |


## 9. Dark Mode Considerations

Dark mode is **NOT** in scope for this overhaul. The app is light-only.

However, design tokens are structured to support future dark mode. The `Colors.ts` file already carries both `light` and `dark` objects, and Tailwind semantic aliases (`primary`, `warm`, `surface`) avoid literal color names. When dark mode is implemented, only the token values change — not the class names in components.

```ts
// Future: src/lib/theme.ts
const lightTheme = {
  background: '#FFFBF5',       // warm-50
  surface: '#FFFFFF',
  textPrimary: '#2D2926',      // warm-900
  textSecondary: '#9C958A',    // warm-500
  brand: '#F5A623',            // gold-500
  brandHover: '#DE911D',       // gold-600
  border: '#E8E0D4',           // warm-300
  inputBg: '#FFF8F0',          // warm-100
  fontPrimary: 'Inter',
  fontDisplay: 'Outfit',
  fontSearch: 'DMSans',
};

const darkTheme = {
  background: '#1A1816',
  surface: '#2D2926',
  textPrimary: '#FFFBF5',
  textSecondary: '#9C958A',
  brand: '#F7C948',            // Lighter gold for dark bg
  brandHover: '#FADB5F',       // gold-300
  border: '#504A42',           // warm-700
  inputBg: '#3D3832',          // warm-800
  fontPrimary: 'Inter',
  fontDisplay: 'Outfit',
  fontSearch: 'DMSans',
};
```

Font families (Inter, Outfit, DM Sans) remain the same in dark mode — only weights and colors shift. Token naming in Tailwind uses semantic names (`primary`, `warm`, `surface`) rather than literal colors, which makes dark mode extension straightforward.

---

## 10. Animation & Motion

### 10.1 Existing Animations (keep)

| Animation | Library | Notes |
|-----------|---------|-------|
| Card entrance | `ZoomIn.springify().damping(15).stiffness(100)` (Reanimated) | Preview card pop-in |
| Bottom sheet gestures | `@gorhom/bottom-sheet` v5.1.4 | Spring physics, snap points `['4%', '48.5%', '100%']` — still used for quick-preview on map tap |
| FMV bar | `withTiming(800ms)` + `withDelay` (Reanimated) | Bar width + value opacity |
| Auth modal | `withTiming` slide-up (Reanimated) | Content sheet entrance |
| Page transitions | Expo Router defaults | Stack/tab transitions |

### 10.2 New Animations to Add

| Animation | Trigger | Spec |
|-----------|---------|------|
| Tab capsule transition | Tab switch | Gold fill slides horizontally between tabs, 200ms ease-out. The active tab capsule (gold background pill) animates its `translateX` to the new tab position using `withTiming(200, { easing: Easing.out(Easing.ease) })`. |
| Like bounce | Tap heart | `withSequence(withSpring(1.3, { damping: 4 }), withSpring(1.0))` — 300ms total. Heart icon scales up then settles. |
| Save bounce | Tap bookmark | Same as like bounce: `withSequence(withSpring(1.3, { damping: 4 }), withSpring(1.0))`. |
| Hot pulse | Activity = hot | Ring scale 1 -> 1.6, opacity 0.4 -> 0, loop 1.5s ease-out. Implemented as a Reanimated `withRepeat(withSequence(withTiming(...)))`. |
| Filter chip press | Chip tap | Scale 0.95 on press, 1.0 on release, 100ms. Use `Pressable` with `onPressIn` / `onPressOut` driving a shared value. |
| Card press | Feed card tap | Opacity 0.9 + scale 0.98 on press, revert on release. Complements existing `active:opacity-90` class. |
| Price label float | Slider drag | Spring follow: floating label above thumb tracks with `withSpring({ damping: 20, stiffness: 150 })` for 60fps smooth tracking. |
| Send button pulse | Enable transition | Scale 0.9 -> 1.0, 200ms spring when `canSubmit` becomes true. `useAnimatedStyle` watches `canSubmit` ref. |

### 10.3 Backdrop Blur Effects

These are **NOT animations** but static visual effects that require platform-specific implementation:

| Element | Native | Web |
|---------|--------|-----|
| Tab bar background | `BlurView` from `expo-blur`, `tint="light"`, `intensity={80}` | `backdrop-filter: blur(20px); background: rgba(255, 255, 255, 0.85);` |
| Search bar background | `BlurView`, `tint="light"`, `intensity={60}` | `backdrop-filter: blur(16px); background: rgba(255, 255, 255, 0.9);` |
| Location button background | `BlurView`, `tint="light"`, `intensity={60}` | `backdrop-filter: blur(16px); background: rgba(255, 255, 255, 0.9);` |
| Preview card close button | `BlurView`, `tint="dark"`, `intensity={40}` | `backdrop-filter: blur(12px); background: rgba(45, 41, 38, 0.3);` |

Requires `expo-blur` package (not currently installed). See section 11.1 for installation.

### 10.4 Motion Principles

- **Duration**: 150-300ms for micro-interactions, 300-500ms for layout transitions
- **Easing**: Spring physics preferred over cubic bezier. Damping 12-18, stiffness 80-150.
- **Haptics**: Light impact on like/save, medium on guess submit, selection on slider snap points (already using `expo-haptics`)
- **Reduce motion**: Respect `useReducedMotion()` from Reanimated v4 — skip spring animations, use instant transitions. All new animations (tab capsule, bounces, pulses) must check this flag and fall back to `withTiming(0)` or static values.
- **60fps budget**: Animations run on the UI thread via Reanimated worklets. No `setState` in animation loops. Shared values only.

---

## 11. Implementation Notes

### 11.1 Package Installation

New packages needed (run from monorepo root):

```bash
# Blur effects (tab bar, search bar, location button, close button)
npx expo install expo-blur

# Fonts — Inter (primary), Outfit (display/accent), DM Sans (search)
npx expo install @expo-google-fonts/inter @expo-google-fonts/outfit @expo-google-fonts/dm-sans expo-font

# Icon library — replaces Ionicons and FontAwesome throughout
pnpm -C apps/app add lucide-react-native

# SVG runtime — peer dependency of lucide-react-native
# Already a transitive dep (via other packages) but must be explicitly installed
pnpm -C apps/app add react-native-svg
```

After installation:
1. `pnpm install` (update lockfile)
2. `npx expo run:android` (rebuild native — expo-blur and react-native-svg have native modules)
3. Clear Metro cache: `rm -rf /tmp/metro-* /tmp/haste-map-*`

### 11.2 Tailwind Config (complete)

Replace `apps/app/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#FFFBEB',
          100: '#FFF3C4',
          200: '#FCE588',
          300: '#FADB5F',
          400: '#F7C948',
          500: '#F5A623',
          600: '#DE911D',
          700: '#B47712',
          800: '#8C5E0A',
          900: '#6B4706',
        },
        warm: {
          50:  '#FFFBF5',
          100: '#FFF8F0',
          200: '#F5F0E8',
          300: '#E8E0D4',
          400: '#C7BFB3',
          500: '#9C958A',
          600: '#736C62',
          700: '#504A42',
          800: '#3D3832',
          900: '#2D2926',
        },
        'crowd-green': {
          50:  '#ECFDF5',
          100: '#D1FAE5',
          500: '#4CAF50',
          700: '#15803D',
        },
        warning: {
          50:  '#FFF8E1',
          100: '#FFECB3',
          500: '#FF9500',
          700: '#B45309',
        },
        'error-red': {
          50:  '#FFEBEE',
          100: '#FFCDD2',
          500: '#E53935',
          700: '#C62828',
        },
        'info-blue': {
          50:  '#E3F2FD',
          100: '#BBDEFB',
          500: '#42A5F5',
          700: '#1565C0',
        },
        'hot-red': {
          50:  '#FFF5F0',
          100: '#FFE0D6',
          500: '#FF6B35',
          700: '#C43E00',
        },
        // Activity level accent
        hot: '#FF6B35',
        crowd: '#4CAF50',
        // Surface aliases
        'surface-bg': '#FFFBF5',
        'surface-card': '#FFFFFF',
        'surface-elevated': '#FFFFFF',
        'surface-input': '#FFF8F0',
        'surface-muted': '#F5F0E8',
        // Chat bubbles
        'chat-bot': '#FFF3E0',
        'chat-bot-border': '#FCE588',
      },
      fontFamily: {
        // Inter — primary UI font
        sans:            ['Inter_400Regular', 'System', 'sans-serif'],
        'sans-medium':   ['Inter_500Medium', 'System', 'sans-serif'],
        'sans-semibold': ['Inter_600SemiBold', 'System', 'sans-serif'],
        'sans-bold':     ['Inter_700Bold', 'System', 'sans-serif'],
        // Outfit — display/accent font (headings, hero prices)
        display:            ['Outfit_500Medium', 'System', 'sans-serif'],
        'display-semibold': ['Outfit_600SemiBold', 'System', 'sans-serif'],
        'display-bold':     ['Outfit_700Bold', 'System', 'sans-serif'],
        // DM Sans — search input only
        search:          ['DMSans_400Regular', 'System', 'sans-serif'],
        'search-medium': ['DMSans_500Medium', 'System', 'sans-serif'],
      },
      fontSize: {
        'display':    ['32px', { lineHeight: '1.2', letterSpacing: '-0.5px' }],
        'title-lg':   ['26px', { lineHeight: '1.25', letterSpacing: '-0.3px' }],
        'title':      ['24px', { lineHeight: '1.3', letterSpacing: '-0.3px' }],
        'h1':         ['22px', { lineHeight: '1.3', letterSpacing: '-0.2px' }],
        'h2':         ['20px', { lineHeight: '1.35', letterSpacing: '-0.2px' }],
        'h3':         ['18px', { lineHeight: '1.4', letterSpacing: '0px' }],
        'h4':         ['17px', { lineHeight: '1.4', letterSpacing: '0px' }],
        'body-lg':    ['16px', { lineHeight: '1.5', letterSpacing: '0px' }],
        'body':       ['15px', { lineHeight: '1.5', letterSpacing: '0px' }],
        'caption-lg': ['14px', { lineHeight: '1.4', letterSpacing: '0px' }],
        'caption':    ['13px', { lineHeight: '1.4', letterSpacing: '0.1px' }],
        'small':      ['12px', { lineHeight: '1.35', letterSpacing: '0.1px' }],
        'overline':   ['11px', { lineHeight: '1.3', letterSpacing: '0.8px' }],
        'micro':      ['10px', { lineHeight: '1.2', letterSpacing: '0.5px' }],
      },
      borderRadius: {
        'card': '16px',
        'button': '12px',
        'sheet': '24px',
        'pill': '9999px',
      },
      boxShadow: {
        'card':         '0 2px 12px #B4771215',
        'card-alt':     '0 2px 12px #1A191808',
        'preview':      '0 4px 20px #B4771220',
        'tab-bar':      '0 2px 12px #00000010',
        'search':       '0 2px 10px #00000012',
        'dropdown':     '0 4px 16px #00000018, 0 1px 4px #00000010',
        'auth-glow':    '0 12px 48px #F5A62330',
        'bottom-sheet': '0 -4px 24px #B4771216',
      },
    },
  },
  plugins: [],
};
```

**NativeWind v4 fontWeight note**: NativeWind v4 does not translate `fontWeight` from `fontSize` config entries to React Native's `fontWeight` style prop. Instead, pair each size class with the appropriate font-family class to get the desired weight. Examples:

- `text-display font-display-bold` (Outfit Bold 700 at 32px)
- `text-title font-sans-bold` (Inter Bold 700 at 24px)
- `text-h1 font-sans-bold` (Inter Bold 700 at 22px)
- `text-h2 font-sans-semibold` (Inter SemiBold 600 at 20px)
- `text-h3 font-sans-semibold` (Inter SemiBold 600 at 18px)
- `text-body font-sans` (Inter Regular 400 at 15px)
- `text-body font-sans-medium` (Inter Medium 500 at 15px — "body-medium")
- `text-caption font-sans` (Inter Regular 400 at 13px)
- `text-caption font-sans-medium` (Inter Medium 500 at 13px — "caption-medium")
- `text-overline font-sans-semibold` (Inter SemiBold 600 at 11px)

**Font family usage by context**:
- **Inter**: All UI text — body, captions, buttons, labels, comments, prices, addresses
- **Outfit**: Display headings and hero elements — screen titles, property hero price, splash/onboarding text, tab bar brand name
- **DM Sans**: Search input field text only — the slightly geometric letterforms help differentiate the search context

### 11.3 Colors.ts Update

```ts
// apps/app/constants/Colors.ts
export default {
  light: {
    text: '#2D2926',
    background: '#FFFBF5',
    tint: '#F5A623',
    tabIconDefault: '#C7BFB3',
    tabIconSelected: '#F5A623',
  },
  dark: {
    text: '#FFFBF5',
    background: '#1A1816',
    tint: '#F7C948',
    tabIconDefault: '#736C62',
    tabIconSelected: '#F7C948',
  },
};
```

### 11.4 Font Loading

In `apps/app/app/_layout.tsx`, load all three font families before rendering. Show the splash screen until fonts are ready.

```tsx
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  DMSans_400Regular,
  DMSans_500Medium,
} from '@expo-google-fonts/dm-sans';
import { useFonts } from 'expo-font';

const [fontsLoaded] = useFonts({
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  DMSans_400Regular,
  DMSans_500Medium,
});
```

The font asset names used in `fontFamily` config (`Inter_400Regular`, etc.) must exactly match the keys passed to `useFonts`. Expo Google Fonts packages export constants whose values are the font file asset names — these are the same strings used internally by `expo-font` for registration.

### 11.5 Global CSS Update

```css
/* apps/app/global.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body {
    background-color: #FFFBF5;
    color: #2D2926;
    font-family: 'Inter', system-ui, sans-serif;
  }
}
```

### 11.6 Shadow Helper (shadows.ts)

Create `apps/app/src/lib/shadows.ts`. Platform-specific shadow definitions since NativeWind v4 does not translate `boxShadow` to native.

```ts
import { Platform, type ViewStyle } from 'react-native';

export const shadows = {
  sm: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#B47712',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
    },
    android: { elevation: 2 },
    default: {}, // web: use shadow-card class
  }),
  md: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#B47712',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
    },
    android: { elevation: 6 },
    default: {},
  }),
  lg: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#B47712',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.16,
      shadowRadius: 16,
    },
    android: { elevation: 12 },
    default: {},
  }),
  glow: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#F5A623',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.25,
      shadowRadius: 24,
    },
    android: { elevation: 16 },
    default: {}, // web: use shadow-auth-glow class
  }),
} as const;
```

Usage pattern in components:

```tsx
import { shadows } from '@/lib/shadows';

// Native: inline style for shadow
// Web: Tailwind class for shadow
<View style={shadows.md} className="shadow-card bg-white rounded-card">
  {/* ... */}
</View>
```

The `style` prop is ignored on web (empty object from `default`), and the `shadow-card` class is ignored on native (NativeWind doesn't process `boxShadow`). Both coexist without conflict.

**Shadow mapping**: The `shadows.ts` helper uses generic tiers (`sm`, `md`, `lg`, `glow`) while the Tailwind config uses per-component names (`card`, `preview`, `auth-glow`). Match them by intensity: `shadows.sm` → `shadow-card`/`shadow-card-alt`, `shadows.md` → `shadow-preview`/`shadow-dropdown`, `shadows.lg` → `shadow-bottom-sheet`, `shadows.glow` → `shadow-auth-glow`. See Section 5.1 for the complete per-component catalog.

### 11.7 Backdrop Blur Helper

Create `apps/app/src/components/ui/BlurContainer.tsx`. Platform-specific blur implementation.

```tsx
// apps/app/src/components/ui/BlurContainer.tsx
// Native: uses BlurView from expo-blur
// Web: uses CSS backdrop-filter

import React from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

type BlurContainerProps = ViewProps & {
  intensity?: number; // 0-100, maps to expo-blur intensity
  tint?: 'light' | 'dark';
};

// Native implementation (BlurContainer.native.tsx):
// import { BlurView } from 'expo-blur';
// <BlurView intensity={intensity} tint={tint} style={...} />

// Web implementation (BlurContainer.web.tsx):
// <View style={{ backdropFilter: `blur(${intensity * 0.2}px)`, ... }} />
```

Used by:
- **Tab bar**: `<BlurContainer intensity={80} tint="light">` — semi-transparent white with blur
- **Search bar**: `<BlurContainer intensity={60} tint="light">` — floating over map
- **Location button**: `<BlurContainer intensity={60} tint="light">` — floating over map
- **Preview card close button**: `<BlurContainer intensity={40} tint="dark">` — dark glass dismiss button

Requires `.native.tsx` / `.web.tsx` platform file split (Metro resolves automatically). The web variant avoids importing `expo-blur` (which has native module requirements) and uses plain CSS instead.

### 11.8 Migration Order

Execute the overhaul in this order to minimize breakage and allow incremental testing. Each phase should be a separate PR or commit group.

| Phase | Scope | Files | Risk |
|-------|-------|-------|------|
| 1 | **Package installation** | `package.json` | Low — additive only, native rebuild required |
| 2 | **Design tokens** | `tailwind.config.js`, `Colors.ts`, `global.css` | Low — existing `primary-*` classes auto-remap to gold |
| 3 | **Font loading** | `_layout.tsx` | Low — additive, fallback to system font if loading fails |
| 4 | **Shadow + blur helpers** | New `src/lib/shadows.ts`, new `src/components/ui/BlurContainer.{native,web}.tsx` | Low — additive, no existing code changes |
| 5 | **Icon migration** | All components using Ionicons/FontAwesome -> Lucide | Medium — many files touched, but mechanical replacement |
| 6 | **Tab bar** | `(tabs)/_layout.tsx` — full rewrite to floating pill with backdrop blur, gold capsule active | Medium — high-visibility, custom component replaces Expo Router defaults |
| 7 | **Search bar** | `SearchBar.tsx`, `SearchResults.tsx` | Low — isolated component |
| 8 | **Feed filter chips** | `FeedFilterChips.tsx` | Low — small component |
| 9 | **Feed cards** | `PropertyCard.tsx`, `PropertyFeedCard.tsx` | Medium — visible everywhere in feed |
| 10 | **Preview card** | `PropertyPreviewCard.tsx`, `GroupPreviewCard.tsx` | Medium — geo-anchored overlay, touches map interaction |
| 11 | **Property detail page** | NEW full-page route + existing components refactored | High — new screen, requires routing decisions |
| 12 | **Comments page** | `CommentsSection.tsx`, `Comment.tsx`, `CommentInput.tsx`, `CommentsList.tsx` | Medium — flat layout with karma badges |
| 13 | **Price guesses page** | NEW screen + `PriceGuessSection.tsx` updates | Medium — new screen |
| 14 | **Profile screen** | `profile.tsx` — achievements, activity feed, settings dropdown | Medium — layout overhaul |
| 15 | **Auth modal** | `AuthModal.tsx` | Low — isolated modal |
| 16 | **Notifications page** | NEW screen | Medium — new screen, needs backend endpoint |
| 17 | **Leaderboard page** | NEW screen | Medium — new screen, needs backend endpoint |
| 18 | **Social activity feed** | NEW feed variant | Medium — new feed algorithm + card type |
| 19 | **Saved screen** | `saved.tsx` | Low — mirrors feed layout |
| 20 | **Animations** | Various — add bounce, pulse, capsule transitions (Reanimated) | Low — additive |
| 21 | **Visual regression** | Update all Playwright + Maestro screenshot baselines | Required — run full suite |

**Phase dependency notes**:
- Phases 1-4 are prerequisites for everything else and should land first.
- Phase 5 (icons) can run in parallel with phases 6-8.
- Phase 11 (property detail page) is the highest-risk phase — it introduces a new route and must coexist with the existing bottom sheet (phase 10 maps quick-preview stays as bottom sheet).
- Phase 21 must run after ALL other phases. Do not update baselines incrementally.

### 11.9 Hardcoded Color Search-and-Replace

These literal hex values appear across component files and must be replaced with design tokens:

| Old Value | New Value | Context |
|-----------|-----------|---------|
| `#3B82F6` | `#F5A623` (gold-500) | Primary blue -> brand gold |
| `#2f95dc` | `#F5A623` | Tab tint (Colors.ts) |
| `#2563eb` / `#2563EB` | `#DE911D` (gold-600) | Primary hover/pressed |
| `#1D4ED8` | `#B47712` (gold-700) | Primary text on light background |
| `#111827` | `#2D2926` (warm-900) | Near-black text -> warm near-black |
| All `bg-blue-*` | `bg-primary-*` | Primary backgrounds |
| All `text-blue-*` | `text-primary-*` | Primary text |
| `text-gray-900` | `text-warm-900` | Primary text |
| `text-gray-700` | `text-warm-700` | Strong secondary text |
| `text-gray-600` | `text-warm-600` | Body secondary text |
| `text-gray-500` | `text-warm-500` | Secondary text |
| `text-gray-400` | `text-warm-400` | Tertiary/placeholder text |
| `text-gray-300` | `text-warm-300` | Disabled text |
| `bg-gray-100` | `bg-warm-200` or `bg-surface-input` | Light backgrounds |
| `bg-gray-50` | `bg-warm-50` or `bg-surface-bg` | Screen backgrounds |
| `border-gray-100` | `border-warm-200` | Subtle dividers |
| `border-gray-200` | `border-warm-300` | Standard borders |
| `border-gray-300` | `border-warm-300` | Heavier borders |
| `#6B7280` | `#9C958A` (warm-500) | Gray icons -> warm |
| `#9CA3AF` | `#C7BFB3` (warm-400) | Light gray icons -> warm |
| `#4B5563` | `#736C62` (warm-600) | Medium gray text -> warm |
| `#374151` | `#504A42` (warm-700) | Dark gray text -> warm |
| `bg-white` | Keep `bg-white` | Cards stay pure white |

**Important**: Do NOT replace Tailwind's built-in `gray-*` everywhere blindly. Only replace in HuisHype app components. Semantic colors (`red-500` for errors, `green-500` for success, `orange-*` for warnings) stay as-is unless they map to the new semantic tokens defined in section 1.4.

### 11.10 Icon Migration Guide

The entire app migrates from `@expo/vector-icons` (Ionicons + FontAwesome) to `lucide-react-native`. Lucide uses SVG-based components (not icon fonts), providing consistent rendering and tree-shaking.

**Import pattern**:

```tsx
// Old (remove):
import { Ionicons } from '@expo/vector-icons';
// <Ionicons name="heart-outline" size={18} color="#C7BFB3" />

// New:
import { Heart, MessageCircle, Send } from 'lucide-react-native';
// <Heart size={18} color="#C7BFB3" />
// For filled: <Heart size={18} color="#FF6B35" fill="#FF6B35" />
```

**Ionicons -> Lucide mapping**:

| Ionicons name | Lucide component | Notes |
|---------------|------------------|-------|
| `heart-outline` | `Heart` | Outline by default |
| `heart` | `Heart` | Add `fill="currentColor"` or `fill="#FF6B35"` for filled |
| `chatbubble-outline` | `MessageCircle` | |
| `chatbubble` | `MessageCircle` | Add `fill` for filled |
| `close` | `X` | |
| `search` | `Search` | |
| `location-outline` | `MapPin` | |
| `arrow-back` | `ArrowLeft` or `ChevronLeft` | Use `ChevronLeft` for back navigation |
| `share-social` | `Share2` | |
| `bookmark-outline` | `Bookmark` | Outline by default |
| `bookmark` | `Bookmark` | Add `fill` for filled |
| `person-outline` | `User` | |
| `person` | `User` | Add `fill` for filled |
| `send` | `Send` | |
| `eye-outline` | `Eye` | |
| `information-circle-outline` | `Info` | |
| `chevron-down` | `ChevronDown` | |
| `chevron-up` | `ChevronUp` | |
| `time-outline` | `Clock` | |
| `star-outline` | `Star` | |
| `trending-up` | `TrendingUp` | |
| `ellipsis-horizontal` | `MoreHorizontal` | |
| `settings-outline` | `Settings` | |
| `log-out-outline` | `LogOut` | |
| `notifications-outline` | `Bell` | |

**FontAwesome -> Lucide mapping** (tab bar):

| FontAwesome name | Lucide component | Notes |
|------------------|------------------|-------|
| `map` | `Map` | |
| `list` | `LayoutList` | |
| `bookmark` | `Bookmark` | |
| `user` | `User` | |

**Filled vs outline**: Lucide icons are outline by default. To get a filled variant, pass both `color` and `fill` props with the same value:
```tsx
<Heart size={18} color="#FF6B35" fill="#FF6B35" />   // Filled heart
<Heart size={18} color="#C7BFB3" />                   // Outline heart
<Bookmark size={18} color="#F5A623" fill="#F5A623" /> // Filled bookmark
```

**Accessibility**: Every interactive Lucide icon must be wrapped in a `Pressable` (or `TouchableOpacity`) with `accessibilityLabel`. Decorative icons should have `accessibilityElementsHidden={true}` (native) or `aria-hidden="true"` (web).

**Size constants**: Use the scale from section 6.3:

| Size name | px | Usage |
|-----------|-----|-------|
| `xs` | 14 | Inline with caption text, badge icons |
| `sm` | 18 | Inline with body text, send button icon |
| `md` | 22 | Quick action buttons, list item icons |
| `lg` | 26 | Tab bar icons |
| `xl` | 32 | Empty state illustrations, large CTAs |

---

## 12. What NOT to Change

| Area | Reason |
|------|--------|
| Map tile styling | Custom OpenFreeMap Positron with enhanced vegetation colors — separate concern, managed in `services/api/src/services/style.ts` |
| 3D building shaders | GLSL in `maplibre-gl-js` and `maplibre-native` forks — visual but separate pipeline with its own build/deploy cycle |
| Paper Mario billboard trees | Already matches the illustrated warm aesthetic — tree-atlas sprites are independent of UI design tokens |
| MapLibre marker positioning logic | Complex coordinate system with geo-anchoring — purely functional, no visual token dependencies |
| API / data layer | No backend changes for a visual overhaul. Endpoint schemas, database queries, and business logic are unchanged |
| Vector tile endpoints / clustering | Data delivery format unchanged — `services/api/src/routes/tiles.ts` is not affected |
| Test fixture data | Addresses, prices, comments in `db:seed-test-fixture` — unchanged |
| E2E test logic | Only screenshot baselines need updating after the overhaul, not test structure or navigation flow |
| Bottom sheet snap-point behavior | `PropertyBottomSheet.native.tsx` snap points (`['4%', '48.5%', '100%']`) and gesture physics remain unchanged. The bottom sheet continues to serve as the quick-preview experience when tapping markers on the map. The new full-page property detail (phase 11) is a separate route for deep engagement — reached from feed card taps, comments, price guesses, etc. Both coexist. |
| Existing Reanimated animation parameters | Spring damping/stiffness values for card entrance, FMV bar timing, auth modal slide-up — these are tuned and working. New animations (section 10.2) are additive. |

---

## Appendix A: Complete Tailwind Config

See section 11.2 for the full ready-to-paste config file.

The config is designed as a drop-in replacement for the existing `apps/app/tailwind.config.js`. Key differences from the current config:

| Area | Current | New |
|------|---------|-----|
| `colors.primary` | Blue scale (#3b82f6 base) | Gold scale (#F5A623 base) |
| `colors.warm` | Not present | Full warm neutral scale (replaces Tailwind's cool gray) |
| `colors.crowd-green/warning/error-red/info-blue/hot-red` | Not present | Semantic color tiers |
| `colors.hot/crowd` | Not present | Activity and consensus accents |
| `colors.surface-*` | Not present | Semantic surface aliases |
| `colors.chat-*` | Not present | Chat bubble colors |
| `fontFamily` | Not present | Inter (4 weights) + Outfit (3 weights) + DM Sans (2 weights) |
| `fontSize` | Not present | 14-step scale from `micro` (10px) to `display` (32px) |
| `borderRadius` | Not present | `card` (16px), `button` (12px), `sheet` (24px), `pill` (full) |
| `boxShadow` | Not present | 8 named shadows: `card`, `card-alt`, `preview`, `tab-bar`, `search`, `dropdown`, `auth-glow`, `bottom-sheet` |

---

## Appendix B: Component Audit Checklist

Every component listed in section 11.8's phase table must be verified against this checklist before its phase is marked complete:

### Color Tokens
- [ ] No hardcoded `#3B82F6` or `#2f95dc`
- [ ] No hardcoded `#2563eb`, `#1D4ED8`, or other blue primary variants
- [ ] No `text-gray-*` where `text-warm-*` should be used
- [ ] No `bg-gray-*` where `bg-warm-*` or `bg-surface-*` should be used
- [ ] No `bg-blue-*` where `bg-primary-*` should be used
- [ ] No `border-gray-*` where `border-warm-*` should be used
- [ ] Border colors use `warm-300` (not `gray-200` or `gray-300`)
- [ ] Activity indicators use `#FF6B35` (hot) and `#F5A623` (warm), not blue

### Typography
- [ ] Font family renders Inter for body/UI text (not system default)
- [ ] Font family renders Outfit for display headings (not system default or Inter)
- [ ] Font family renders DM Sans for search input (not system default or Inter)
- [ ] Font sizes use the defined scale (`text-display`, `text-h1`, etc.), not arbitrary pixel values
- [ ] Font weights are applied via `font-sans-*` / `font-display-*` classes, not `font-bold` / `font-semibold` (NativeWind limitation)

### Icons
- [ ] Icons use Lucide components (not Ionicons or FontAwesome)
- [ ] Filled variants use `fill` prop (not a separate icon name)
- [ ] Icon sizes follow the xs/sm/md/lg/xl scale
- [ ] Interactive icons have `accessibilityLabel`

### Shadows & Elevation
- [ ] Shadows use warm gold tint (not default gray/black)
- [ ] Native shadows use `shadows.ts` helper with inline `style` prop
- [ ] Web shadows use `shadow-warm-*` Tailwind classes
- [ ] Both coexist on the same element (native style + web class)

### Backdrop Blur
- [ ] Tab bar has backdrop blur (via `BlurContainer`)
- [ ] Search bar (on map) has backdrop blur
- [ ] Location button has backdrop blur
- [ ] Preview card close button has backdrop blur (dark tint)

### Behavioral
- [ ] Karma badges use correct tier names (Dutch) and `gold-100`/`gold-700` colors for Meester tier
- [ ] Send button uses gold-500 background when enabled, warm-300 when disabled
- [ ] Heart icon uses `#FF6B35` when liked (not red-500 or primary)
- [ ] Bookmark icon uses `#F5A623` when saved

---

## Appendix C: Accessibility

### Contrast Ratios

All text/background combinations must meet WCAG AA (4.5:1 for body text, 3:1 for large text / UI components).

| Combination | Ratio | Verdict |
|-------------|-------|---------|
| `warm-900` (#2D2926) on `warm-50` (#FFFBF5) | ~14:1 | Passes AA and AAA |
| `warm-900` (#2D2926) on white (#FFFFFF) | ~15:1 | Passes AA and AAA |
| `warm-700` (#504A42) on white | ~8.5:1 | Passes AA |
| `warm-600` (#736C62) on white | ~5.5:1 | Passes AA for body text |
| `warm-500` (#9C958A) on white | ~4.6:1 | Passes AA for large text, borderline body. **Use `warm-600` for body secondary text.** |
| `warm-400` (#C7BFB3) on white | ~2.5:1 | Fails body text. OK for placeholder text, disabled states, decorative elements only. |
| `gold-500` (#F5A623) on white | ~3.2:1 | Large text / icons only. **Not for body text.** For gold text on white, use `gold-700` (#B47712, ~5.8:1). |
| White on `gold-500` (#F5A623) | ~3.2:1 | Acceptable for buttons with large text (16px+). For small text on gold background, use `gold-900`. |
| `gold-700` (#B47712) on white | ~5.8:1 | Passes AA for body text |
| `gold-700` (#B47712) on `gold-50` (#FFFBEB) | ~5.5:1 | Passes AA for body text |
| White on `error-red-500` (#E53935) | ~4.6:1 | Passes AA for large text. Use `error-red-700` for body text on white. |
| White on `hot-red-500` (#FF6B35) | ~3.3:1 | Large text only. Not used for body text on hot-red backgrounds. |

### Touch Targets

- Minimum **44x44px** for all interactive elements (buttons, icons, links)
- Tab bar items: 48px minimum touch area (platform default handles this)
- Heart/bookmark/share action buttons: 36px visible circle with 44px touch target (extra padding)
- Filter chips: height 36px minimum, plus 4px vertical padding for 44px touch area
- Comment like button: 14px icon but 44px touch target via padding

### Reduced Motion

- `useReducedMotion()` from `react-native-reanimated` v4 is checked by all new animations
- When reduced motion is preferred:
  - Tab capsule transition: instant (no slide)
  - Like/save bounce: instant scale to final value
  - Hot pulse: static dot (no ring animation)
  - Filter chip press: instant opacity change
  - Card press: instant opacity change
  - Price label float: instant position update
  - Send button pulse: instant appearance
- Existing animations (bottom sheet physics, FMV bar) already respect reduced motion through Reanimated's built-in support

### Screen Reader

- No change to existing `accessibilityLabel` and `accessibilityRole` assignments
- **New requirement**: All Lucide icon buttons must include `accessibilityLabel` on the wrapping `Pressable`:
  - Like button: `accessibilityLabel="Like"` / `accessibilityLabel="Unlike"`
  - Save button: `accessibilityLabel="Save"` / `accessibilityLabel="Unsave"`
  - Share button: `accessibilityLabel="Share"`
  - Close button: `accessibilityLabel="Close"`
  - Send button: `accessibilityLabel="Send comment"`
- Decorative Lucide icons (inline with text) should have `accessibilityElementsHidden={true}` on native and `aria-hidden="true"` on web
- Karma badge text is read as part of the username group, not as a separate element
- Activity level indicators (Hot/Warm/Quiet dots) should have `accessibilityLabel` with the level name

### Font Accessibility

- Inter at 15px body size provides excellent readability for Latin scripts (Dutch, German, French, English)
- Minimum font size in the app is 10px (`micro`) — used only for non-essential decorative labels (e.g., "AI" tag on bot messages)
- Users who set large text in system accessibility settings: Expo's `fontScale` is respected by default in React Native. Test with 200% font scale to verify layout doesn't break.
