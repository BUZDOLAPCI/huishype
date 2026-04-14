import React, { type CSSProperties, type ReactNode } from 'react';
import { shadows } from '../../lib/shadows';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: CSSProperties;
  shadow?: 'card' | 'card-alt' | 'preview' | 'none';
  testID?: string;
}

export function Card({
  children,
  onPress,
  style,
  shadow = 'card',
  testID,
}: CardProps) {
  const content = (
    <div
      data-testid={testID}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        overflow: 'hidden',
        ...(shadow !== 'none' ? shadows[shadow] : null),
        ...style,
      }}
    >
      {children}
    </div>
  );

  if (!onPress) {
    return content;
  }

  return (
    <button
      type="button"
      onClick={onPress}
      style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, width: '100%', textAlign: 'inherit' }}
    >
      {content}
    </button>
  );
}
