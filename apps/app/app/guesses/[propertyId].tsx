/**
 * Price Guesses Page — Full-screen view showing all guesses for a property.
 *
 * Design spec: Section 7.9 (Price Guesses Page), Section 8.10 (Full Screen).
 *
 * Shows property image card, crowd estimate, guess distribution histogram,
 * recent guesses list, and a sticky "Make Your Guess" CTA at the bottom.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useIsLandscape } from '@/src/hooks/useIsLandscape';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/src/components/ui/Icon';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { ResponsivePanel } from '@/src/components/ui/ResponsivePanel';
import { FMVVisualization, type FMVData } from '@/src/components/FMVVisualization';
import { PriceGuessSlider } from '@/src/components/PriceGuessSlider';
import { useProperty } from '@/src/hooks/useProperties';
import {
  useFetchPriceGuess,
  useSubmitGuess,
  type PriceGuess,
} from '@/src/hooks/usePriceGuess';
import { useAuth } from '@/src/hooks/useAuth';
import { AuthModal } from '@/src/components';
import { PropertyImageSurface } from '@/src/components/PropertyImageSurface';
import { resolvePropertyImageWithType } from '@/src/utils/property-image';
import { formatPropertyPrice, type CountryCode } from '@huishype/shared';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { formatRelativeTime } from '@/src/components/Comments/Comment';
import { KarmaBadge } from '@/src/components/Comments/KarmaBadge';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

/** Build histogram bins from guesses */
function buildDistributionBins(
  guesses: PriceGuess[],
  binCount: number = 5
): Array<{ label: string; count: number; fraction: number }> {
  if (guesses.length === 0) return [];

  const prices = guesses.map((g) => g.guessedPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  if (min === max) {
    return [{ label: formatPrice(min), count: guesses.length, fraction: 1 }];
  }

  const binSize = (max - min) / binCount;
  const bins: Array<{ label: string; count: number; fraction: number }> = [];

  for (let i = 0; i < binCount; i++) {
    const binMin = min + i * binSize;
    const binMax = i === binCount - 1 ? max + 1 : min + (i + 1) * binSize;

    const count = prices.filter((p) => p >= binMin && p < binMax).length;
    const label =
      i === 0
        ? `<${formatCompactPrice(binMax)}`
        : i === binCount - 1
        ? `>${formatCompactPrice(binMin)}`
        : `${formatCompactPrice(binMin)}-${formatCompactPrice(binMax)}`;

    bins.push({ label, count, fraction: 0 });
  }

  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  return bins.map((b) => ({ ...b, fraction: b.count / maxCount }));
}

function formatCompactPrice(price: number): string {
  if (price >= 1000000) return `${(price / 1000000).toFixed(1)}M`;
  if (price >= 1000) return `${Math.round(price / 1000)}k`;
  return String(Math.round(price));
}

// ─── Sub-components ───────────────────────────────────────────────────────

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
      {/* Dark overlay for text readability */}
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
        {bins.map((bin, i) => (
          <View key={i} style={styles.distRow}>
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
  const initials = displayName
    .split(' ')
    .map((s) => s[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Accuracy check: within 10% of FMV
  const isAccurate =
    fmvValue !== null
      ? Math.abs(guess.guessedPrice - fmvValue) / fmvValue <= 0.1
      : null;

  return (
    <View style={styles.guessEntry}>
      <UserAvatar
        username={guess.user?.username || 'user'}
        displayName={displayName}
        size="md"
      />
      <View style={styles.guessEntryContent}>
        <View style={styles.guessEntryNameRow}>
          <Text style={styles.guessEntryName} numberOfLines={1}>
            {displayName}
          </Text>
          {guess.user?.karma !== undefined && (
            <KarmaBadge karma={guess.user.karma} size="sm" />
          )}
        </View>
        <Text style={styles.guessEntryTime}>
          {hydratedNow === null ? '\u00A0' : formatRelativeTime(guess.createdAt, hydratedNow)}
        </Text>
      </View>
      <View style={styles.guessEntryPriceCol}>
        <Text style={styles.guessEntryPrice}>
          {formatPrice(guess.guessedPrice, countryCode)}
        </Text>
        {isAccurate !== null && (
          <Icon
            name={isAccurate ? 'CheckCircle' : 'WarningCircle'}
            size={18}
            color={isAccurate ? '#4CAF50' : '#FF9500'}
          />
        )}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────

export default function GuessesPage() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated } = useAuth();
  const isLandscape = useIsLandscape();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSlider, setShowSlider] = useState(false);

  // Data fetching
  const { data: property, isLoading: propertyLoading } = useProperty(propertyId ?? null);
  const {
    data: guessData,
    isLoading: guessLoading,
    refetch,
  } = useFetchPriceGuess(propertyId ?? null, user?.id);

  const submitGuess = useSubmitGuess();

  const isLoading = propertyLoading || guessLoading;

  // Build FMV data
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

  // Build distribution bins
  const distributionBins = useMemo(
    () => buildDistributionBins(guessData?.guesses ?? []),
    [guessData?.guesses]
  );

  // Sort guesses by most recent
  const recentGuesses = useMemo(() => {
    if (!guessData?.guesses) return [];
    return [...guessData.guesses]
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 20);
  }, [guessData?.guesses]);

  // Property image
  const propertyImage = property
    ? resolvePropertyImageWithType({
        listingPhotoUrl: (property as any).listingPhotoUrl ?? null,
        aerialImageUrl: (property as any).aerialImageUrl ?? null,
        countryCode: property.countryCode,
      })
    : { url: null, type: 'placeholder' as const };

  // Guess submission
  const handleGuessSubmit = useCallback(
    async (price: number) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      if (!propertyId) return;

      try {
        await submitGuess.mutateAsync({
          propertyId,
          guessedPrice: price,
        });
        setShowSlider(false);
        refetch();
      } catch {
        // Error is handled by the mutation state
      }
    },
    [isAuthenticated, propertyId, submitGuess, refetch]
  );

  const handleMakeGuess = useCallback(() => {
    setShowSlider(true);
  }, []);

  // Divergence from asking price
  const divergence = guessData?.fmv?.divergence ?? null;

  const topInset = Platform.OS === 'web' ? 16 : insets.top;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <ResponsivePanel title="Price Guesses">
        <View style={styles.container}>
          {/* Header — hidden in landscape since ResponsivePanel already shows the title */}
          {!isLandscape && (
            <View style={[styles.header, { paddingTop: topInset + 8 }]}>
              <Pressable
                onPress={() => router.back()}
                style={styles.headerBackButton}
                testID="guesses-back-button"
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Icon name="ArrowLeft" size={20} color="#504A42" />
              </Pressable>
              <Text style={styles.headerTitle}>Price Guesses</Text>
            </View>
          )}

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#F5A623" />
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingBottom: insets.bottom + 80,
              paddingHorizontal: 16,
              gap: 16,
              paddingTop: 16,
            }}
          >
            {/* Property image card */}
            {property && (
                <PropertyImageCard
                  property={property}
                  imageUrl={propertyImage.url}
                />
            )}

            {/* Crowd estimate card */}
            {fmvData && (
              <View style={styles.crowdEstimateCard}>
                <View style={styles.crowdEstimateHeader}>
                  <View>
                    <Text style={styles.crowdEstimateLabel}>Crowd Estimate</Text>
                    <Text style={styles.crowdEstimateSubLabel}>Average Guess</Text>
                    <Text style={styles.crowdEstimatePrice}>
                      {formatPrice(fmvData.value!, property?.countryCode)}
                    </Text>
                  </View>
                  {divergence !== null && (
                    <View style={styles.divergenceBadge}>
                      <Icon
                        name={divergence >= 0 ? 'TrendUp' : 'TrendDown'}
                        size={14}
                        color="#B47712"
                      />
                      <Text style={styles.divergenceText}>
                        {divergence >= 0 ? '+' : ''}{divergence}%
                      </Text>
                    </View>
                  )}
                </View>

                {fmvData.askingPrice && (
                  <View style={styles.listingPriceRow}>
                    <Text style={styles.listingPriceLabel}>Listing Price</Text>
                    <Text style={styles.listingPriceValue}>
                      {formatPrice(fmvData.askingPrice, property?.countryCode)}
                    </Text>
                  </View>
                )}

                <View style={styles.guessCountRow}>
                  <Icon name="Users" size={14} color="#9C958A" />
                  <Text style={styles.guessCountText}>
                    {fmvData.guessCount} {fmvData.guessCount === 1 ? 'guess' : 'guesses'}
                  </Text>
                </View>
              </View>
            )}

            {/* Distribution chart */}
            {distributionBins.length > 0 && (
              <DistributionChart bins={distributionBins} />
            )}

            {/* Price Guess Slider (when user taps "Make Your Guess") */}
            {showSlider && propertyId && (
              <PriceGuessSlider
                propertyId={propertyId}
                countryCode={property?.countryCode}
                officialValuation={property?.officialValuation ?? undefined}
                askingPrice={guessData?.fmv?.askingPrice ?? undefined}
                currentFMV={fmvData?.value ?? undefined}
                userGuess={guessData?.userGuess?.guessedPrice}
                onGuessSubmit={handleGuessSubmit}
                disabled={!guessData?.canEdit && !!guessData?.userGuess}
                isSubmitting={submitGuess.isPending}
              />
            )}

            {/* Recent guesses list */}
            {recentGuesses.length > 0 && (
              <View>
                <Text style={styles.recentGuessesTitle}>Recent Guesses</Text>
                {recentGuesses.map((guess) => (
                  <GuessEntry
                    key={guess.id}
                    guess={guess}
                    fmvValue={fmvData?.value ?? null}
                    countryCode={property?.countryCode}
                  />
                ))}
              </View>
            )}

            {/* Empty state */}
            {recentGuesses.length === 0 && !fmvData && (
              <View style={styles.emptyState}>
                <Icon name="Tag" size={48} color="#C7BFB3" />
                <Text style={styles.emptyTitle}>No guesses yet</Text>
                <Text style={styles.emptySubtitle}>
                  Be the first to guess the price of this property!
                </Text>
              </View>
            )}
          </ScrollView>
        )}

        {/* Sticky CTA bar */}
        {!showSlider && (
          <View
            style={[
              styles.ctaBar,
              { paddingBottom: Math.max(insets.bottom, 20) },
            ]}
          >
            <Pressable
              onPress={handleMakeGuess}
              style={styles.ctaButton}
              testID="make-guess-button"
            >
              <Icon name="Crosshair" size={18} color="#FFFFFF" />
              <Text style={styles.ctaButtonText}>Make Your Guess</Text>
            </Pressable>
          </View>
          )}
        </View>
      </ResponsivePanel>

      <AuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
    backgroundColor: '#FFFBF5',
  },
  headerBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D2926',
    letterSpacing: -0.2,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },

  // Property image card
  imageCard: {
    height: 150,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  imageCardImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    backgroundColor: '#F5F0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  imageTextOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
  },
  imageAddress: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  imageCity: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },

  // Crowd estimate card
  crowdEstimateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#1A1918',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
    gap: 12,
  },
  crowdEstimateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  crowdEstimateLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D2926',
  },
  crowdEstimateSubLabel: {
    fontSize: 12,
    color: '#9C958A',
    marginTop: 2,
  },
  crowdEstimatePrice: {
    fontSize: 32,
    fontWeight: '700',
    color: '#3D8A5A',
    letterSpacing: -1,
    marginTop: 4,
  },
  divergenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3C4',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  divergenceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B47712',
  },
  listingPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F5F0E8',
  },
  listingPriceLabel: {
    fontSize: 13,
    color: '#9C958A',
  },
  listingPriceValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#504A42',
  },
  guessCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  guessCountText: {
    fontSize: 13,
    color: '#9C958A',
  },

  // Distribution chart
  distCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#1A1918',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  distTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D2926',
    marginBottom: 14,
  },
  distBars: {
    gap: 10,
  },
  distRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  distLabel: {
    width: 70,
    fontSize: 12,
    color: '#736C62',
    textAlign: 'right',
  },
  distBarTrack: {
    flex: 1,
    height: 20,
    backgroundColor: '#FFF8F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  distBarFill: {
    height: '100%',
    backgroundColor: '#F5A623',
    borderRadius: 4,
  },

  // Recent guesses
  recentGuessesTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D2926',
    marginBottom: 12,
  },
  guessEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#1A1918',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
    gap: 10,
  },
  guessEntryContent: {
    flex: 1,
  },
  guessEntryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  guessEntryName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D2926',
  },
  guessEntryTime: {
    fontSize: 12,
    color: '#9C958A',
    marginTop: 2,
  },
  guessEntryPriceCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  guessEntryPrice: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D2926',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#504A42',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9C958A',
    textAlign: 'center',
  },

  // CTA bar
  ctaBar: {
    backgroundColor: '#FFFBF5',
    paddingTop: 12,
    paddingHorizontal: 20,
    shadowColor: '#1A1918',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  ctaButton: {
    backgroundColor: '#F5A623',
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
