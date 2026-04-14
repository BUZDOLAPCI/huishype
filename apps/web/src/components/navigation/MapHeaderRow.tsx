import React from 'react';
import { HuisHypeLogo } from '../branding';

interface MapHeaderRowProps {
  cityName?: string;
  testID?: string;
}

export function MapHeaderRow({ cityName, testID }: MapHeaderRowProps) {
  return (
    <div
      data-testid={testID ?? 'map-header-row'}
      role="banner"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        paddingBottom: 8,
        pointerEvents: 'none',
      }}
    >
      <HuisHypeLogo
        variant="lockup"
        size={28}
        wordmarkSize={22}
        style={{ flexShrink: 1 }}
        textStyle={{
          fontSize: 22,
          color: '#F5A623',
          letterSpacing: -0.2,
          lineHeight: '28px',
        }}
      />

      {cityName ? (
        <span
          aria-label={`Current location: ${cityName}`}
          style={{
            fontSize: 18,
            fontFamily: 'Inter_600SemiBold, Inter, sans-serif',
            color: '#3D3832',
            lineHeight: '25px',
          }}
        >
          {cityName}
        </span>
      ) : null}
    </div>
  );
}
