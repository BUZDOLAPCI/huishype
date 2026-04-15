import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { formatPropertyPrice } from '@huishype/shared';
import type { SectionProps } from './types';
import { PriceGuessSlider } from '../PriceGuessSlider';
import { FMVVisualization, type FMVData } from '../FMVVisualization';
import { ConsensusAlignment } from '../ConsensusAlignment';
import { Icon } from '../ui/Icon';
import {
  useFetchPriceGuess,
  useSubmitGuess,
} from '../../hooks/usePriceGuess';
import { useAuth } from '../../hooks/useAuth';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';
import { SectionCard } from './SectionCard';

interface PriceGuessSectionProps extends SectionProps {
  onGuessPress?: () => void;
  onLoginRequired?: (copy?: AuthModalCopyInput) => void;
}

function formatPrice(price: number): string {
  return formatPropertyPrice(price);
}

function LoadingSkeleton() {
  return (
    <SectionCard style={styles.sectionCard} shadow="card-alt">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View className="h-[18px] w-[18px] rounded bg-warm-200 animate-pulse" />
          <View className="ml-2 h-5 w-36 rounded bg-warm-200 animate-pulse" />
        </View>
        <View className="h-6 w-20 rounded-full bg-green-100 animate-pulse" />
      </View>
      <View className="mt-4 h-4 w-56 rounded bg-warm-200 animate-pulse" />
      <View className="mt-5 h-3 w-24 rounded bg-warm-200 animate-pulse" />
      <View className="mt-3 h-10 w-40 rounded bg-warm-200 animate-pulse" />
      <View className="mt-4 h-px w-full bg-warm-200" />
      <View className="mt-5 h-28 w-full rounded bg-warm-100 animate-pulse" />
      <View className="mt-4 h-12 w-full rounded-xl bg-warm-200 animate-pulse" />
    </SectionCard>
  );
}

const LOGIN_REQUIRED_COPY = 'Sign in to submit your guess' satisfies AuthModalCopyInput;

function SuccessMessage({ price }: { price: number }) {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      className="mt-4 flex-row items-center rounded-xl border border-green-200 bg-green-50 p-3"
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

  const {
    data: guessData,
    isLoading,
    refetch,
  } = useFetchPriceGuess(property.id, user?.id);

  const submitGuess = useSubmitGuess();

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

        setTimeout(() => {
          setShowSuccess(false);
        }, 3000);

        refetch();
      } catch (error) {
        console.error('Failed to submit guess:', error);
      }
    },
    [isAuthenticated, onLoginRequired, property.id, refetch, submitGuess]
  );

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

  const hasExistingGuess = !!guessData?.userGuess;
  const activeUserGuess = submittedPrice ?? guessData?.userGuess?.guessedPrice ?? null;

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  return (
    <SectionCard style={styles.sectionCard} shadow="card-alt">
      <View testID="price-guess-section">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Icon name="Tag" weight="fill" size={18} color="#F5A623" />
            <Text className="ml-2 font-display-semibold text-[18px] leading-[22px] text-[#1A1918]">
              Guess the Price
            </Text>
          </View>
          {hasExistingGuess ? (
            <View className="flex-row items-center rounded-full bg-[#C8F0D8] px-2.5 py-1">
              <Icon name="Check" size={12} color="#3D8A5A" />
              <Text className="ml-1 font-display-semibold text-[11px] text-[#3D8A5A]">
                Guessed
              </Text>
            </View>
          ) : null}
        </View>

        <Text className="mt-4 text-[14px] font-medium leading-[20px] text-[#6D6C6A]">
          What do you think this property is worth?
        </Text>

        {showSuccess && submittedPrice ? (
          <SuccessMessage price={submittedPrice} />
        ) : null}

        {fmvData ? (
          <View className="mt-5">
            <FMVVisualization
              fmv={fmvData}
              userGuess={guessData?.userGuess?.guessedPrice}
              askingPrice={property.askingPrice}
              officialValuation={property.officialValuation ?? undefined}
              variant="embedded"
              testID="fmv-visualization"
            />
          </View>
        ) : null}

        <View className="mt-5">
          <PriceGuessSlider
            propertyId={property.id}
            officialValuation={property.officialValuation ?? undefined}
            askingPrice={property.askingPrice}
            currentFMV={fmvData?.value ?? undefined}
            userGuess={guessData?.userGuess?.guessedPrice}
            onGuessSubmit={handleGuessSubmit}
            disabled={false}
            isSubmitting={submitGuess.isPending}
            variant="embedded"
            testID="price-guess-slider"
          />
        </View>

        {fmvData && activeUserGuess ? (
          <View className="mt-5">
            <View className="flex-row items-center justify-between">
              <Text className="font-display-semibold text-[11px] uppercase tracking-[0.8px] text-[#9C9B99]">
                Your Guess
              </Text>
              <Text className="font-display-semibold text-[22px] leading-[28px] tracking-[-0.3px] text-[#1A1918]">
                {formatPrice(activeUserGuess)}
              </Text>
            </View>
            <View className="mt-4 h-px bg-[#E5E4E1]" />
            <View className="mt-4">
              <ConsensusAlignment
                userGuess={activeUserGuess}
                crowdEstimate={fmvData.value!}
                guessCount={fmvData.guessCount}
                guesses={guessData?.guesses}
                divergence={fmvData.divergence}
                onViewGuesses={onGuessPress}
                isVisible
                variant="embedded"
                testID="consensus-alignment"
              />
            </View>
          </View>
        ) : property.guessCount > 0 ? (
          <View className="mt-4 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Icon name="Users" size={14} color="#9C9B99" />
              <Text className="ml-1.5 text-[12px] text-[#9C9B99]">
                {property.guessCount} {property.guessCount === 1 ? 'person has' : 'people have'} guessed
              </Text>
            </View>
            {onGuessPress ? (
              <Text
                className="font-medium text-[12px] text-[#9C9B99]"
                onPress={onGuessPress}
              >
                View guesses →
              </Text>
            ) : null}
          </View>
        ) : null}

        {submitGuess.isError ? (
          <View className="mt-4 flex-row items-center rounded-lg border border-red-200 bg-red-50 p-2">
            <Ionicons name="alert-circle" size={16} color="#EF4444" />
            <Text className="ml-2 flex-1 text-xs text-red-600">
              {submitGuess.error instanceof Error
                ? submitGuess.error.message
                : 'Failed to submit guess. Please try again.'}
            </Text>
          </View>
        ) : null}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    padding: 18,
    borderWidth: 1,
    borderColor: '#F1ECE4',
    backgroundColor: '#FFFFFF',
  },
});
