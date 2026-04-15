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
});
