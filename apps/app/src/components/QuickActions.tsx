/**
 * QuickActions — Row of quick action buttons for property interaction.
 *
 * Design spec: Section 7.6 (Preview Card quick actions), Section 7.7 (Detail page action row).
 *
 * Supports two variants:
 *   compact — Horizontal row with icon + label, used in preview cards
 *   full    — Larger buttons with icon + label, used in property detail
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Icon, type IconName, type IconWeight } from './ui/Icon';

export type QuickActionsVariant = 'compact' | 'full';

const FULL_ACTION_BASE_COLOR = '#504A42';

export interface QuickActionsProps {
  /** Whether the user has liked this property. */
  isLiked?: boolean;
  /** Whether the user has saved this property. */
  isSaved?: boolean;
  /** Number of likes. */
  likeCount?: number;
  /** Number of comments. */
  commentCount?: number;
  /** Number of guesses. */
  guessCount?: number;
  /** Callbacks. */
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
  onSave?: () => void;
  onShare?: () => void;
  /** Display variant. Default 'compact'. */
  variant?: QuickActionsVariant;
  testID?: string;
}

interface ActionConfig {
  key: string;
  icon: IconName;
  activeIcon?: IconName;
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
  const actions: ActionConfig[] = [];

  // Like
  actions.push({
    key: 'like',
    icon: 'Heart',
    label: 'Like',
    activeLabel: 'Liked',
    color: '#8C6B76',
    activeColor: '#FF6B35',
    weight: 'regular',
    activeWeight: 'fill',
    count: likeCount,
    isActive: isLiked,
    onPress: onLike,
  });

  // Comment
  actions.push({
    key: 'comment',
    icon: 'ChatCircle',
    label: 'Comment',
    color: '#607A6A',
    activeColor: '#607A6A',
    weight: 'regular',
    activeWeight: 'regular',
    count: commentCount,
    isActive: false,
    onPress: onComment,
  });

  // Guess
  actions.push({
    key: 'guess',
    icon: 'Tag',
    label: 'Guess',
    color: '#7A7A5C',
    activeColor: '#7A7A5C',
    weight: 'regular',
    activeWeight: 'regular',
    count: guessCount,
    isActive: false,
    onPress: onGuess,
  });

  // Save (full variant only)
  if (variant === 'full' && onSave) {
    actions.push({
      key: 'save',
      icon: 'BookmarkSimple',
      label: 'Save',
      activeLabel: 'Saved',
      color: '#C7BFB3',
      activeColor: '#F5A623',
      weight: 'regular',
      activeWeight: 'fill',
      isActive: isSaved,
      onPress: onSave,
    });
  }

  // Share (full variant only)
  if (variant === 'full' && onShare) {
    actions.push({
      key: 'share',
      icon: 'ShareNetwork',
      label: 'Share',
      color: '#C7BFB3',
      activeColor: '#C7BFB3',
      weight: 'regular',
      activeWeight: 'regular',
      isActive: false,
      onPress: onShare,
    });
  }

  return (
    <View
      style={variant === 'compact' ? styles.compactContainer : styles.fullContainer}
      testID={testID ?? 'quick-actions'}
    >
      {actions.map((action) => (
        <ActionButton key={action.key} action={action} variant={variant} />
      ))}
    </View>
  );
}

function ActionButton({
  action,
  variant,
}: {
  action: ActionConfig;
  variant: QuickActionsVariant;
}) {
  const color =
    variant === 'full' && !action.isActive
      ? FULL_ACTION_BASE_COLOR
      : action.isActive
        ? action.activeColor
        : action.color;
  const weight = action.isActive ? action.activeWeight : action.weight;
  const label = action.isActive && action.activeLabel ? action.activeLabel : action.label;

  if (variant === 'full') {
    return (
      <Pressable
        onPress={(e) => {
          e?.stopPropagation?.();
          action.onPress?.();
        }}
        style={({ pressed }) => [
          styles.fullButton,
          pressed && styles.fullButtonPressed,
        ]}
        testID={`quick-action-${action.key}`}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Icon name={action.icon} size="lg" weight={weight} color={color} />
        <Text style={[styles.fullLabel, { color }]}>{label}</Text>
      </Pressable>
    );
  }

  // Compact variant
  return (
    <Pressable
      onPress={(e) => {
        e?.stopPropagation?.();
        action.onPress?.();
      }}
      style={styles.compactButton}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      testID={`quick-action-${action.key}`}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={action.icon} size="md" weight={weight} color={color} />
      {action.count !== undefined && action.count > 0 && (
        <Text style={[styles.compactCount, { color }]}>
          {formatCompactCount(action.count)}
        </Text>
      )}
      {(!action.count || action.count === 0) && (
        <Text style={[styles.compactLabel, { color }]}>{label}</Text>
      )}
    </Pressable>
  );
}

function formatCompactCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

const styles = StyleSheet.create({
  // Compact variant
  compactContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#F5F0E8',
    paddingTop: 10,
    paddingBottom: 12,
  },
  compactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 8,
    gap: 4,
  },
  compactCount: {
    fontSize: 13,
    fontWeight: '600',
  },
  compactLabel: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Full variant
  fullContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  fullButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D4',
    gap: 6,
  },
  fullButtonPressed: {
    backgroundColor: '#FFFBF5',
  },
  fullLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
});
