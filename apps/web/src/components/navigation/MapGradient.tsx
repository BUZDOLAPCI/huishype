import React from 'react';

interface MapGradientProps {
  position: 'top' | 'bottom';
  testID?: string;
}

const GRADIENT_CONFIG = {
  top: {
    height: 180,
    backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.73) 0%, rgba(255,255,255,0) 100%)',
  },
  bottom: {
    height: 140,
    backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.80) 100%)',
  },
} as const;

export function MapGradient({ position, testID }: MapGradientProps) {
  const config = GRADIENT_CONFIG[position];

  return (
    <div
      data-testid={testID}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        zIndex: 1,
        height: config.height,
        backgroundImage: config.backgroundImage,
        pointerEvents: 'none',
        ...(position === 'top' ? { top: 0 } : { bottom: 0 }),
      }}
    />
  );
}
