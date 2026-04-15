import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';

import { shadows } from '../../lib/shadows';
import type { SectionProps } from './types';
import { SectionCard } from './SectionCard';

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

interface ConfidenceBadgeInfo {
  bg: string;
  text: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

interface MiniPriceCardProps {
  testID: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  valueColor?: string;
}

function getConfidenceBadgeInfo(
  confidence: 'none' | 'low' | 'medium' | 'high' | undefined,
  guessCount: number
): ConfidenceBadgeInfo | null {
  if (!confidence || confidence === 'none' || guessCount <= 0) {
    return null;
  }

  const guessLabel = `${guessCount} ${guessCount === 1 ? 'guess' : 'guesses'}`;

  switch (confidence) {
    case 'high':
      return {
        bg: '#C8F0D8',
        text: '#3D8A5A',
        label: `High confidence (${guessLabel})`,
        icon: 'checkmark-circle',
      };
    case 'medium':
      return {
        bg: '#FFF3D6',
        text: '#C48B1B',
        label: `Medium confidence (${guessLabel})`,
        icon: 'remove-circle',
      };
    case 'low':
      return {
        bg: '#FFE7D6',
        text: '#D86D2C',
        label: `Low confidence (${guessLabel})`,
        icon: 'alert-circle',
      };
  }
}

function MiniPriceCard({
  testID,
  icon,
  iconBg,
  iconColor,
  label,
  value,
  valueColor = '#1A1918',
}: MiniPriceCardProps) {
  return (
    <View testID={testID} style={[styles.miniCard, shadows['card-alt']]}>
      <View style={styles.miniHeaderRow}>
        <View style={[styles.miniIconBg, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={13} color={iconColor} />
        </View>
        <Text style={styles.miniLabel}>{label}</Text>
      </View>
      <Text style={[styles.miniValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

export function PriceSection({ property }: SectionProps) {
  const { officialValuation, askingPrice, fmv: fmvData, guessCount, countryCode } = property;
  const fmv = fmvData?.fmv ?? undefined;
  const crowdGuessCount = fmvData?.guessCount ?? guessCount;
  const confidenceBadge = getConfidenceBadgeInfo(fmvData?.confidence, crowdGuessCount);
  const hasSecondaryRow = officialValuation || askingPrice;

  return (
    <SectionCard
      title="Price Snapshot"
      icon="stats-chart"
      description="Ground the listing with the official valuation, live asking price, and the crowd signal."
    >
      <View style={styles.grid}>
        <View testID="price-snapshot-crowd-card" style={[styles.crowdCard, shadows['card-alt']]}>
          <View style={styles.crowdHeaderRow}>
            <View style={styles.crowdIconBg}>
              <Ionicons name="people-outline" size={16} color="#3D8A5A" />
            </View>
            <Text style={styles.crowdLabel}>Crowd Estimate</Text>
          </View>

          {fmv ? (
            <Text style={styles.crowdValue}>{formatPrice(fmv, countryCode)}</Text>
          ) : (
            <>
              <Text style={styles.crowdEmptyValue}>Not enough signal yet</Text>
              <Text style={styles.crowdHint}>
                {crowdGuessCount > 0
                  ? `${crowdGuessCount} ${crowdGuessCount === 1 ? 'guess' : 'guesses'} so far`
                  : 'More guesses will tighten the estimate.'}
              </Text>
            </>
          )}

          {confidenceBadge ? (
            <View
              testID="price-snapshot-confidence-badge"
              style={[styles.confidenceBadge, { backgroundColor: confidenceBadge.bg }]}
            >
              <Ionicons name={confidenceBadge.icon} size={14} color={confidenceBadge.text} />
              <Text style={[styles.confidenceText, { color: confidenceBadge.text }]}>
                {confidenceBadge.label}
              </Text>
            </View>
          ) : null}
        </View>

        {hasSecondaryRow ? (
          <View style={styles.secondaryRow}>
            {officialValuation ? (
              <View style={styles.secondaryCardSlot}>
                <MiniPriceCard
                  testID="price-snapshot-valuation-card"
                  icon="home-outline"
                  iconBg="#E3F2FD"
                  iconColor="#42A5F5"
                  label={getValuationLabel(countryCode)}
                  value={formatPrice(officialValuation, countryCode)}
                />
              </View>
            ) : null}

            {askingPrice ? (
              <View style={styles.secondaryCardSlot}>
                <MiniPriceCard
                  testID="price-snapshot-asking-card"
                  icon="pricetag-outline"
                  iconBg="#FFF3E0"
                  iconColor="#F5A623"
                  label="Asking Price"
                  value={formatPrice(askingPrice, countryCode)}
                  valueColor="#F5A623"
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: 12,
  },
  crowdCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F1ECE4',
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 8,
  },
  crowdHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  crowdIconBg: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C8F0D8',
  },
  crowdLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    fontFamily: 'Outfit_500Medium',
    color: '#6D6C6A',
  },
  crowdValue: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
    color: '#3D8A5A',
    letterSpacing: -1,
  },
  crowdEmptyValue: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
    color: '#2D2926',
    letterSpacing: -0.6,
  },
  crowdHint: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    fontFamily: 'Outfit_500Medium',
    color: '#8C8479',
  },
  confidenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
    gap: 6,
  },
  confidenceText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    fontFamily: 'Outfit_500Medium',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryCardSlot: {
    flex: 1,
  },
  miniCard: {
    minHeight: 88,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F1ECE4',
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 8,
  },
  miniHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniIconBg: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontFamily: 'Outfit_600SemiBold',
    color: '#9C9B99',
  },
  miniValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
    letterSpacing: -0.3,
  },
});
