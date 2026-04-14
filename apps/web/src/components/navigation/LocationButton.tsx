import React from 'react';
import { Icon } from '@/src/components/ui/Icon';
import { BlurContainer } from '@/src/components/ui/BlurContainer';

interface LocationButtonProps {
  onPress?: () => void;
  testID?: string;
}

export function LocationButton({ onPress, testID }: LocationButtonProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      data-testid={testID ?? 'location-button'}
      aria-label="Current location"
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        border: 'none',
        padding: 0,
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      <BlurContainer
        intensity={48}
        tint="light"
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.09), 0 1px 3px rgba(0,0,0,0.06)',
          backgroundColor: 'rgba(255, 255, 255, 0.87)',
        }}
      >
        <Icon name="Crosshair" size="lg" weight="regular" color="#504A42" />
      </BlurContainer>
    </button>
  );
}
