import React, { type ReactNode } from 'react';

export interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  leading?: ReactNode;
  disabled?: boolean;
  testID?: string;
}

export function Chip({
  label,
  active = false,
  onPress,
  leading,
  disabled = false,
  testID,
}: ChipProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      data-testid={testID}
      aria-label={label}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 20,
        padding: '8px 16px',
        border: active ? '1px solid #F5A623' : '1px solid #E8E0D4',
        backgroundColor: active ? '#F5A623' : '#FFFFFF',
        color: active ? '#FFFFFF' : '#504A42',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
      }}
    >
      {leading ? <span style={{ display: 'inline-flex' }}>{leading}</span> : null}
      <span>{label}</span>
    </button>
  );
}
