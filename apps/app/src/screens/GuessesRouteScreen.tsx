import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthModal } from '@/src/components';
import { FMVVisualization, type FMVData } from '@/src/components/FMVVisualization';
import { PriceGuessSlider } from '@/src/components/PriceGuessSlider';
import { PropertyImageSurface } from '@/src/components/PropertyImageSurface';
import { RouteLoadingShell } from '@/src/components/RouteLoadingShell';
import { Icon } from '@/src/components/ui/Icon';
import { formatRelativeTime } from '@/src/components/Comments/Comment';
import { KarmaBadge } from '@/src/components/Comments/KarmaBadge';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { useProperty } from '@/src/hooks/useProperties';
import { useAuth } from '@/src/hooks/useAuth';
import {
  useFetchPriceGuess,
  useSubmitGuess,
  type PriceGuess,
} from '@/src/hooks/usePriceGuess';
import { resolvePropertyImageWithType } from '@/src/utils/property-image';
import { formatPropertyPrice, type CountryCode } from '@huishype/shared';

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

function buildDistributionBins(
  guesses: PriceGuess[],
  binCount: number = 5,
): Array<{ label: string; count: number; fraction: number }> {
  if (guesses.length === 0) return [];

  const prices = guesses.map((guess) => guess.guessedPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  if (min === max) {
    return [{ label: formatPrice(min), count: guesses.length, fraction: 1 }];
  }

  const binSize = (max - min) / binCount;
  const bins: Array<{ label: string; count: number; fraction: number }> = [];

  for (let index = 0; index < binCount; index += 1) {
    const binMin = min + index * binSize;
    const binMax = index === binCount - 1 ? max + 1 : min + (index + 1) * binSize;
    const count = prices.filter((price) => price >= binMin && price < binMax).length;
    const label =
      index === 0
        ? `<${formatCompactPrice(binMax)}`
        : index === binCount - 1
          ? `>${formatCompactPrice(binMin)}`
          : `${formatCompactPrice(binMin)}-${formatCompactPrice(binMax)}`;

    bins.push({ label, count, fraction: 0 });
  }

  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  return bins.map((bin) => ({ ...bin, fraction: bin.count / maxCount }));
}

function formatCompactPrice(price: number): string {
  if (price >= 1000000) return `${(price / 1000000).toFixed(1)}M`;
  if (price >= 1000) return `${Math.round(price / 1000)}k`;
  return String(Math.round(price));
}

function PropertyImageCard({
  property,
  imageUrl,
}: {
  property: {
    address: string;
    city: string;
    postalCode: string | null;
    listingPhotoUrl?: string | null;
    aerialImageUrl?: string | null;
    countryCode?: string | null;
  };
  imageUrl: string | null;
}) {
  return (
    <View style={styles.imageCard}>
      {imageUrl ? (
        <PropertyImageSurface
          source={{
            listingPhotoUrl: property.listingPhotoUrl ?? null,
            aerialImageUrl: property.aerialImageUrl ?? null,
            countryCode: property.countryCode ?? undefined,
          }}
          style={styles.imageCardImage}
          markerSize={28}
          imageTestID="guesses-property-image"
          markerTestID="guesses-property-marker"
        />
      ) : (
        <View style={[styles.imageCardImage, styles.imagePlaceholder]}>
          <Icon name="HouseLine" size={48} color="#C7BFB3" />
        </View>
      )}
      <View style={styles.imageGradient} />
      <View style={styles.imageTextOverlay}>
        <Text style={styles.imageAddress} numberOfLines={1}>
          {property.address}
        </Text>
        <Text style={styles.imageCity} numberOfLines={1}>
          {property.postalCode ? `${property.postalCode} ` : ''}
          {property.city}
        </Text>
      </View>
    </View>
  );
}

function DistributionChart({
  bins,
}: {
  bins: Array<{ label: string; count: number; fraction: number }>;
}) {
  if (bins.length === 0) return null;

  return (
    <View style={styles.distCard}>
      <Text style={styles.distTitle}>Guess Distribution</Text>
      <View style={styles.distBars}>
        {bins.map((bin, index) => (
          <View key={index} style={styles.distRow}>
            <Text style={styles.distLabel} numberOfLines={1}>
              {bin.label}
            </Text>
            <View style={styles.distBarTrack}>
              <View
                style={[
                  styles.distBarFill,
                  { width: `${Math.max(bin.fraction * 100, 2)}%` },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function GuessEntry({
  guess,
  fmvValue,
  countryCode,
}: {
  guess: PriceGuess;
  fmvValue: number | null;
  countryCode?: string;
}) {
  const hydratedNow = useHydratedNow();
  const displayName = guess.user?.displayName || guess.user?.username || 'Anonymous';

  const isAccurate =
    fmvValue !== null
      ? Math.abs(guess.guessedPrice - fmvValue) / fmvValue <= 0.1
      : null;

  return (
    <View style={styles.guessEntry}>
      <View style={styles.guessEntryContent}>
        <View style={styles.guessEntryNameRow}>
          <Text style={styles.guessEntryName} numberOfLines={1}>
            {displayName}
          </Text>
          {guess.user?.karma !== undefined ? (
            <KarmaBadge karma={guess.user.karma} size="sm" />
          ) : null}
        </View>
        <Text style={styles.guessEntryTime}>
          {hydratedNow === null ? '\u00A0' : formatRelativeTime(guess.createdAt, hydratedNow)}
        </Text>
      </View>
      <View style={styles.guessEntryPriceCol}>
        <Text style={styles.guessEntryPrice}>
          {formatPrice(guess.guessedPrice, countryCode)}
        </Text>
        {isAccurate !== null ? (
          <Icon
            name={isAccurate ? 'CheckCircle' : 'WarningCircle'}
            size={18}
            color={isAccurate ? '#4CAF50' : '#FF9500'}
          />
        ) : null}
      </View>
    </View>
  );
}

export interface GuessesRouteScreenProps {
  propertyId?: string | null;
}

export function GuessesRouteScreen({ propertyId }: GuessesRouteScreenProps) {
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSlider, setShowSlider] = useState(false);

  const { data: property, isLoading: propertyLoading } = useProperty(propertyId ?? null);
  const { data: guessData, isLoading: guessLoading, refetch } = useFetchPriceGuess(
    propertyId ?? null,
    user?.id,
  );

  const submitGuess = useSubmitGuess();
  const isLoading = propertyLoading || guessLoading;

  const fmvData: FMVData | null = useMemo(() => {
    if (!guessData?.fmv || guessData.fmv.fmv === null || guessData.fmv.guessCount === 0) {
      return null;
    }

    return {
      value: guessData.fmv.fmv,
      confidence: guessData.fmv.confidence,
      guessCount: guessData.fmv.guessCount,
      distribution: guessData.fmv.distribution,
      officialValuation: guessData.fmv.officialValuation,
      askingPrice: guessData.fmv.askingPrice,
      divergence: guessData.fmv.divergence,
    };
  }, [guessData?.fmv]);

  const distributionBins = useMemo(
    () => buildDistributionBins(guessData?.guesses ?? []),
    [guessData?.guesses],
  );

  const recentGuesses = useMemo(() => {
    if (!guessData?.guesses) return [];
    return [...guessData.guesses]
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )
      .slice(0, 20);
  }, [guessData?.guesses]);

  const propertyImage = property
    ? resolvePropertyImageWithType({
        listingPhotoUrl: (property as any).listingPhotoUrl ?? null,
        aerialImageUrl: (property as any).aerialImageUrl ?? null,
        countryCode: property.countryCode,
      })
    : { url: null, type: 'placeholder' as const };

  const handleGuessSubmit = useCallback(
    async (price: number) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      if (!propertyId) {
        return;
      }

      try {
        await submitGuess.mutateAsync({ propertyId, guessedPrice: price });
        setShowSlider(false);
        refetch();
      } catch {
        // Mutation state handles error UI.
      }
    },
    [isAuthenticated, propertyId, refetch, submitGuess],
  );

  if (isLoading) {
    return (
      <RouteLoadingShell
        title="Loading guesses"
        subtitle="Preparing the guess surface..."
      />
    );
  }

  if (!property) {
    return null;
  }

  const divergence = guessData?.fmv?.divergence ?? null;
  const sliderDisabled = !guessData?.canEdit;

  return (
    <>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 + (showSlider ? 180 : 0) },
          ]}
        >
          <View style={styles.content}>
            <PropertyImageCard property={property} imageUrl={propertyImage.url} />

            {fmvData ? (
              <FMVVisualization
                fmv={fmvData}
                askingPrice={property.askingPrice ?? undefined}
                officialValuation={property.officialValuation ?? undefined}
                countryCode={property.countryCode ?? undefined}
              />
            ) : null}

            {distributionBins.length > 0 ? (
              <DistributionChart bins={distributionBins} />
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent guesses</Text>
              <Pressable
                onPress={() => setShowSlider(true)}
                testID="make-guess-button"
                accessibilityRole="button"
              >
                <Text style={styles.makeGuessText}>Make your guess</Text>
              </Pressable>
            </View>

            {recentGuesses.map((guess) => (
              <GuessEntry
                key={guess.id}
                guess={guess}
                fmvValue={fmvData?.value ?? null}
                countryCode={property.countryCode ?? undefined}
              />
            ))}

            {divergence !== null ? (
              <Text style={styles.divergenceText}>
                Crowd estimate is {Math.abs(divergence)}%{' '}
                {divergence >= 0 ? 'above' : 'below'} asking price.
              </Text>
            ) : null}
          </View>
        </ScrollView>

        {showSlider ? (
          <View style={[styles.sliderContainer, { bottom: insets.bottom + 16 }]}>
            <PriceGuessSlider
              propertyId={propertyId ?? ''}
              countryCode={property?.countryCode ?? undefined}
              officialValuation={property?.officialValuation ?? undefined}
              askingPrice={property?.askingPrice ?? undefined}
              currentFMV={guessData?.fmv?.fmv ?? undefined}
              userGuess={guessData?.userGuess?.guessedPrice}
              onGuessSubmit={handleGuessSubmit}
              disabled={sliderDisabled}
              isSubmitting={submitGuess.isPending}
              testID="guesses-slider"
            />
            <Pressable
              onPress={() => setShowSlider(false)}
              style={styles.sliderDismiss}
              accessibilityRole="button"
            >
              <Text style={styles.sliderDismissText}>Close slider</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <AuthModal visible={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </>
  );
}

export default GuessesRouteScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: 20,
    gap: 18,
  },
  imageCard: {
    height: 220,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#EDE6DB',
  },
  imageCardImage: {
    flex: 1,
  },
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  imageTextOverlay: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
  },
  imageAddress: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  imageCity: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.92)',
    marginTop: 2,
  },
  distCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#FFF8EE',
    borderWidth: 1,
    borderColor: '#F0E3D2',
  },
  distTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D2926',
    marginBottom: 12,
  },
  distBars: {
    gap: 10,
  },
  distRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  distLabel: {
    width: 92,
    fontSize: 12,
    color: '#6E675F',
  },
  distBarTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#F0E5D7',
    overflow: 'hidden',
  },
  distBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#F5A623',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D2926',
  },
  makeGuessText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C77700',
  },
  guessEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E7DDCF',
    gap: 12,
  },
  guessEntryContent: {
    flex: 1,
  },
  guessEntryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  guessEntryName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D2926',
  },
  guessEntryTime: {
    marginTop: 2,
    fontSize: 12,
    color: '#8C8479',
  },
  guessEntryPriceCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  guessEntryPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D2926',
  },
  divergenceText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#8C8479',
  },
  sliderContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 16,
    borderRadius: 20,
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#EEDFCB',
    gap: 12,
  },
  sliderDismiss: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sliderDismissText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8C8479',
  },
});
