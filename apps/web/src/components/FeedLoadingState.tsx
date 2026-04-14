import React from 'react';

/**
 * FeedLoadingState - Full-screen loading spinner for initial feed load
 */
export function FeedLoadingState() {
  return (
    <div style={styles.root} data-testid="feed-loading" role="status" aria-live="polite">
      <style>{SPINNER_KEYFRAMES}</style>
      <div style={styles.spinner} />
      <div style={styles.label}>Loading properties...</div>
    </div>
  );
}

/**
 * FeedLoadingMore - Inline loading indicator for pagination
 */
export function FeedLoadingMore() {
  return (
    <div style={styles.moreRoot} data-testid="feed-loading-more" role="status" aria-live="polite">
      <div style={{ ...styles.spinner, ...styles.spinnerSmall }} />
    </div>
  );
}

const SPINNER_KEYFRAMES = `
  @keyframes huishype-feed-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

const styles = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFBF5',
  },
  moreRoot: {
    padding: '16px 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: '3px solid rgba(222, 145, 29, 0.22)',
    borderTopColor: '#DE911D',
    animation: 'huishype-feed-spin 0.9s linear infinite',
  },
  spinnerSmall: {
    width: 18,
    height: 18,
    borderWidth: 2,
  },
  label: {
    color: '#9C958A',
    marginTop: 16,
  },
} satisfies Record<string, import('react').CSSProperties>;
