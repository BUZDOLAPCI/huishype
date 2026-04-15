import { useState, useCallback } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

import { formatPropertyPrice } from '@huishype/shared';
import type { SectionProps } from './types';
import { PriceGuessSlider } from '../PriceGuessSlider';
import { FMVVisualization, type FMVData } from '../FMVVisualization';
import { ConsensusAlignment } from '../ConsensusAlignment';
import {
  useFetchPriceGuess,
  useSubmitGuess,
  formatCooldownRemaining,
  type FmvResponse,
} from '../../hooks/usePriceGuess';
import { useAuth } from '../../hooks/useAuth';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';
import { SectionCard } from './SectionCard';

interface PriceGuessSectionProps extends SectionProps {
  onViewAllGuesses?: () => void;
  onLoginRequired?: (copy?: AuthModalCopyInput) => void;
}

// Format price using country config (defaults to NL)
function formatPrice(price: number): string {
  return formatPropertyPrice(price);
}

// Skeleton loading component
function LoadingSkeleton() {
  return (
    <SectionCard
      title="Guess the Price"
      icon="pricetag"
      description="Submit your own estimate and compare it with the community."
    >
      <View className="flex-row items-center mb-3">
        <View className="w-5 h-5 bg-warm-200 rounded animate-pulse" />
        <View className="h-5 w-32 bg-warm-200 rounded ml-2 animate-pulse" />
      </View>
      <View className="h-4 w-full bg-warm-200 rounded mb-4 animate-pulse" />
      <View className="bg-warm-50 rounded-xl p-4 mb-3">
        <View className="h-8 w-40 bg-warm-200 rounded mb-4 mx-auto animate-pulse" />
        <View className="h-3 bg-warm-200 rounded-full mb-4 animate-pulse" />
        <View className="flex-row justify-center gap-2 mb-4">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="h-8 w-12 bg-warm-200 rounded animate-pulse" />
          ))}
        </View>
        <View className="h-12 bg-warm-200 rounded-xl animate-pulse" />
      </View>
    </SectionCard>
  );
}

// Cooldown message component
function CooldownMessage({ cooldownEndsAt }: { cooldownEndsAt: string }) {
  const remaining = formatCooldownRemaining(cooldownEndsAt);

  return (
    <View className="flex-row items-center bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
      <Ionicons name="time-outline" size={20} color="#D97706" />
      <View className="ml-3 flex-1">
        <Text className="text-sm font-medium text-amber-800">
          Cooldown Active
        </Text>
        <Text className="text-xs text-amber-600">
          You can update your guess in {remaining}
        </Text>
      </View>
    </View>
  );
}

const LOGIN_REQUIRED_COPY = 'Sign in to submit your guess' satisfies AuthModalCopyInput;

// Success message after submission
function SuccessMessage({ price }: { price: number }) {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      className="flex-row items-center bg-green-50 border border-green-200 rounded-xl p-3 mb-4"
    >
      <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
      <View className="ml-3 flex-1">
        <Text className="text-sm font-medium text-green-800">
          Guess Submitted!
        </Text>
        <Text className="text-xs text-green-600">
          Your guess of {formatPrice(price)} has been recorded.
        </Text>
      </View>
    </Animated.View>
  );
}

export function PriceGuessSection({
  property,
  onViewAllGuesses,
  onLoginRequired,
}: PriceGuessSectionProps) {
  const { user, isAuthenticated } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [submittedPrice, setSubmittedPrice] = useState<number | null>(null);

  // Fetch existing guess data
  const {
    data: guessData,
    isLoading,
    refetch,
  } = useFetchPriceGuess(property.id, user?.id);

  // Submit mutation
  const submitGuess = useSubmitGuess();

  // Handle guess submission
  const handleGuessSubmit = useCallback(
    async (price: number) => {
      if (!isAuthenticated) {
        onLoginRequired?.(LOGIN_REQUIRED_COPY);
        return;
      }

      try {
        await submitGuess.mutateAsync({
          propertyId: property.id,
          guessedPrice: price,
        });

        setSubmittedPrice(price);
        setShowSuccess(true);

        // Hide success message after 3 seconds
        setTimeout(() => {
          setShowSuccess(false);
        }, 3000);

        // Refetch data to get updated stats
        refetch();
      } catch (error) {
        console.error('Failed to submit guess:', error);
        // Error handling is done by the mutation
      }
    },
    [isAuthenticated, property.id, submitGuess, refetch, onLoginRequired]
  );

  // Build FMV data from API response — pass through real distribution
  const fmvData: FMVData | null =
    guessData?.fmv && guessData.fmv.fmv !== null && guessData.fmv.guessCount > 0
      ? {
          value: guessData.fmv.fmv,
          confidence: guessData.fmv.confidence,
          guessCount: guessData.fmv.guessCount,
          distribution: guessData.fmv.distribution,
          officialValuation: guessData.fmv.officialValuation,
          askingPrice: guessData.fmv.askingPrice,
          divergence: guessData.fmv.divergence,
        }
      : null;

  // Determine if user can submit
  const hasExistingGuess = !!guessData?.userGuess;
  const isInCooldown = !guessData?.canEdit && hasExistingGuess;

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  return (
    <SectionCard
      title="Guess the Price"
      icon="pricetag"
      description="What do you think this property is worth? Submit your own estimate and compare it with the crowd."
      trailing={
        hasExistingGuess ? (
          <View className="bg-green-100 px-2 py-0.5 rounded-full">
            <Text className="text-xs font-medium text-green-700">
              Guessed
            </Text>
          </View>
        ) : null
      }
    >
      <View testID="price-guess-section">

        {/* Success message */}
        {showSuccess && submittedPrice && <SuccessMessage price={submittedPrice} />}

        {/* Cooldown message */}
        {isInCooldown && guessData?.cooldownEndsAt && (
          <CooldownMessage cooldownEndsAt={guessData.cooldownEndsAt} />
        )}

        {/* FMV Visualization (if we have data) */}
        {fmvData && (
          <View className="mb-4">
            <FMVVisualization
              fmv={fmvData}
              userGuess={guessData?.userGuess?.guessedPrice}
              askingPrice={property.askingPrice}
              officialValuation={property.officialValuation ?? undefined}
              testID="fmv-visualization"
            />
          </View>
        )}

        {/* Consensus Alignment (after submission or when user has existing guess) */}
        {fmvData && (showSuccess && submittedPrice || hasExistingGuess && guessData?.userGuess) && (
          <View className="mb-4">
            <ConsensusAlignment
              userGuess={submittedPrice ?? guessData!.userGuess!.guessedPrice}
              crowdEstimate={fmvData.value!}
              guessCount={fmvData.guessCount}
              guesses={guessData?.guesses}
              isVisible
              testID="consensus-alignment"
            />
          </View>
        )}

        {/* Price Guess Slider */}
        <PriceGuessSlider
          propertyId={property.id}
          officialValuation={property.officialValuation ?? undefined}
          askingPrice={property.askingPrice}
          currentFMV={fmvData?.value ?? undefined}
          userGuess={guessData?.userGuess?.guessedPrice}
          onGuessSubmit={handleGuessSubmit}
          disabled={isInCooldown}
          isSubmitting={submitGuess.isPending}
          testID="price-guess-slider"
        />

        {/* Existing guess display */}
        {hasExistingGuess && guessData?.userGuess && (
          <View className="mt-3 flex-row items-center justify-center">
            <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
            <Text className="text-sm text-warm-500 ml-1">
              Your current guess:{' '}
              <Text className="font-semibold text-warm-700">
                {formatPrice(guessData.userGuess.guessedPrice)}
              </Text>
            </Text>
          </View>
        )}

        {/* Guess count */}
        {property.guessCount > 0 && (
          <View style={styles.guessSummaryRow}>
            <Text className="text-xs text-warm-400">
              {property.guessCount} {property.guessCount === 1 ? 'person has' : 'people have'} guessed
            </Text>
            {onViewAllGuesses ? (
              <Pressable
                accessibilityRole="button"
                onPress={onViewAllGuesses}
                style={styles.viewGuessesButton}
                testID="view-all-guesses-button"
              >
                <Text style={styles.viewGuessesText}>View guesses</Text>
                <Ionicons name="arrow-forward" size={14} color="#DE911D" />
              </Pressable>
            ) : null}
          </View>
        )}

        {/* Error display */}
        {submitGuess.isError && (
          <View className="mt-3 flex-row items-center bg-red-50 border border-red-200 rounded-lg p-2">
            <Ionicons name="alert-circle" size={16} color="#EF4444" />
            <Text className="text-xs text-red-600 ml-2 flex-1">
              {submitGuess.error instanceof Error
                ? submitGuess.error.message
                : 'Failed to submit guess. Please try again.'}
            </Text>
          </View>
        )}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  guessSummaryRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  viewGuessesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewGuessesText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DE911D',
  },
});
