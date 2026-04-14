import { StyleSheet, Text, View } from '../../runtime/dom';
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';

import { Icon } from '../ui/Icon';
import type { SectionProps } from './types';
import { SectionCard } from './SectionCard';

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

interface PriceTileProps {
  icon: 'HouseLine' | 'Tag' | 'Users' | 'ChartLineUp';
  label: string;
  value: string;
  tone?: 'default' | 'warm' | 'accent';
  hint?: string;
}

function PriceTile({ icon, label, value, tone = 'default', hint }: PriceTileProps) {
  const tones = {
    default: {
      bg: '#FFF9F1',
      border: '#F2E4D1',
      icon: '#BFA585',
      label: '#8C8479',
      value: '#2D2926',
      hint: '#8C8479',
    },
    warm: {
      bg: '#FFF5EC',
      border: '#F6D7BD',
      icon: '#F97316',
      label: '#C26A1B',
      value: '#E66F1C',
      hint: '#C26A1B',
    },
    accent: {
      bg: '#FFF6DE',
      border: '#F5D48A',
      icon: '#D99200',
      label: '#BE8500',
      value: '#D99200',
      hint: '#BE8500',
    },
  } as const;

  const palette = tones[tone];

  return (
    <View style={[styles.tile, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <View style={styles.tileLabelRow}>
        <Icon name={icon} size="xs" color={palette.icon} />
        <Text style={[styles.tileLabel, { color: palette.label }]}>{label}</Text>
      </View>
      <Text style={[styles.tileValue, { color: palette.value }]}>{value}</Text>
      {hint ? <Text style={[styles.tileHint, { color: palette.hint }]}>{hint}</Text> : null}
    </View>
  );
}

function PriceComparisonBar({
  officialValuation,
  askingPrice,
  fmv,
  countryCode,
}: {
  officialValuation: number | null;
  askingPrice?: number;
  fmv?: number;
  countryCode?: string;
}) {
  if (!officialValuation) {
    return null;
  }

  const shortValuationLabel = countryCode === 'NL' ? 'WOZ' : 'Valuation';
  const prices = [
    { label: shortValuationLabel, value: officialValuation, color: '#C7BFB3' },
    askingPrice ? { label: 'Asking', value: askingPrice, color: '#F97316' } : null,
    fmv ? { label: 'FMV', value: fmv, color: '#D99200' } : null,
  ].filter(Boolean) as Array<{ label: string; value: number; color: string }>;

  if (prices.length < 2) {
    return null;
  }

  const minPrice = Math.min(...prices.map((price) => price.value));
  const maxPrice = Math.max(...prices.map((price) => price.value));
  const range = maxPrice - minPrice || 1;

  return (
    <View style={styles.comparisonWrap}>
      <Text style={styles.comparisonLabel}>Price comparison</Text>
      <View style={styles.comparisonTrack}>
        {prices.map((price) => {
          const position = ((price.value - minPrice) / range) * 100;
          return (
            <View
              key={price.label}
              style={[
                styles.comparisonDot,
                { backgroundColor: price.color, left: `${Math.max(2, Math.min(96, position))}%` },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.comparisonBounds}>
        <Text style={styles.comparisonBoundText}>{formatPrice(minPrice, countryCode)}</Text>
        <Text style={styles.comparisonBoundText}>{formatPrice(maxPrice, countryCode)}</Text>
      </View>
      <View style={styles.legendRow}>
        {prices.map((price) => (
          <View key={price.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: price.color }]} />
            <Text style={styles.legendLabel}>{price.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function PriceSection({ property }: SectionProps) {
  const { officialValuation, askingPrice, fmv: fmvData, guessCount, countryCode } = property;
  const fmv = fmvData?.fmv ?? undefined;
  const confidence = fmvData?.confidence;

  const confidenceLabel =
    confidence === 'high'
      ? 'High confidence'
      : confidence === 'medium'
        ? 'Medium confidence'
        : confidence === 'low'
          ? 'Low confidence'
          : null;

  const confidenceColor =
    confidence === 'high'
      ? '#3E8B51'
      : confidence === 'medium'
        ? '#C18A10'
        : '#C26A1B';

  return (
    <SectionCard
      title="Price Snapshot"
      icon="ChartLineUp"
      description="Ground the listing with the official valuation, live asking price, and the crowd signal."
      trailing={
        confidenceLabel ? (
          <View style={[styles.confidenceBadge, { backgroundColor: `${confidenceColor}14` }]}>
            <Text style={[styles.confidenceText, { color: confidenceColor }]}>
              {confidenceLabel}
            </Text>
          </View>
        ) : null
      }
    >
      <View style={styles.grid}>
        {officialValuation ? (
          <View style={styles.halfTile}>
            <PriceTile
              icon="HouseLine"
              label={getValuationLabel(countryCode)}
              value={formatPrice(officialValuation, countryCode)}
            />
          </View>
        ) : null}

        {askingPrice ? (
          <View style={styles.halfTile}>
            <PriceTile
              icon="Tag"
              label="Asking Price"
              value={formatPrice(askingPrice, countryCode)}
              tone="warm"
            />
          </View>
        ) : null}

        {fmv ? (
          <PriceTile
            icon="Users"
            label="Crowd FMV"
            value={formatPrice(fmv, countryCode)}
            tone="accent"
            hint={`${guessCount} ${guessCount === 1 ? 'guess' : 'guesses'} contributing`}
          />
        ) : (
          <PriceTile
            icon="ChartLineUp"
            label="Crowd FMV"
            value={
              guessCount > 0
                ? `${guessCount} ${guessCount === 1 ? 'guess' : 'guesses'} so far`
                : 'Not enough signal yet'
            }
            hint="More guesses will tighten the community estimate."
          />
        )}
      </View>

      <PriceComparisonBar
        officialValuation={officialValuation}
        askingPrice={askingPrice}
        fmv={fmv}
        countryCode={countryCode}
      />
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  confidenceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  halfTile: {
    width: '48.5%',
  },
  tile: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 108,
  },
  tileLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  tileLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  tileValue: {
    fontSize: 29,
    lineHeight: 32,
    fontWeight: '700',
  },
  tileHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 16,
  },
  comparisonWrap: {
    marginTop: 14,
  },
  comparisonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8C8479',
    marginBottom: 8,
  },
  comparisonTrack: {
    position: 'relative',
    height: 10,
    borderRadius: 999,
    backgroundColor: '#F2E4D1',
  },
  comparisonDot: {
    position: 'absolute',
    top: -3,
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    transform: 'translateX(-50%)',
  },
  comparisonBounds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  comparisonBoundText: {
    fontSize: 12,
    color: '#8C8479',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  legendLabel: {
    fontSize: 12,
    color: '#736C62',
  },
});
