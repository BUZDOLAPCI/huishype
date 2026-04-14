import React, { type CSSProperties } from 'react';

type HuisHypeLogoVariant = 'mark' | 'lockup';

interface HuisHypeLogoProps {
  variant?: HuisHypeLogoVariant;
  size?: number;
  wordmarkSize?: number;
  label?: string;
  style?: CSSProperties;
  iconStyle?: CSSProperties;
  textStyle?: CSSProperties;
}

const WORDMARK_COLOR = '#F5A623';
const WORDMARK_LINE_HEIGHT_RATIO = 1.27;

export function HuisHypeLogo({
  variant = 'mark',
  size = 64,
  wordmarkSize = 20,
  label,
  style,
  iconStyle,
  textStyle,
}: HuisHypeLogoProps) {
  const accessibilityLabel = label ?? (variant === 'lockup' ? 'HuisHype' : 'HuisHype logo');

  return (
    <div
      aria-label={accessibilityLabel}
      role="img"
      style={{ display: 'inline-flex', alignItems: 'center', ...style }}
    >
      <div style={{ position: 'relative', width: size, height: size, ...iconStyle }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: Math.round(size * 0.24),
            backgroundColor: '#FFD133',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: Math.round(size * 0.72),
            height: Math.round(size * 0.72),
            borderRadius: Math.round(size * 0.22),
            left: Math.round(size * 0.14),
            top: Math.round(size * 0.12),
            backgroundColor: '#FFF8E0',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: Math.round(size * 0.26),
            height: Math.round(size * 0.26),
            borderRadius: Math.round(size * 0.13),
            left: Math.round(size * 0.2),
            top: Math.round(size * 0.34),
            backgroundColor: '#F5A623',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: Math.round(size * 0.18),
            height: Math.round(size * 0.18),
            left: Math.round(size * 0.56),
            top: Math.round(size * 0.64),
            borderRadius: Math.round(size * 0.04),
            backgroundColor: '#FFF8E0',
            transform: 'rotate(45deg)',
          }}
        />
      </div>
      {variant === 'lockup' ? (
        <span
          style={{
            marginLeft: 6,
            color: WORDMARK_COLOR,
            fontFamily: 'Inter_700Bold, Inter, sans-serif',
            fontSize: wordmarkSize,
            lineHeight: `${Math.round(wordmarkSize * WORDMARK_LINE_HEIGHT_RATIO)}px`,
            letterSpacing: -0.2,
            ...textStyle,
          }}
        >
          HuisHype
        </span>
      ) : null}
    </div>
  );
}
