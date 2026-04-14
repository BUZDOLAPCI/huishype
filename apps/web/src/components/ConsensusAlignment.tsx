import { Text, View } from '../runtime/dom';
import { Icon, type IconName } from './ui/Icon';

import { formatPropertyPrice, type CountryCode } from '@huishype/shared';
import type { PriceGuess } from '../hooks/usePriceGuess';

const MIN_GUESSES_FOR_CONSENSUS = 3;

export type ConsensusAlignmentVariant = 'compact' | 'full';

export interface ConsensusAlignmentProps {
  userGuess: number;
  crowdEstimate: number;
  percentileRank?: number;
  topPredictorsAgreement?: number;
  guessCount: number;
  guesses?: PriceGuess[];
  countryCode?: string;
  isVisible?: boolean;
  /** Display variant. Default 'full'. */
  variant?: ConsensusAlignmentVariant;
  testID?: string;
}

/**
 * Calculate what % of other guessers are within ±10% of the user's guess.
 * Returns a number 0-100.
 */
export function calculateAlignmentPercentage(
  userGuess: number,
  guesses: PriceGuess[],
  userId?: string,
): number {
  const otherGuesses = userId ? guesses.filter((g) => g.userId !== userId) : guesses;

  if (otherGuesses.length === 0) return 0;

  const lowerBound = userGuess * 0.9;
  const upperBound = userGuess * 1.1;

  const withinRange = otherGuesses.filter(
    (g) => g.guessedPrice >= lowerBound && g.guessedPrice <= upperBound,
  );

  return (withinRange.length / otherGuesses.length) * 100;
}

function getAlignmentInfo(userGuess: number, crowdEstimate: number): {
  category: 'aligned' | 'close' | 'different';
  icon: IconName;
  iconColor: string;
  bgColor: string;
  borderColor: string;
} {
  const percentDiff = Math.abs((userGuess - crowdEstimate) / crowdEstimate) * 100;

  if (percentDiff <= 5) {
    return {
      category: 'aligned',
      icon: 'CheckCircle',
      iconColor: '#22C55E',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
    };
  }

  if (percentDiff <= 15) {
    return {
      category: 'close',
      icon: 'Info',
      iconColor: '#F5A623',
      bgColor: 'bg-primary-50',
      borderColor: 'border-primary-200',
    };
  }

  return {
    category: 'different',
    icon: 'ChartLineUp',
    iconColor: '#F59E0B',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  };
}

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

function generateMessage(
  userGuess: number,
  crowdEstimate: number,
  alignmentPercentage: number,
): string {
  const percentDiff = ((userGuess - crowdEstimate) / crowdEstimate) * 100;
  const absDiff = Math.abs(percentDiff);

  if (absDiff <= 5) {
    return `You agree with ${Math.round(alignmentPercentage)}% of top predictors`;
  }
  if (absDiff <= 15) {
    return 'Your guess is close to the crowd consensus';
  }

  const direction = percentDiff > 0 ? 'above' : 'below';
  return `Your guess is ${Math.round(absDiff)}% ${direction} the crowd estimate`;
}

export function ConsensusAlignment({
  userGuess,
  crowdEstimate,
  percentileRank,
  topPredictorsAgreement,
  guessCount,
  guesses,
  countryCode,
  isVisible = true,
  variant = 'full',
  testID = 'consensus-alignment',
}: ConsensusAlignmentProps) {
  if (!isVisible || !crowdEstimate || crowdEstimate === 0) {
    return null;
  }

  const hasEnoughGuesses = guessCount >= MIN_GUESSES_FOR_CONSENSUS;
  const alignmentPercentage =
    topPredictorsAgreement ??
    (guesses && guesses.length > 0 ? calculateAlignmentPercentage(userGuess, guesses) : 0);
  const alignmentInfo = getAlignmentInfo(userGuess, crowdEstimate);
  const message = hasEnoughGuesses
    ? generateMessage(userGuess, crowdEstimate, alignmentPercentage)
    : 'Not enough data for consensus';

  return (
    <View
      className={`p-4 rounded-xl border ${alignmentInfo.bgColor} ${alignmentInfo.borderColor}`}
      testID={testID}
    >
      <View className="flex-row items-start">
        <View className="mr-3 mt-0.5">
          <Icon name={alignmentInfo.icon} size={28} color={alignmentInfo.iconColor} />
        </View>

        <View className="flex-1">
          <Text className="text-base font-semibold text-warm-800 mb-1" testID="consensus-message">
            {message}
          </Text>

          <View className="space-y-1">
            {percentileRank !== undefined ? (
              <Text className="text-sm text-warm-500">
                Your guess is higher than {Math.round(percentileRank)}% of predictions
              </Text>
            ) : null}

            <Text className="text-xs text-warm-400 mt-1">
              Based on {guessCount} guess{guessCount === 1 ? '' : 'es'}
            </Text>
          </View>

          {hasEnoughGuesses && alignmentInfo.category !== 'different' ? (
            <View className="flex-row items-center mt-3">
              <View className="flex-1 h-1.5 bg-warm-200 rounded-full overflow-hidden">
                <View
                  className={`h-full rounded-full ${
                    alignmentInfo.category === 'aligned' ? 'bg-green-500' : 'bg-primary-500'
                  }`}
                  style={{ width: `${alignmentPercentage}%` }}
                />
              </View>
              <Text className="text-xs font-medium text-warm-500 ml-2">
                {Math.round(alignmentPercentage)}%
              </Text>
            </View>
          ) : null}

          {hasEnoughGuesses && alignmentInfo.category === 'different' ? (
            <View className="flex-row items-center justify-between mt-3 bg-surface-card/50 rounded-lg p-2">
              <View className="items-center">
                <Text className="text-xs text-warm-400">Your guess</Text>
                <Text className="text-sm font-semibold text-warm-700">
                  {formatPrice(userGuess, countryCode)}
                </Text>
              </View>
              <Icon name="ArrowRight" size={20} color="#C7BFB3" />
              <View className="items-center">
                <Text className="text-xs text-warm-400">Crowd</Text>
                <Text className="text-sm font-semibold text-warm-700">
                  {formatPrice(crowdEstimate, countryCode)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
