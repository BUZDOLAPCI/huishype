/**
 * FeedEmptyState — Display when no properties match the active feed filter.
 */

import React from 'react';
import { Icon } from './ui/Icon';
import type { FeedTab } from '../hooks/useFeed';

interface FeedEmptyStateProps {
  filter?: FeedTab;
}

export function FeedEmptyState({ filter }: FeedEmptyStateProps) {
  const message = (() => {
    switch (filter) {
      case 'latest':
        return 'No recent properties found. Check back later!';
      case 'trending':
        return 'No trending properties at the moment.';
      case 'recent-activity':
        return 'No recent activity yet. Be the first to like, comment, or guess!';
      default:
        return 'No properties to show.';
    }
  })();

  return (
    <div style={styles.root} data-testid="feed-empty">
      <div style={styles.iconWrap}>
        <Icon name="HouseLine" size="2xl" color="#C7BFB3" />
      </div>
      <div style={styles.title}>No properties found</div>
      <div style={styles.message}>{message}</div>
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
    backgroundColor: '#F5F0E8',
    padding: 20,
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
    color: '#9C958A',
  },
} satisfies Record<string, import('react').CSSProperties>;
