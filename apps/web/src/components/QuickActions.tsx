/**
 * QuickActions — Row of quick action buttons for property interaction.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { Icon, type IconName, type IconWeight } from './ui/Icon';

export type QuickActionsVariant = 'compact' | 'full';

export interface QuickActionsProps {
  isLiked?: boolean;
  isSaved?: boolean;
  likeCount?: number;
  commentCount?: number;
  guessCount?: number;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
  onSave?: () => void;
  onShare?: () => void;
  variant?: QuickActionsVariant;
  testID?: string;
}

interface ActionConfig {
  key: string;
  icon: IconName;
  label: string;
  activeLabel?: string;
  color: string;
  activeColor: string;
  weight: IconWeight;
  activeWeight: IconWeight;
  count?: number;
  isActive: boolean;
  onPress?: () => void;
}

export function QuickActions({
  isLiked = false,
  isSaved = false,
  likeCount,
  commentCount,
  guessCount,
  onLike,
  onComment,
  onGuess,
  onSave,
  onShare,
  variant = 'compact',
  testID,
}: QuickActionsProps) {
  const actions: ActionConfig[] = [
    { key: 'like', icon: 'Heart', label: 'Like', activeLabel: 'Liked', color: '#8C6B76', activeColor: '#FF6B35', weight: 'regular', activeWeight: 'fill', count: likeCount, isActive: isLiked, onPress: onLike },
    { key: 'comment', icon: 'ChatCircle', label: 'Comment', color: '#607A6A', activeColor: '#607A6A', weight: 'regular', activeWeight: 'regular', count: commentCount, isActive: false, onPress: onComment },
    { key: 'guess', icon: 'Tag', label: 'Guess', color: '#7A7A5C', activeColor: '#7A7A5C', weight: 'regular', activeWeight: 'regular', count: guessCount, isActive: false, onPress: onGuess },
  ];

  if (variant === 'full' && onSave) {
    actions.push({ key: 'save', icon: 'BookmarkSimple', label: 'Save', activeLabel: 'Saved', color: '#C7BFB3', activeColor: '#F5A623', weight: 'regular', activeWeight: 'fill', isActive: isSaved, onPress: onSave });
  }
  if (variant === 'full' && onShare) {
    actions.push({ key: 'share', icon: 'ShareNetwork', label: 'Share', color: '#C7BFB3', activeColor: '#C7BFB3', weight: 'regular', activeWeight: 'regular', isActive: false, onPress: onShare });
  }

  return (
    <div style={variant === 'compact' ? styles.compactContainer : styles.fullContainer} data-testid={testID ?? 'quick-actions'}>
      {actions.map((action) => (
        <ActionButton key={action.key} action={action} variant={variant} />
      ))}
    </div>
  );
}

function ActionButton({ action, variant }: { action: ActionConfig; variant: QuickActionsVariant }) {
  const color = action.isActive ? action.activeColor : action.color;
  const weight = action.isActive ? action.activeWeight : action.weight;
  const label = action.isActive && action.activeLabel ? action.activeLabel : action.label;

  const common = {
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      action.onPress?.();
    },
    type: 'button' as const,
    'aria-label': label,
    style: variant === 'full' ? styles.fullButton : styles.compactButton,
  };

  if (variant === 'full') {
    return (
      <button {...common} data-testid={`quick-action-${action.key}`}>
        <Icon name={action.icon} size="lg" weight={weight} color={color} />
        <span style={{ ...styles.fullLabel, color }}>{label}</span>
      </button>
    );
  }

  return (
    <button {...common} data-testid={`quick-action-${action.key}`}>
      <Icon name={action.icon} size="md" weight={weight} color={color} />
      {action.count !== undefined && action.count > 0 ? (
        <span style={{ ...styles.compactCount, color }}>{formatCompactCount(action.count)}</span>
      ) : (
        <span style={{ ...styles.compactLabel, color }}>{label}</span>
      )}
    </button>
  );
}

function formatCompactCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

const styles: Record<string, CSSProperties> = {
  compactContainer: {
    display: 'flex',
    justifyContent: 'space-around',
    borderTop: '1px solid #F5F0E8',
    paddingTop: 10,
    paddingBottom: 12,
  },
  compactButton: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    minWidth: 44,
    padding: '0 8px',
    gap: 4,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: 'inherit',
  },
  compactCount: { fontSize: 13, fontWeight: 600 },
  compactLabel: { fontSize: 13, fontWeight: 600 },
  fullContainer: { display: 'flex', gap: 12 },
  fullButton: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 8px',
    borderRadius: 12,
    border: '1px solid #E8E0D4',
    background: '#FFFFFF',
    cursor: 'pointer',
    color: 'inherit',
  },
  fullLabel: { marginTop: 4, fontSize: 12, fontWeight: 600 },
};
