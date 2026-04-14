import React, { type CSSProperties, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  style?: CSSProperties;
  testID?: string;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 52 };
const FONT_SIZE: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };
const PADDING_H: Record<ButtonSize, number> = { sm: 12, md: 16, lg: 20 };

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  onPress,
  disabled = false,
  accessibilityLabel,
  leading,
  trailing,
  style,
  testID,
}: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      data-testid={testID}
      aria-label={accessibilityLabel ?? label}
      style={{
        ...baseStyle,
        height: HEIGHT[size],
        padding: `0 ${PADDING_H[size]}px`,
        fontSize: FONT_SIZE[size],
        ...(disabled ? disabledStyle : null),
        ...variantStyles[variant],
        ...style,
      }}
    >
      {leading ? <span style={{ display: 'inline-flex', marginRight: 8 }}>{leading}</span> : null}
      <span>{label}</span>
      {trailing ? <span style={{ display: 'inline-flex', marginLeft: 8 }}>{trailing}</span> : null}
    </button>
  );
}

const baseStyle: CSSProperties = {
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 12,
  cursor: 'pointer',
  fontWeight: 600,
  fontFamily: 'inherit',
  transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease',
};

const disabledStyle: CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: {
    backgroundColor: '#F5A623',
    color: '#FFFFFF',
  },
  secondary: {
    backgroundColor: 'transparent',
    border: '1px solid #F5A623',
    color: '#B47712',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: '#504A42',
  },
};
