/**
 * MetricPills — Stat pills row for property surfaces.
 *
 * Design spec: Section 7.7 (Info pills), Section 7.5 (Feed card stats).
 *
 * Supports two variants:
 *   info  — Year built, floor area, views (warm-200 bg, warm pill)
 *   stats — Likes, comments, guesses, views (color-coded tinted pills)
 *
 * Multi-country: price-per-m² uses country-aware formatting.
 */

import React, { memo } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Icon, type IconName } from './ui/Icon';
import { formatPropertyPrice, type CountryCode } from '@huishype/shared';

export type MetricPillsVariant = 'info' | 'stats';

// ─── Info pills ──────────────────────────────────────────────────────────

export interface InfoPillData {
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  viewCount?: number;
  pricePerM2?: number | null;
  countryCode?: CountryCode | string;
}

// ─── Stat pills ──────────────────────────────────────────────────────────

export interface StatPillData {
  likeCount?: number;
  commentCount?: number;
  guessCount?: number;
  viewCount?: number;
}

export interface MetricPillsProps {
  /** Info pills data (year built, area, views). */
  info?: InfoPillData;
  /** Stat pills data (likes, comments, guesses, views). */
  stats?: StatPillData;
  /** Display variant. Auto-detected from provided data if omitted. */
  variant?: MetricPillsVariant;
  /** Force the full likes/comments/guesses/views row to render with zero defaults. */
  showAllStats?: boolean;
  testID?: string;
}

// ─── Pill config ─────────────────────────────────────────────────────────

interface PillConfig {
  icon: IconName;
  label: string;
  bg: string;
  iconColor: string;
  textColor: string;
}

const STAT_PILL_CONFIGS: Record<string, PillConfig> = {
  likes: {
    icon: 'Heart',
    label: '',
    bg: 'rgba(233, 30, 99, 0.08)',
    iconColor: '#E91E63',
    textColor: '#E91E63',
  },
  comments: {
    icon: 'ChatCircle',
    label: '',
    bg: 'rgba(66, 165, 245, 0.08)',
    iconColor: '#42A5F5',
    textColor: '#42A5F5',
  },
  guesses: {
    icon: 'Tag',
    label: '',
    bg: 'rgba(76, 175, 80, 0.08)',
    iconColor: '#4CAF50',
    textColor: '#4CAF50',
  },
  views: {
    icon: 'Eye',
    label: '',
    bg: 'rgba(245, 166, 35, 0.08)',
    iconColor: '#F5A623',
    textColor: '#F5A623',
  },
};

// ─── Formatting ──────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

// ─── Sub-components ──────────────────────────────────────────────────────

function InfoPill({
  icon,
  value,
}: {
  icon: IconName;
  value: string;
}) {
  return (
    <View style={styles.infoPill}>
      <Icon name={icon} size={13} color="#9C958A" />
      <Text style={styles.infoPillText}>{value}</Text>
    </View>
  );
}

function StatPill({
  config,
  value,
  testID,
}: {
  config: PillConfig;
  value: number;
  testID?: string;
}) {
  return (
    <View
      style={[styles.statPill, { backgroundColor: config.bg }]}
      testID={testID}
    >
      <Icon name={config.icon} size={14} color={config.iconColor} />
      <Text style={[styles.statPillText, { color: config.textColor }]}>
        {formatCount(value)}
      </Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────

function MetricPillsComponent({
  info,
  stats,
  variant,
  showAllStats = false,
  testID,
}: MetricPillsProps) {
  const resolvedVariant = variant ?? (stats ? 'stats' : 'info');

  if (resolvedVariant === 'info' && info) {
    const pills: Array<{ icon: IconName; value: string }> = [];

    if (info.yearBuilt) {
      pills.push({ icon: 'Calendar', value: String(info.yearBuilt) });
    }
    if (info.floorAreaM2) {
      pills.push({ icon: 'Ruler', value: `${info.floorAreaM2} m\u00B2` });
    }
    if (info.pricePerM2) {
      const formatted = formatPropertyPrice(
        info.pricePerM2,
        (info.countryCode as CountryCode) ?? 'NL'
      );
      pills.push({ icon: 'CurrencyEur', value: `${formatted}/m\u00B2` });
    }
    if (info.viewCount && info.viewCount > 0) {
      pills.push({ icon: 'Eye', value: formatCount(info.viewCount) });
    }

    if (pills.length === 0) return null;

    return (
      <View style={styles.row} testID={testID ?? 'metric-pills-info'}>
        {pills.map((pill) => (
          <InfoPill key={pill.icon + pill.value} icon={pill.icon} value={pill.value} />
        ))}
      </View>
    );
  }

  if (resolvedVariant === 'stats' && stats) {
    const entries: Array<{ key: string; config: PillConfig; value: number }> = [
      { key: 'likes', config: STAT_PILL_CONFIGS.likes, value: stats.likeCount ?? 0 },
      { key: 'comments', config: STAT_PILL_CONFIGS.comments, value: stats.commentCount ?? 0 },
      { key: 'guesses', config: STAT_PILL_CONFIGS.guesses, value: stats.guessCount ?? 0 },
      { key: 'views', config: STAT_PILL_CONFIGS.views, value: stats.viewCount ?? 0 },
    ].filter((entry) => showAllStats || entry.value > 0);

    if (entries.length === 0) return null;

    return (
      <View style={styles.row} testID={testID ?? 'metric-pills-stats'}>
        {entries.map((entry) => (
          <StatPill
            key={entry.key}
            config={entry.config}
            value={entry.value}
            testID={`${testID ?? 'metric-pills-stats'}-${entry.key}`}
          />
        ))}
      </View>
    );
  }

  return null;
}

function areMetricPillsPropsEqual(
  prev: Readonly<MetricPillsProps>,
  next: Readonly<MetricPillsProps>,
) {
  return (
    prev.variant === next.variant &&
    prev.showAllStats === next.showAllStats &&
    prev.testID === next.testID &&
    prev.info?.yearBuilt === next.info?.yearBuilt &&
    prev.info?.floorAreaM2 === next.info?.floorAreaM2 &&
    prev.info?.viewCount === next.info?.viewCount &&
    prev.info?.pricePerM2 === next.info?.pricePerM2 &&
    prev.info?.countryCode === next.info?.countryCode &&
    prev.stats?.likeCount === next.stats?.likeCount &&
    prev.stats?.commentCount === next.stats?.commentCount &&
    prev.stats?.guessCount === next.stats?.guessCount &&
    prev.stats?.viewCount === next.stats?.viewCount
  );
}

export const MetricPills = memo(MetricPillsComponent, areMetricPillsPropsEqual);

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Info variant
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F0E8',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  infoPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#504A42',
  },

  // Stats variant
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 4,
    flex: 1,
    justifyContent: 'center',
  },
  statPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
