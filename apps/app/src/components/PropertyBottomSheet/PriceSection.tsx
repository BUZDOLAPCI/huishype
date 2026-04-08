import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';

import type { SectionProps } from './types';
import { SectionCard } from './SectionCard';

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

interface PriceTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone?: 'default' | 'warm' | 'accent';
  hint?: string;
}

function PriceTile({
  icon,
  label,
  value,
  tone = 'default',
  hint,
}: PriceTileProps) {
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
        <Ionicons name={icon} size={14} color={palette.icon} />
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
      icon="stats-chart"
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
              icon="home-outline"
              label={getValuationLabel(countryCode)}
              value={formatPrice(officialValuation, countryCode)}
            />
          </View>
        ) : null}

        {askingPrice ? (
          <View style={styles.halfTile}>
            <PriceTile
              icon="pricetag-outline"
              label="Asking Price"
              value={formatPrice(askingPrice, countryCode)}
              tone="warm"
            />
          </View>
        ) : null}

        {fmv ? (
          <PriceTile
            icon="people-outline"
            label="Crowd FMV"
            value={formatPrice(fmv, countryCode)}
            tone="accent"
            hint={`${guessCount} ${guessCount === 1 ? 'guess' : 'guesses'} contributing`}
          />
        ) : (
          <PriceTile
            icon="git-compare-outline"
            label="Crowd FMV"
            value={guessCount > 0 ? `${guessCount} ${guessCount === 1 ? 'guess' : 'guesses'} so far` : 'Not enough signal yet'}
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
    lineHeight: 17,
  },
  comparisonWrap: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F5EBDD',
  },
  comparisonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8C8479',
    marginBottom: 10,
  },
  comparisonTrack: {
    position: 'relative',
    height: 8,
    borderRadius: 999,
    backgroundColor: '#FBF4E7',
  },
  comparisonDot: {
    position: 'absolute',
    top: -3,
    width: 14,
    height: 14,
    borderRadius: 999,
    marginLeft: -7,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  comparisonBounds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  comparisonBoundText: {
    fontSize: 12,
    color: '#AEA699',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 12,
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
