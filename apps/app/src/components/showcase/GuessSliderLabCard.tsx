import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PriceGuessSlider } from '@/src/components/PriceGuessSlider';
import { SectionCard } from '@/src/components/PropertyBottomSheet/SectionCard';
import { Icon } from '@/src/components/ui/Icon';
import { formatPropertyPrice } from '@huishype/shared';

const MOCK_PROPERTY = {
  id: 'showcase-guess-slider-lab',
  countryCode: 'NL',
  officialValuation: 385000,
  officialValuationYear: 2024,
  currentFMV: 565800,
  askingPrice: 780000,
};

export function GuessSliderLabCard() {
  const [submittedPrice, setSubmittedPrice] = useState<number | null>(null);

  const handleGuessSubmit = useCallback((price: number) => {
    setSubmittedPrice(price);
  }, []);

  return (
    <SectionCard style={styles.card} shadow="card-alt">
      <View testID="guess-slider-lab-card">
        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <Icon name="Tag" weight="fill" size={18} color="#F5A623" />
            <Text style={styles.title}>Guess the Price</Text>
          </View>
          {submittedPrice ? (
            <View style={styles.submittedPill} testID="guess-slider-lab-submitted-pill">
              <Icon name="Check" size={12} color="#3D8A5A" />
              <Text style={styles.submittedText}>
                {formatPropertyPrice(submittedPrice, 'NL', { compact: true })}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.prompt}>
          What do you think this property is worth?
        </Text>

        <View style={styles.sliderWrap}>
          <PriceGuessSlider
            propertyId={MOCK_PROPERTY.id}
            countryCode={MOCK_PROPERTY.countryCode}
            officialValuation={MOCK_PROPERTY.officialValuation}
            officialValuationYear={MOCK_PROPERTY.officialValuationYear}
            askingPrice={MOCK_PROPERTY.askingPrice}
            initialPrice={MOCK_PROPERTY.askingPrice}
            initialPriceSource="active_listing_asking_price"
            initialPriceConfidence="known"
            currentFMV={MOCK_PROPERTY.currentFMV}
            onGuessSubmit={handleGuessSubmit}
            variant="embedded"
            testID="guess-slider-lab-slider"
          />
        </View>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 430,
    padding: 18,
    borderWidth: 1,
    borderColor: '#F1ECE4',
    backgroundColor: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 8,
  },
  title: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 18,
    lineHeight: 22,
    color: '#1A1918',
  },
  submittedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#C8F0D8',
  },
  submittedText: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 11,
    color: '#3D8A5A',
  },
  prompt: {
    marginTop: 16,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    color: '#6D6C6A',
  },
  sliderWrap: {
    marginTop: 20,
  },
});
