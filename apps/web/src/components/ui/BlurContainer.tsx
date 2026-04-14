import React, { type CSSProperties, type ReactNode } from 'react';

export interface BlurContainerProps {
  intensity?: number;
  tint?: 'light' | 'dark' | 'default';
  style?: CSSProperties;
  children?: ReactNode;
  testID?: string;
}

function tintToBackground(tint: 'light' | 'dark' | 'default'): string {
  switch (tint) {
    case 'dark':
      return 'rgba(0,0,0,0.4)';
    case 'light':
      return 'rgba(255,255,255,0.7)';
    default:
      return 'rgba(255,255,255,0.5)';
  }
}

export function BlurContainer({
  intensity = 80,
  tint = 'light',
  style,
  children,
  testID,
}: BlurContainerProps) {
  const blurRadius = Math.round(intensity * 0.25);

  return (
    <div
      data-testid={testID}
      style={{
        overflow: 'hidden',
        backdropFilter: `blur(${blurRadius}px)`,
        WebkitBackdropFilter: `blur(${blurRadius}px)`,
        backgroundColor: tintToBackground(tint),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
