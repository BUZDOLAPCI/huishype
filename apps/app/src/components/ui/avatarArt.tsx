import React from 'react';
import { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop, Svg, Text as SvgText } from 'react-native-svg';

const AVATAR_VIEWBOX = 100;

const AVATAR_PALETTES = [
  {
    start: '#D6B4AB',
    end: '#B98C86',
    glow: '#F1DFD8',
    accent: '#9A6F6F',
    scrim: '#7B5B5D',
    letter: '#FFF7EE',
  },
  {
    start: '#BDD1BB',
    end: '#90A18E',
    glow: '#E4EEDD',
    accent: '#728576',
    scrim: '#5D6A60',
    letter: '#FAF8EF',
  },
  {
    start: '#BCC8DE',
    end: '#8E9AB6',
    glow: '#E2E7F3',
    accent: '#6E7899',
    scrim: '#59617D',
    letter: '#FBF8FF',
  },
  {
    start: '#D9B2C2',
    end: '#B98599',
    glow: '#F0D8E1',
    accent: '#946B7F',
    scrim: '#7C5968',
    letter: '#FFF7FA',
  },
  {
    start: '#D6C294',
    end: '#B19771',
    glow: '#EEE2BD',
    accent: '#927958',
    scrim: '#75614B',
    letter: '#FFF8EE',
  },
  {
    start: '#AFCFC8',
    end: '#7EA39F',
    glow: '#DDF0EA',
    accent: '#5F8683',
    scrim: '#4C6B68',
    letter: '#F7FCFA',
  },
  {
    start: '#C8B5D9',
    end: '#A08AB6',
    glow: '#EBE0F4',
    accent: '#7E6B98',
    scrim: '#655872',
    letter: '#FCF8FF',
  },
  {
    start: '#DAB8A1',
    end: '#BA8E76',
    glow: '#F2DECF',
    accent: '#976F5F',
    scrim: '#7A5B50',
    letter: '#FFF6EE',
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
          <Ellipse cx={26} cy={24} rx={24} ry={18} fill={palette.glow} opacity={0.72} />
          <Path
            d={`M 8 84 C 24 68 ${layout.centerX - 10} 66 ${layout.centerX} ${74 + layout.waveLift * 0.3} C ${layout.centerX + 16} 84 88 82 96 70 L 100 100 L 0 100 Z`}
            fill={palette.accent}
            opacity={0.78}
          />
        </>
      );
    case 1:
      return (
        <>
          <Circle cx={72} cy={22} r={20} fill={palette.glow} opacity={0.7} />
          <Path
            d="M 0 72 C 18 62 34 60 48 66 C 64 73 76 74 100 58 L 100 100 L 0 100 Z"
            fill={palette.accent}
            opacity={0.8}
          />
        </>
      );
    case 2:
      return (
        <>
          <Ellipse cx={20} cy={82} rx={34} ry={22} fill={palette.glow} opacity={0.62} />
          <Path
            d={`M ${layout.centerX - 24} 26 C ${layout.centerX - 18} 10 ${layout.centerX + 8} 8 ${layout.centerX + 18} 22 C ${layout.centerX + 8} 18 ${layout.centerX - 6} 20 ${layout.centerX - 24} 26 Z`}
            fill={palette.accent}
            opacity={0.78}
          />
        </>
      );
    default:
      return (
        <>
          <Circle cx={18} cy={22} r={16} fill={palette.glow} opacity={0.72} />
          <Path
            d="M 12 92 C 22 64 52 58 74 68 C 86 74 93 72 100 66 L 100 100 L 0 100 C 2 98 7 95 12 92 Z"
            fill={palette.accent}
            opacity={0.76}
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
        rx={26}
        ry={20}
        fill={palette.scrim}
        opacity={0.28}
      />
      <Ellipse
        cx={layout.centerX}
        cy={layout.centerY + 2}
        rx={20}
        ry={15}
        fill={palette.glow}
        opacity={0.12}
      />
      <SvgText
        x={layout.centerX}
        y={layout.centerY + 1.4}
        fill={palette.scrim}
        opacity={0.24}
        fontSize={monogram.length > 1 ? 34 : 40}
        fontWeight="800"
        letterSpacing={monogram.length > 1 ? 0.8 : 0}
        textAnchor="middle"
        alignmentBaseline="middle"
      >
        {monogram}
      </SvgText>
      <SvgText
        x={layout.centerX}
        y={layout.centerY}
        fill={palette.letter}
        fontSize={monogram.length > 1 ? 34 : 40}
        fontWeight="800"
        letterSpacing={monogram.length > 1 ? 0.8 : 0}
        textAnchor="middle"
        alignmentBaseline="middle"
        testID={testID ? `${testID}-initials` : undefined}
      >
        {monogram}
      </SvgText>
    </Svg>
  );
}
