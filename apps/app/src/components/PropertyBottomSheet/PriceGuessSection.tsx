import { useState, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

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

interface PriceGuessSectionProps extends SectionProps {
  onGuessPress?: () => void;
  onLoginRequired?: () => void;
}

// Format price in Dutch locale
function formatPrice(price: number): string {
  return `\u20AC${price.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`;
}

// Skeleton loading component
function LoadingSkeleton() {
  return (
    <View className="px-4 py-4 border-t border-gray-100">
      <View className="flex-row items-center mb-3">
        <View className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
        <View className="h-5 w-32 bg-gray-200 rounded ml-2 animate-pulse" />
      </View>
      <View className="h-4 w-full bg-gray-200 rounded mb-4 animate-pulse" />
      <View className="bg-gray-50 rounded-xl p-4 mb-3">
        <View className="h-8 w-40 bg-gray-200 rounded mb-4 mx-auto animate-pulse" />
        <View className="h-3 bg-gray-200 rounded-full mb-4 animate-pulse" />
        <View className="flex-row justify-center gap-2 mb-4">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="h-8 w-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </View>
        <View className="h-12 bg-gray-200 rounded-xl animate-pulse" />
      </View>
    </View>
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

// Login prompt component
function LoginPrompt({ onLogin }: { onLogin: () => void }) {
  return (
    <View className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4">
      <View className="flex-row items-center mb-2">
        <Ionicons name="person-outline" size={20} color="#6B7280" />
        <Text className="text-sm font-medium text-gray-700 ml-2">
          Sign in to submit your guess
        </Text>
      </View>
      <Text className="text-xs text-gray-500 mb-3">
        Your guess will be saved and you can track your prediction accuracy.
      </Text>
      <Pressable
        onPress={onLogin}
        className="bg-primary-600 py-2.5 rounded-lg items-center active:bg-primary-700"
      >
        <Text className="text-white font-medium text-sm">Sign In</Text>
      </Pressable>
    </View>
  );
}

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
  onGuessPress,
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
        onLoginRequired?.();
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
          wozValue: guessData.fmv.wozValue,
          askingPrice: guessData.fmv.askingPrice,
          divergence: guessData.fmv.divergence,
        }
      : null;

  // Determine if user can submit
  const hasExistingGuess = !!guessData?.userGuess;
  const isInCooldown = !guessData?.canEdit && hasExistingGuess;
  const canSubmit = !isInCooldown && !submitGuess.isPending;

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  return (
    <View className="px-4 py-4 border-t border-gray-100" testID="price-guess-section">
      {/* Header */}
      <View className="flex-row items-center mb-3">
        <Ionicons name="pricetag" size={20} color="#3B82F6" />
        <Text className="text-lg font-semibold text-gray-900 ml-2">
          Guess the Price
        </Text>
        {hasExistingGuess && (
          <View className="ml-auto bg-green-100 px-2 py-0.5 rounded-full">
            <Text className="text-xs font-medium text-green-700">
              Guessed
            </Text>
          </View>
        )}
      </View>

      {/* Description */}
      <Text className="text-sm text-gray-500 mb-4">
        What do you think this property is worth? Submit your guess and see how
        it compares to others.
      </Text>

      {/* Success message */}
      {showSuccess && submittedPrice && <SuccessMessage price={submittedPrice} />}

      {/* Cooldown message */}
      {isInCooldown && guessData?.cooldownEndsAt && (
        <CooldownMessage cooldownEndsAt={guessData.cooldownEndsAt} />
      )}

      {/* Login prompt for unauthenticated users */}
      {!isAuthenticated && <LoginPrompt onLogin={() => onLoginRequired?.()} />}

      {/* FMV Visualization (if we have data) */}
      {fmvData && (
        <View className="mb-4">
          <FMVVisualization
            fmv={fmvData}
            userGuess={guessData?.userGuess?.guessedPrice}
            askingPrice={property.askingPrice}
            wozValue={property.wozValue ?? undefined}
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
        wozValue={property.wozValue ?? undefined}
        askingPrice={property.askingPrice}
        currentFMV={fmvData?.value ?? undefined}
        userGuess={guessData?.userGuess?.guessedPrice}
        onGuessSubmit={handleGuessSubmit}
        disabled={isInCooldown || !isAuthenticated}
        isSubmitting={submitGuess.isPending}
        testID="price-guess-slider"
      />

      {/* Existing guess display */}
      {hasExistingGuess && guessData?.userGuess && (
        <View className="mt-3 flex-row items-center justify-center">
          <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
          <Text className="text-sm text-gray-500 ml-1">
            Your current guess:{' '}
            <Text className="font-semibold text-gray-700">
              {formatPrice(guessData.userGuess.guessedPrice)}
            </Text>
          </Text>
        </View>
      )}

      {/* Guess count */}
      {property.guessCount > 0 && (
        <Text className="text-xs text-gray-400 text-center mt-2">
          {property.guessCount} {property.guessCount === 1 ? 'person has' : 'people have'} guessed
        </Text>
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
  );
}
