/**
 * FeedErrorState — Error display with retry option.
 */

import React from 'react';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

interface FeedErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function FeedErrorState({
  message = 'Something went wrong',
  onRetry,
}: FeedErrorStateProps) {
  return (
    <div style={styles.root} data-testid="feed-error">
      <div style={styles.iconWrap}>
        <Icon name="WarningCircle" size="2xl" color="#E53935" />
      </div>
      <div style={styles.title}>Oops!</div>
      <div style={styles.message}>{message}</div>
      {onRetry && (
        <Button
          label="Try Again"
          onPress={onRetry}
          style={{ paddingLeft: 24, paddingRight: 24 }}
          testID="feed-retry-button"
        />
      )}
    </div>
  );
}

const styles = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFBF5',
    padding: '0 24px',
    textAlign: 'center' as const,
  },
  iconWrap: {
    backgroundColor: '#FEF2F2',
    padding: 16,
    borderRadius: 999,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: '#2D2926',
    marginBottom: 8,
  },
  message: {
    color: '#736C62',
    marginBottom: 24,
  },
} satisfies Record<string, import('react').CSSProperties>;
