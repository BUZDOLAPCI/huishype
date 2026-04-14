/**
 * AchievementBadge — Displays a single achievement with icon, name, and status.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { Icon, type IconName } from './Icon';
import type { AchievementDefinition, AchievementCategory } from '@huishype/shared';
import { shadows } from '../../lib/shadows';

export type AchievementVariant = 'compact' | 'card';

export interface AchievementBadgeProps {
  achievement: AchievementDefinition;
  earned?: boolean;
  awardedAt?: string | null;
  variant?: AchievementVariant;
  testID?: string;
}

const CATEGORY_COLORS: Record<AchievementCategory, { bg: string; icon: string; text: string }> = {
  social: { bg: '#D1FAE5', icon: '#15803D', text: '#15803D' },
  guessing: { bg: '#FFF3C4', icon: '#B47712', text: '#B47712' },
  exploration: { bg: '#BBDEFB', icon: '#1565C0', text: '#1565C0' },
  milestone: { bg: '#FFE0D6', icon: '#C43E00', text: '#C43E00' },
};

const LOCKED_COLORS = { bg: '#F5F0E8', icon: '#C7BFB3', text: '#9C958A' };

function getValidIconName(iconName: string): IconName {
  const validIcons = new Set<IconName>([
    'ArrowLeft', 'ArrowRight', 'ArrowSquareOut', 'Bell', 'BookmarkSimple', 'Buildings', 'Calendar', 'Camera',
    'CaretDown', 'CaretLeft', 'CaretRight', 'ChartLineUp', 'ChatCircle', 'Check', 'CheckCircle', 'Crown',
    'Crosshair', 'CurrencyEur', 'DotsThreeVertical', 'Envelope', 'Eye', 'Flame', 'GearSix', 'Globe',
    'Heart', 'HouseLine', 'Info', 'Link', 'List', 'ListBullets', 'MagnifyingGlass', 'MapPin', 'MapTrifold',
    'Medal', 'PaperPlaneTilt', 'Plus', 'Ruler', 'ShareNetwork', 'ShieldCheck', 'SignOut', 'Star', 'Tag',
    'Thermometer', 'TrendDown', 'TrendUp', 'Trophy', 'User', 'Users', 'WarningCircle', 'X',
  ]);
  return validIcons.has(iconName as IconName) ? (iconName as IconName) : 'Star';
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
      <div
        style={{ ...styles.compactContainer, backgroundColor: colors.bg }}
        data-testid={testID ?? 'achievement-badge'}
        aria-label={`${achievement.name}${earned ? ', earned' : ', locked'}`}
      >
        <Icon name={iconName} size={14} weight={earned ? 'fill' : 'regular'} color={colors.icon} />
        <span style={{ ...styles.compactLabel, color: colors.text }}>{achievement.name}</span>
      </div>
    );
  }

  return (
    <div
      style={{ ...styles.cardContainer, ...(earned ? shadows.card : {}), opacity: earned ? 1 : 0.6 }}
      data-testid={testID ?? 'achievement-badge-card'}
      aria-label={`${achievement.name}: ${achievement.description}${earned ? ', earned' : ', locked'}`}
    >
      <div style={{ ...styles.cardIconContainer, backgroundColor: colors.bg }}>
        <Icon name={iconName} size="lg" weight={earned ? 'fill' : 'regular'} color={colors.icon} />
      </div>
      <div style={styles.cardContent}>
        <div style={{ ...styles.cardName, color: earned ? '#2D2926' : '#9C958A' }}>{achievement.name}</div>
        <div style={{ ...styles.cardDescription, color: earned ? '#736C62' : '#C7BFB3' }}>{achievement.description}</div>
        {earned && awardedAt && <div style={styles.cardEarnedDate}>Earned {formatRelativeDate(awardedAt)}</div>}
      </div>
      {earned && (
        <div style={styles.cardEarnedIndicator}>
          <Icon name="CheckCircle" size={16} weight="fill" color="#4CAF50" />
        </div>
      )}
    </div>
  );
}

function formatRelativeDate(isoDate: string): string {
  const diffDays = Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

const styles: Record<string, CSSProperties> = {
  compactContainer: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 8,
    padding: '4px 8px',
    gap: 4,
  },
  compactLabel: { fontSize: 11, fontWeight: 600, letterSpacing: 0.5 },
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  cardIconContainer: { width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cardContent: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardDescription: { fontSize: 12, marginTop: 2 },
  cardEarnedDate: { fontSize: 11, color: '#9C958A', marginTop: 4 },
  cardEarnedIndicator: { marginLeft: 4 },
};
