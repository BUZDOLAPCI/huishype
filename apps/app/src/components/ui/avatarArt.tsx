import React from 'react';
import { Defs, Ellipse, LinearGradient, Path, Rect, Stop, Svg, Text as SvgText } from 'react-native-svg';

const AVATAR_VIEWBOX = 100;
const AVATAR_MONOGRAM_CENTER = {
  x: 50,
  y: 54,
} as const;
const AVATAR_MONOGRAM_FONT_SIZE_SMALL = {
  single: 44,
  double: 38,
} as const;
const AVATAR_MONOGRAM_FONT_SIZE_LARGE = {
  single: 48,
  double: 42,
} as const;
const AVATAR_MONOGRAM_LETTER_SPACING = {
  single: 0.8,
  double: 4.5,
} as const;
const LARGE_MONOGRAM_MIN_AVATAR_SIZE = 40;
export const AVATAR_PALETTES = [
  {
    start: '#F9E8DE',
    end: '#FFF8F1',
    glow: '#F6D4C6',
    accent: '#EFB7B2',
    letter: '#6D5C66',
  },
  {
    start: '#EAF4E7',
    end: '#FDF8EC',
    glow: '#D2E8C8',
    accent: '#BFDCC8',
    letter: '#57665E',
  },
  {
    start: '#E8EDF8',
    end: '#F9F6FF',
    glow: '#D5DBF5',
    accent: '#C8CCE8',
    letter: '#5B627A',
  },
  {
    start: '#F8E5EC',
    end: '#FFF8F8',
    glow: '#F0CDD8',
    accent: '#E1BAC9',
    letter: '#715B68',
  },
  {
    start: '#F6EECF',
    end: '#FFF9EC',
    glow: '#F1DEA8',
    accent: '#E1C58E',
    letter: '#6F6258',
  },
  {
    start: '#E6F5F1',
    end: '#F7FCFA',
    glow: '#C7E8DD',
    accent: '#A9D8CE',
    letter: '#556A68',
  },
  {
    start: '#F3E7F7',
    end: '#FCF8FF',
    glow: '#E1CCF0',
    accent: '#D3B7E8',
    letter: '#665B75',
  },
  {
    start: '#FBE9D8',
    end: '#FFF7EE',
    glow: '#F6D4AD',
    accent: '#EDC2A2',
    letter: '#716158',
  },
] as const;

export const AVATAR_LAYOUTS = [
  {
    centerX: 50,
    centerY: 50,
    waveLift: 0,
  },
  {
    centerX: 38,
    centerY: 34,
    waveLift: -12,
  },
  {
    centerX: 64,
    centerY: 32,
    waveLift: -8,
  },
  {
    centerX: 40,
    centerY: 66,
    waveLift: 10,
  },
  {
    centerX: 62,
    centerY: 62,
    waveLift: 8,
  },
  {
    centerX: 50,
    centerY: 24,
    waveLift: 14,
  },
] as const;

export const AVATAR_ACCENT_VARIANTS = [
  {
    id: 0,
    label: 'Tilted glow + tide band',
  },
  {
    id: 1,
    label: 'Canopy band + drift oval',
  },
  {
    id: 2,
    label: 'Basin glow + floating contour',
  },
  {
    id: 3,
    label: 'Side ribbon + soft column',
  },
] as const;

const ACCENT_VARIANT_COUNT = AVATAR_ACCENT_VARIANTS.length;

export const DEFAULT_AVATAR_VARIANT_COUNT =
  AVATAR_PALETTES.length * AVATAR_LAYOUTS.length * ACCENT_VARIANT_COUNT;

function normalizeSeed(seed: string): string {
  const trimmed = seed.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : 'guest';
}

export function hashAvatarSeed(seed: string): number {
  const normalizedSeed = normalizeSeed(seed);
  let hash = 2166136261;

  for (let index = 0; index < normalizedSeed.length; index += 1) {
    hash ^= normalizedSeed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash;
}

export function getAvatarVariantIndex(seed: string): number {
  return hashAvatarSeed(seed) % DEFAULT_AVATAR_VARIANT_COUNT;
}

export function getAvatarColor(seed: string): string {
  const palette = AVATAR_PALETTES[hashAvatarSeed(seed) % AVATAR_PALETTES.length];
  return palette.start;
}

function renderAccent(
  accentIndex: number,
  palette: (typeof AVATAR_PALETTES)[number],
  layout: (typeof AVATAR_LAYOUTS)[number]
) {
  const waveLift = layout.waveLift;

  switch (accentIndex) {
    case 0:
      return (
        <>
          <Ellipse
            cx={26 + layout.centerX * 0.12}
            cy={18 + layout.centerY * 0.08}
            rx={24}
            ry={14}
            fill={palette.glow}
            opacity={0.88}
            transform={`rotate(-18 ${26 + layout.centerX * 0.12} ${18 + layout.centerY * 0.08})`}
          />
          <Path
            d={`M 0 ${86 + waveLift * 0.12} C 12 ${78 + waveLift * 0.2} 22 ${82 + waveLift * 0.14} 34 ${76 + waveLift * 0.18} C 42 ${72 + waveLift * 0.12} 50 ${72 + waveLift * 0.1} 58 ${76 + waveLift * 0.12} C 70 ${82 + waveLift * 0.12} 84 ${84 + waveLift * 0.15} 100 ${74 + waveLift * 0.2} L 100 100 L 0 100 Z`}
            fill={palette.accent}
            opacity={0.8}
          />
        </>
      );
    case 1:
      return (
        <>
          <Ellipse
            cx={78 - (50 - layout.centerX) * 0.18}
            cy={28 + layout.centerY * 0.1}
            rx={24}
            ry={15}
            fill={palette.glow}
            opacity={0.78}
            transform={`rotate(22 ${78 - (50 - layout.centerX) * 0.18} ${28 + layout.centerY * 0.1})`}
          />
          <Path
            d={`M 0 ${24 + waveLift * 0.12} C 12 ${16 + waveLift * 0.15} 28 ${18 + waveLift * 0.08} 42 ${24 + waveLift * 0.12} C 56 ${30 + waveLift * 0.15} 72 ${34 + waveLift * 0.12} 86 ${28 + waveLift * 0.1} C 94 ${24 + waveLift * 0.08} 98 ${24 + waveLift * 0.1} 100 ${20 + waveLift * 0.08} L 100 0 L 0 0 Z`}
            fill={palette.accent}
            opacity={0.82}
          />
        </>
      );
    case 2:
      return (
        <>
          <Ellipse
            cx={22 + layout.centerX * 0.08}
            cy={76 + layout.centerY * 0.04}
            rx={26}
            ry={18}
            fill={palette.glow}
            opacity={0.68}
          />
          <Path
            d={`M ${68 + layout.centerX * 0.1} ${16 + waveLift * 0.06} C ${78 + layout.centerX * 0.06} ${8 + waveLift * 0.05} ${92} ${12 + waveLift * 0.04} ${96} ${24 + waveLift * 0.06} C ${98} ${34 + waveLift * 0.08} ${92} ${42 + waveLift * 0.06} ${82} ${42 + waveLift * 0.05} C ${74 + layout.centerX * 0.04} ${42 + waveLift * 0.04} ${68 + layout.centerX * 0.04} ${34 + waveLift * 0.04} ${66 + layout.centerX * 0.04} ${26 + waveLift * 0.04} C ${66 + layout.centerX * 0.06} ${22 + waveLift * 0.05} ${66 + layout.centerX * 0.08} ${18 + waveLift * 0.05} ${68 + layout.centerX * 0.1} ${16 + waveLift * 0.06} Z`}
            fill={palette.accent}
            opacity={0.8}
          />
        </>
      );
    default:
      return (
        <>
          <Ellipse
            cx={18 + layout.centerX * 0.08}
            cy={34 + layout.centerY * 0.1}
            rx={14}
            ry={24}
            fill={palette.glow}
            opacity={0.82}
            transform={`rotate(22 ${18 + layout.centerX * 0.08} ${34 + layout.centerY * 0.1})`}
          />
          <Path
            d={`M 100 0 L 100 100 C 92 100 84 94 82 84 C 78 66 82 48 92 30 C 96 22 98 12 100 0 Z`}
            fill={palette.accent}
            opacity={0.78}
          />
        </>
      );
  }
}

export interface DefaultAvatarArtProps {
  seed: string;
  initials: string;
  size: number;
  testID?: string;
}

export interface AvatarArtPreviewProps {
  paletteIndex: number;
  layoutIndex: number;
  accentIndex: number;
  initials: string;
  size: number;
  testID?: string;
}

function getMonogramFontSize(size: number, isSingleLetterMonogram: boolean): number {
  const fontSizeSet =
    size >= LARGE_MONOGRAM_MIN_AVATAR_SIZE
      ? AVATAR_MONOGRAM_FONT_SIZE_LARGE
      : AVATAR_MONOGRAM_FONT_SIZE_SMALL;

  return isSingleLetterMonogram ? fontSizeSet.single : fontSizeSet.double;
}

export function AvatarArtPreview({
  paletteIndex,
  layoutIndex,
  accentIndex,
  initials,
  size,
  testID,
}: AvatarArtPreviewProps) {
  const palette = AVATAR_PALETTES[((paletteIndex % AVATAR_PALETTES.length) + AVATAR_PALETTES.length) % AVATAR_PALETTES.length];
  const layout = AVATAR_LAYOUTS[((layoutIndex % AVATAR_LAYOUTS.length) + AVATAR_LAYOUTS.length) % AVATAR_LAYOUTS.length];
  const normalizedAccentIndex =
    ((accentIndex % ACCENT_VARIANT_COUNT) + ACCENT_VARIANT_COUNT) % ACCENT_VARIANT_COUNT;
  const gradientId = `avatar-gradient-${paletteIndex}-${layoutIndex}-${normalizedAccentIndex}-${initials}`;
  const monogram = initials.trim().slice(0, 2).toUpperCase() || '?';
  const isSingleLetterMonogram = monogram.length === 1;
  const monogramFontSize = getMonogramFontSize(size, isSingleLetterMonogram);

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${AVATAR_VIEWBOX} ${AVATAR_VIEWBOX}`}
      testID={testID}
    >
      <Defs>
        <LinearGradient id={gradientId} x1="10%" y1="8%" x2="92%" y2="100%">
          <Stop offset="0%" stopColor={palette.start} />
          <Stop offset="100%" stopColor={palette.end} />
        </LinearGradient>
      </Defs>

      <Rect width={AVATAR_VIEWBOX} height={AVATAR_VIEWBOX} fill={`url(#${gradientId})`} />
      {renderAccent(normalizedAccentIndex, palette, layout)}

      <Ellipse
        cx={AVATAR_MONOGRAM_CENTER.x}
        cy={AVATAR_MONOGRAM_CENTER.y + 4}
        rx={24}
        ry={19}
        fill="#FFFFFF"
        opacity={0.18}
      />
      <SvgText
        x={AVATAR_MONOGRAM_CENTER.x}
        y={AVATAR_MONOGRAM_CENTER.y}
        fill={palette.letter}
        fontSize={monogramFontSize}
        fontWeight="900"
        letterSpacing={
          isSingleLetterMonogram
            ? AVATAR_MONOGRAM_LETTER_SPACING.single
            : AVATAR_MONOGRAM_LETTER_SPACING.double
        }
        textAnchor="middle"
        alignmentBaseline="middle"
        testID={testID ? `${testID}-initials` : undefined}
      >
        {monogram}
      </SvgText>
    </Svg>
  );
}

export function DefaultAvatarArt({ seed, initials, size, testID }: DefaultAvatarArtProps) {
  const hash = hashAvatarSeed(seed);

  return (
    <AvatarArtPreview
      paletteIndex={hash}
      layoutIndex={hash >>> 3}
      accentIndex={hash >>> 6}
      initials={initials}
      size={size}
      testID={testID}
    />
  );
}
