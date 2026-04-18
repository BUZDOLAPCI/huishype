import React from 'react';
import { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop, Svg, Text as SvgText } from 'react-native-svg';

const AVATAR_VIEWBOX = 100;

const AVATAR_PALETTES = [
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

const AVATAR_LAYOUTS = [
  {
    centerX: 50,
    centerY: 55,
    waveLift: 0,
  },
  {
    centerX: 47,
    centerY: 53,
    waveLift: -4,
  },
  {
    centerX: 53,
    centerY: 53,
    waveLift: -2,
  },
  {
    centerX: 48,
    centerY: 54,
    waveLift: 4,
  },
  {
    centerX: 52,
    centerY: 54,
    waveLift: 3,
  },
  {
    centerX: 50,
    centerY: 52,
    waveLift: 6,
  },
] as const;

const ACCENT_VARIANT_COUNT = 4;

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
          <Ellipse cx={26} cy={24} rx={24} ry={18} fill={palette.glow} opacity={0.9} />
          <Path
            d={`M 8 84 C 24 68 ${layout.centerX - 10} 66 ${layout.centerX} ${74 + layout.waveLift * 0.3} C ${layout.centerX + 16} 84 88 82 96 70 L 100 100 L 0 100 Z`}
            fill={palette.accent}
            opacity={0.8}
          />
        </>
      );
    case 1:
      return (
        <>
          <Circle cx={72} cy={22} r={20} fill={palette.glow} opacity={0.82} />
          <Path
            d="M 0 72 C 18 62 34 60 48 66 C 64 73 76 74 100 58 L 100 100 L 0 100 Z"
            fill={palette.accent}
            opacity={0.84}
          />
        </>
      );
    case 2:
      return (
        <>
          <Ellipse cx={20} cy={82} rx={34} ry={22} fill={palette.glow} opacity={0.7} />
          <Path
            d={`M ${layout.centerX - 24} 26 C ${layout.centerX - 18} 10 ${layout.centerX + 8} 8 ${layout.centerX + 18} 22 C ${layout.centerX + 8} 18 ${layout.centerX - 6} 20 ${layout.centerX - 24} 26 Z`}
            fill={palette.accent}
            opacity={0.8}
          />
        </>
      );
    default:
      return (
        <>
          <Circle cx={18} cy={22} r={16} fill={palette.glow} opacity={0.86} />
          <Path
            d="M 12 92 C 22 64 52 58 74 68 C 86 74 93 72 100 66 L 100 100 L 0 100 C 2 98 7 95 12 92 Z"
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

export function DefaultAvatarArt({ seed, initials, size, testID }: DefaultAvatarArtProps) {
  const hash = hashAvatarSeed(seed);
  const palette = AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
  const layout = AVATAR_LAYOUTS[(hash >>> 3) % AVATAR_LAYOUTS.length];
  const accentIndex = (hash >>> 6) % ACCENT_VARIANT_COUNT;
  const gradientId = `avatar-gradient-${hash}`;
  const monogram = initials.trim().slice(0, 2).toUpperCase() || '?';

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
      {renderAccent(accentIndex, palette, layout)}

      <Ellipse
        cx={layout.centerX}
        cy={layout.centerY + 4}
        rx={22}
        ry={18}
        fill="#FFFFFF"
        opacity={0.18}
      />
      <SvgText
        x={layout.centerX}
        y={layout.centerY}
        fill={palette.letter}
        fontSize={monogram.length > 1 ? 30 : 34}
        fontWeight="700"
        textAnchor="middle"
        alignmentBaseline="middle"
        testID={testID ? `${testID}-initials` : undefined}
      >
        {monogram}
      </SvgText>
    </Svg>
  );
}
