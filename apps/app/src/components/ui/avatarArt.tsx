import React from 'react';
import { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop, Svg, Text as SvgText } from 'react-native-svg';

const AVATAR_VIEWBOX = 100;
const AVATAR_MONOGRAM_CENTER = {
  x: 50,
  y: 54,
} as const;
const AVATAR_MONOGRAM_FONT_SIZE = {
  single: 44,
  double: 38,
} as const;
const AVATAR_MONOGRAM_LETTER_SPACING = {
  single: 0.8,
  double: 4.5,
} as const;
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
    label: 'Top glow + bottom wave',
  },
  {
    id: 1,
    label: 'Top-right orb + low horizon',
  },
  {
    id: 2,
    label: 'Bottom-left glow + top crest',
  },
  {
    id: 3,
    label: 'Top-left orb + rising sweep',
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
  switch (accentIndex) {
    case 0:
      return (
        <>
          <Ellipse
            cx={layout.centerX - 18}
            cy={layout.centerY - 18}
            rx={24}
            ry={18}
            fill={palette.glow}
            opacity={0.9}
          />
          <Path
            d={`M 0 ${86 + layout.waveLift * 0.25} C 18 ${68 + layout.waveLift} ${layout.centerX - 14} ${60 + layout.waveLift * 0.45} ${layout.centerX + 2} ${74 + layout.waveLift * 0.25} C ${layout.centerX + 22} 88 84 86 100 ${66 + layout.waveLift * 0.3} L 100 100 L 0 100 Z`}
            fill={palette.accent}
            opacity={0.8}
          />
        </>
      );
    case 1:
      return (
        <>
          <Circle
            cx={layout.centerX + 18}
            cy={layout.centerY - 14}
            r={20}
            fill={palette.glow}
            opacity={0.82}
          />
          <Path
            d={`M 0 ${74 + layout.waveLift * 0.2} C 16 ${60 + layout.waveLift * 0.45} ${layout.centerX - 6} ${58 + layout.waveLift * 0.25} ${layout.centerX + 10} ${66 + layout.waveLift * 0.2} C ${layout.centerX + 28} 76 78 76 100 ${54 + layout.waveLift * 0.35} L 100 100 L 0 100 Z`}
            fill={palette.accent}
            opacity={0.84}
          />
        </>
      );
    case 2:
      return (
        <>
          <Ellipse
            cx={layout.centerX - 26}
            cy={layout.centerY + 24}
            rx={34}
            ry={22}
            fill={palette.glow}
            opacity={0.7}
          />
          <Path
            d={`M ${layout.centerX - 28} ${layout.centerY - 12} C ${layout.centerX - 20} ${layout.centerY - 30} ${layout.centerX + 8} ${layout.centerY - 32} ${layout.centerX + 20} ${layout.centerY - 14} C ${layout.centerX + 6} ${layout.centerY - 18} ${layout.centerX - 10} ${layout.centerY - 16} ${layout.centerX - 28} ${layout.centerY - 12} Z`}
            fill={palette.accent}
            opacity={0.8}
          />
        </>
      );
    default:
      return (
        <>
          <Circle
            cx={layout.centerX - 26}
            cy={layout.centerY - 18}
            r={16}
            fill={palette.glow}
            opacity={0.86}
          />
          <Path
            d={`M ${layout.centerX - 30} ${88 + layout.waveLift * 0.15} C ${layout.centerX - 18} ${58 + layout.waveLift * 0.45} ${layout.centerX + 10} ${54 + layout.waveLift * 0.25} ${layout.centerX + 26} ${66 + layout.waveLift * 0.2} C ${layout.centerX + 38} 74 90 74 100 ${62 + layout.waveLift * 0.3} L 100 100 L 0 100 C 4 98 10 94 ${layout.centerX - 30} ${88 + layout.waveLift * 0.15} Z`}
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
        fontSize={
          isSingleLetterMonogram
            ? AVATAR_MONOGRAM_FONT_SIZE.single
            : AVATAR_MONOGRAM_FONT_SIZE.double
        }
        fontWeight="700"
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
