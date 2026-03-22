/**
 * AchievementBadge — Displays a single achievement with icon, name, and status.
 *
 * Design spec: Section 7.9 (Profile Page), achievements row.
 *
 * Variants:
 *   compact — Small icon + name, for inline lists and profile rows
 *   card   — Full card with icon, name, description, and earned state
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon, type IconName } from './Icon';
import type { AchievementDefinition, AchievementCategory } from '@huishype/shared';
import { shadows } from '../../lib/shadows';

export type AchievementVariant = 'compact' | 'card';

export interface AchievementBadgeProps {
  /** Achievement definition from the shared registry. */
  achievement: AchievementDefinition;
  /** Whether the user has earned this achievement. */
  earned?: boolean;
  /** When the achievement was earned. */
  awardedAt?: string | null;
  /** Display variant. Default 'compact'. */
  variant?: AchievementVariant;
  testID?: string;
}

/**
 * Category-specific tint colours for earned achievements.
 */
const CATEGORY_COLORS: Record<AchievementCategory, { bg: string; icon: string; text: string }> = {
  social: { bg: '#D1FAE5', icon: '#15803D', text: '#15803D' },
  guessing: { bg: '#FFF3C4', icon: '#B47712', text: '#B47712' },
  exploration: { bg: '#BBDEFB', icon: '#1565C0', text: '#1565C0' },
  milestone: { bg: '#FFE0D6', icon: '#C43E00', text: '#C43E00' },
};

const LOCKED_COLORS = {
  bg: '#F5F0E8',
  icon: '#C7BFB3',
  text: '#9C958A',
};

/**
 * Validate that the icon name from the achievement registry is a valid Phosphor icon.
 * Falls back to 'Star' if the icon is not recognized.
 */
function getValidIconName(iconName: string): IconName {
  const validIcons: ReadonlySet<string> = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowSquareOut', 'Bell', 'BookmarkSimple',
    'Buildings', 'Calendar', 'Camera', 'CaretDown', 'CaretLeft', 'CaretRight',
    'ChartLineUp', 'ChatCircle', 'Check', 'CheckCircle', 'Crown', 'Crosshair',
    'CurrencyEur', 'DotsThreeVertical', 'Envelope', 'Eye', 'Flame', 'GearSix',
    'Globe', 'Heart', 'HouseLine', 'Info', 'Link', 'List', 'ListBullets',
    'MagnifyingGlass', 'MapPin', 'MapTrifold', 'Medal', 'PaperPlaneTilt',
    'Plus', 'Ruler', 'ShareNetwork', 'ShieldCheck', 'SignOut', 'Star',
    'Tag', 'Thermometer', 'TrendDown', 'Trophy', 'User', 'Users',
    'WarningCircle', 'X',
  ]);

  if (validIcons.has(iconName)) {
    return iconName as IconName;
  }
  return 'Star';
}

export function AchievementBadge({
  achievement,
  earned = false,
  awardedAt,
  variant = 'compact',
  testID,
}: AchievementBadgeProps) {
  const colors = earned ? CATEGORY_COLORS[achievement.category] : LOCKED_COLORS;
  const iconName = getValidIconName(achievement.icon);

  if (variant === 'compact') {
    return (
      <View
        style={[styles.compactContainer, { backgroundColor: colors.bg }]}
        testID={testID ?? 'achievement-badge'}
        accessibilityLabel={`${achievement.name}${earned ? ', earned' : ', locked'}`}
        accessibilityRole="image"
      >
        <Icon
          name={iconName}
          size={14}
          weight={earned ? 'fill' : 'regular'}
          color={colors.icon}
        />
        <Text
          style={[styles.compactLabel, { color: colors.text }]}
          numberOfLines={1}
        >
          {achievement.name}
        </Text>
      </View>
    );
  }

  // Card variant
  return (
    <View
      style={[
        styles.cardContainer,
        earned ? shadows.card : undefined,
        { opacity: earned ? 1 : 0.6 },
      ]}
      testID={testID ?? 'achievement-badge-card'}
      accessibilityLabel={`${achievement.name}: ${achievement.description}${earned ? ', earned' : ', locked'}`}
      accessibilityRole="image"
    >
      <View style={[styles.cardIconContainer, { backgroundColor: colors.bg }]}>
        <Icon
          name={iconName}
          size="lg"
          weight={earned ? 'fill' : 'regular'}
          color={colors.icon}
        />
      </View>
      <View style={styles.cardContent}>
        <Text
          style={[styles.cardName, { color: earned ? '#2D2926' : '#9C958A' }]}
          numberOfLines={1}
        >
          {achievement.name}
        </Text>
        <Text
          style={[styles.cardDescription, { color: earned ? '#736C62' : '#C7BFB3' }]}
          numberOfLines={2}
        >
          {achievement.description}
        </Text>
        {earned && awardedAt && (
          <Text style={styles.cardEarnedDate}>
            Earned {formatRelativeDate(awardedAt)}
          </Text>
        )}
      </View>
      {earned && (
        <View style={styles.cardEarnedIndicator}>
          <Icon name="CheckCircle" size={16} weight="fill" color="#4CAF50" />
        </View>
      )}
    </View>
  );
}

/**
 * Simple relative date for achievement card display.
 */
function formatRelativeDate(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

const styles = StyleSheet.create({
  // Compact variant
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  compactLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // Card variant
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardDescription: {
    fontSize: 12,
    marginTop: 2,
  },
  cardEarnedDate: {
    fontSize: 11,
    color: '#9C958A',
    marginTop: 4,
  },
  cardEarnedIndicator: {
    marginLeft: 4,
  },
});
