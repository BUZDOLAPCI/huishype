/**
 * MetricPills — Stat pills row for property surfaces.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { Icon, type IconName } from './ui/Icon';
import { formatPropertyPrice, type CountryCode } from '@huishype/shared';

export type MetricPillsVariant = 'info' | 'stats';

export interface InfoPillData {
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  viewCount?: number;
  pricePerM2?: number | null;
  countryCode?: CountryCode | string;
}

export interface StatPillData {
  likeCount?: number;
  commentCount?: number;
  guessCount?: number;
  viewCount?: number;
}

export interface MetricPillsProps {
  info?: InfoPillData;
  stats?: StatPillData;
  variant?: MetricPillsVariant;
  showAllStats?: boolean;
  testID?: string;
}

interface PillConfig {
  icon: IconName;
  bg: string;
  iconColor: string;
  textColor: string;
}

const STAT_PILL_CONFIGS: Record<'likes' | 'comments' | 'guesses' | 'views', PillConfig> = {
  likes: { icon: 'Heart', bg: 'rgba(233, 30, 99, 0.08)', iconColor: '#E91E63', textColor: '#E91E63' },
  comments: { icon: 'ChatCircle', bg: 'rgba(66, 165, 245, 0.08)', iconColor: '#42A5F5', textColor: '#42A5F5' },
  guesses: { icon: 'Tag', bg: 'rgba(76, 175, 80, 0.08)', iconColor: '#4CAF50', textColor: '#4CAF50' },
  views: { icon: 'Eye', bg: 'rgba(245, 166, 35, 0.08)', iconColor: '#F5A623', textColor: '#F5A623' },
};

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

function InfoPill({ icon, value }: { icon: IconName; value: string }) {
  return (
    <div style={styles.infoPill}>
      <Icon name={icon} size={13} color="#9C958A" />
      <span style={styles.infoPillText}>{value}</span>
    </div>
  );
}

function StatPill({ config, value, testID }: { config: PillConfig; value: number; testID?: string }) {
  return (
    <div style={{ ...styles.statPill, backgroundColor: config.bg }} data-testid={testID}>
      <Icon name={config.icon} size={14} color={config.iconColor} />
      <span style={{ ...styles.statPillText, color: config.textColor }}>{formatCount(value)}</span>
    </div>
  );
}

export function MetricPills({
  info,
  stats,
  variant,
  showAllStats = false,
  testID,
}: MetricPillsProps) {
  const resolvedVariant = variant ?? (stats ? 'stats' : 'info');

  if (resolvedVariant === 'info' && info) {
    const pills: Array<{ icon: IconName; value: string }> = [];
    if (info.yearBuilt) pills.push({ icon: 'Calendar', value: String(info.yearBuilt) });
    if (info.floorAreaM2) pills.push({ icon: 'Ruler', value: `${info.floorAreaM2} m²` });
    if (info.pricePerM2) {
      const formatted = formatPropertyPrice(info.pricePerM2, (info.countryCode as CountryCode) ?? 'NL');
      pills.push({ icon: 'CurrencyEur', value: `${formatted}/m²` });
    }
    if (info.viewCount && info.viewCount > 0) pills.push({ icon: 'Eye', value: formatCount(info.viewCount) });
    if (pills.length === 0) return null;

    return (
      <div style={styles.row} data-testid={testID ?? 'metric-pills-info'}>
        {pills.map((pill) => (
          <InfoPill key={pill.icon + pill.value} icon={pill.icon} value={pill.value} />
        ))}
      </div>
    );
  }

  if (resolvedVariant === 'stats' && stats) {
    const entries = [
      { key: 'likes', config: STAT_PILL_CONFIGS.likes, value: stats.likeCount ?? 0 },
      { key: 'comments', config: STAT_PILL_CONFIGS.comments, value: stats.commentCount ?? 0 },
      { key: 'guesses', config: STAT_PILL_CONFIGS.guesses, value: stats.guessCount ?? 0 },
      { key: 'views', config: STAT_PILL_CONFIGS.views, value: stats.viewCount ?? 0 },
    ].filter((entry) => showAllStats || entry.value > 0);

    if (entries.length === 0) return null;

    return (
      <div style={styles.row} data-testid={testID ?? 'metric-pills-stats'}>
        {entries.map((entry) => (
          <StatPill
            key={entry.key}
            config={entry.config}
            value={entry.value}
            testID={`${testID ?? 'metric-pills-stats'}-${entry.key}`}
          />
        ))}
      </div>
    );
  }

  return null;
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  infoPill: {
    display: 'inline-flex',
    alignItems: 'center',
    backgroundColor: '#F5F0E8',
    borderRadius: 100,
    padding: '4px 10px',
    gap: 4,
  },
  infoPillText: {
    fontSize: 12,
    fontWeight: 500,
    color: '#504A42',
  },
  statPill: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    padding: '3px 7px',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  statPillText: {
    fontSize: 13,
    fontWeight: 600,
  },
};
