import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AuthModal } from '@/src/components';
import { FMVVisualization, type FMVData } from '@/src/components/FMVVisualization';
import { Icon } from '@/src/components/ui/Icon';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { KarmaBadge } from '@/src/components/Comments/KarmaBadge';
import { PriceGuessSlider } from '@/src/components/PriceGuessSlider';
import { PropertyImageSurface } from '@/src/components/PropertyImageSurface';
import { ResponsivePanel } from '@/src/components/ui/ResponsivePanel';
import { useProperty } from '@/src/hooks/useProperties';
import { useFetchPriceGuess, useSubmitGuess, type PriceGuess } from '@/src/hooks/usePriceGuess';
import { useAuth } from '@/src/hooks/useAuth';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { formatRelativeTime } from '@/src/components/Comments/Comment';
import { resolvePropertyImageWithType } from '@/src/utils/property-image';
import { formatPropertyPrice, type CountryCode } from '@huishype/shared';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  mergeStyles,
} from '../dom';
import { colors } from '../theme';

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

function buildDistributionBins(
  guesses: PriceGuess[],
  binCount = 5,
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
    const count = prices.filter((value) => value >= binMin && value < binMax).length;
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
  if (price >= 1_000_000) return `${(price / 1_000_000).toFixed(1)}M`;
  if (price >= 1_000) return `${Math.round(price / 1_000)}k`;
  return String(Math.round(price));
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
      <UserAvatar username={guess.user?.username || 'user'} displayName={displayName} size="md" />
      <View style={styles.guessEntryContent}>
        <View style={styles.guessEntryNameRow}>
          <Text style={styles.guessEntryName} numberOfLines={1}>{displayName}</Text>
          {guess.user?.karma !== undefined ? <KarmaBadge karma={guess.user.karma} size="sm" /> : null}
        </View>
        <Text style={styles.guessEntryTime}>
          {hydratedNow === null ? '\u00A0' : formatRelativeTime(guess.createdAt, hydratedNow)}
        </Text>
      </View>
      <View style={styles.guessEntryPriceCol}>
        <Text style={styles.guessEntryPrice}>{formatPrice(guess.guessedPrice, countryCode)}</Text>
        {isAccurate !== null ? (
          <Icon
            name={isAccurate ? 'CheckCircle' : 'WarningCircle'}
            size={18}
            color={isAccurate ? colors.success : colors.goldDeep}
          />
        ) : null}
      </View>
    </View>
  );
}

export function GuessesRoute() {
  const navigate = useNavigate();
  const { propertyId = 'property' } = useParams();
  const { user, isAuthenticated } = useAuth();
  const { data: property, isLoading: propertyLoading } = useProperty(propertyId ?? null);
  const { data: guessData, isLoading: guessLoading, refetch } = useFetchPriceGuess(propertyId ?? null, user?.id);
  const submitGuess = useSubmitGuess();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSlider, setShowSlider] = useState(false);

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
      officialValuation: guessData.fmv.officialValuation ?? undefined,
      askingPrice: guessData.fmv.askingPrice ?? undefined,
      divergence: guessData.fmv.divergence ?? undefined,
    };
  }, [guessData?.fmv]);

  const bins = useMemo(() => buildDistributionBins(guessData?.guesses ?? []), [guessData?.guesses]);
  const recentGuesses = useMemo(() => (guessData?.guesses ?? []).slice(0, 6), [guessData?.guesses]);

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

      await submitGuess.mutateAsync({ propertyId, guessedPrice: price });
      setShowSlider(false);
      await refetch();
    },
    [isAuthenticated, propertyId, refetch, submitGuess],
  );

  const topInset = 16;

  if (isLoading) {
    return (
      <ResponsivePanel title="Guesses" onClose={() => navigate(-1)}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.goldDeep} />
          <Text style={styles.body}>Loading guesses...</Text>
        </View>
      </ResponsivePanel>
    );
  }

  return (
    <ResponsivePanel title="Guesses" onClose={() => navigate(-1)}>
      <View style={styles.root}>
        <View style={mergeStyles(styles.backRow, { top: topInset })}>
          <Pressable onPress={() => navigate(-1)} style={styles.floatingButton}>
            <Icon name="ArrowLeft" size={20} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            {propertyImage.url ? (
              <PropertyImageSurface
                source={{
                  listingPhotoUrl: (property as any)?.listingPhotoUrl ?? null,
                  aerialImageUrl: (property as any)?.aerialImageUrl ?? null,
                  countryCode: property?.countryCode,
                }}
                style={styles.heroImage as any}
                markerSize={28}
                imageTestID="guesses-property-image"
                markerTestID="guesses-property-marker"
              />
            ) : (
              <View style={styles.heroPlaceholder}>
                <Icon name="HouseLine" size={48} color={colors.textSoft} />
              </View>
            )}
            <View style={styles.heroOverlay} />
            <View style={styles.heroText}>
              <Text style={styles.heroAddress} numberOfLines={1}>{property?.address ?? 'Property'}</Text>
              <Text style={styles.heroCity} numberOfLines={1}>
                {property?.postalCode ? `${property.postalCode} ` : ''}
                {property?.city ?? ''}
              </Text>
            </View>
          </View>

          <FMVVisualization
            fmv={fmvData}
            userGuess={guessData?.userGuess?.guessedPrice}
            askingPrice={guessData?.fmv.askingPrice ?? undefined}
            officialValuation={guessData?.fmv.officialValuation ?? undefined}
            countryCode={property?.countryCode}
            isLoading={false}
          />

          {bins.length > 0 ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Guess Distribution</Text>
              <View style={styles.distributionList}>
                {bins.map((bin) => (
                  <View key={bin.label} style={styles.distributionRow}>
                    <Text style={styles.distributionLabel}>{bin.label}</Text>
                    <View style={styles.distributionTrack}>
                      <View style={mergeStyles(styles.distributionFill, { width: `${Math.max(bin.fraction * 100, 2)}%` })} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.sectionCard}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Recent Guesses</Text>
              <Pressable onPress={() => setShowSlider(true)} style={styles.ctaButton}>
                <Text style={styles.ctaText}>{showSlider ? 'Close' : 'Make Your Guess'}</Text>
              </Pressable>
            </View>

            {showSlider ? (
              <View style={styles.sliderWrap}>
                <PriceGuessSlider
                  propertyId={propertyId}
                  countryCode={property?.countryCode}
                  officialValuation={guessData?.fmv.officialValuation ?? undefined}
                  askingPrice={guessData?.fmv.askingPrice ?? undefined}
                  currentFMV={guessData?.fmv.fmv ?? undefined}
                  userGuess={guessData?.userGuess?.guessedPrice}
                  onGuessSubmit={handleGuessSubmit}
                  disabled={submitGuess.isPending}
                  isSubmitting={submitGuess.isPending}
                />
              </View>
            ) : null}

            <View style={styles.guessList}>
              {recentGuesses.length > 0 ? (
                recentGuesses.map((guess) => (
                  <GuessEntry
                    key={guess.id}
                    guess={guess}
                    fmvValue={guessData?.fmv.fmv ?? null}
                    countryCode={property?.countryCode}
                  />
                ))
              ) : (
                <Text style={styles.body}>No guesses yet. Be the first to guess.</Text>
              )}
            </View>
          </View>
        </ScrollView>

        <AuthModal
          visible={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          message="Sign in to guess"
        />
      </View>
    </ResponsivePanel>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    color: colors.textMuted,
    marginTop: 16,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 16,
    gap: 16,
  },
  heroCard: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    minHeight: 220,
  },
  heroImage: {
    width: '100%',
    height: 220,
  },
  heroPlaceholder: {
    width: '100%',
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  heroText: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
  },
  heroAddress: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  heroCity: {
    color: 'rgba(255,255,255,0.86)',
    marginTop: 4,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 18,
    gap: 14,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  ctaButton: {
    backgroundColor: colors.gold,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ctaText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  sliderWrap: {
    marginTop: 4,
  },
  distributionList: {
    gap: 10,
  },
  distributionRow: {
    gap: 6,
  },
  distributionLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  distributionTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  distributionFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.gold,
  },
  guessList: {
    gap: 12,
  },
  guessEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    color: colors.text,
    flex: 1,
  },
  guessEntryTime: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  guessEntryPriceCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  guessEntryPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  backRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  floatingButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
