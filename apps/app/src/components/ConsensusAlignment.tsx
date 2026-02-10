import { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withDelay,
  withSequence,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import type { PriceGuess } from '../hooks/usePriceGuess';

const MIN_GUESSES_FOR_CONSENSUS = 3;

export interface ConsensusAlignmentProps {
  userGuess: number;
  crowdEstimate: number;
  percentileRank?: number;
  topPredictorsAgreement?: number;
  guessCount: number;
  guesses?: PriceGuess[];
  isVisible?: boolean;
  testID?: string;
}

/**
 * Calculate what % of other guessers are within ±10% of the user's guess.
 * Returns a number 0-100.
 */
export function calculateAlignmentPercentage(userGuess: number, guesses: PriceGuess[], userId?: string): number {
  // Exclude the user's own guess
  const otherGuesses = userId
    ? guesses.filter(g => g.userId !== userId)
    : guesses;

  if (otherGuesses.length === 0) return 0;

  const lowerBound = userGuess * 0.9;
  const upperBound = userGuess * 1.1;

  const withinRange = otherGuesses.filter(
    g => g.guessedPrice >= lowerBound && g.guessedPrice <= upperBound
  );

  return (withinRange.length / otherGuesses.length) * 100;
}

// Get alignment category and styling
function getAlignmentInfo(userGuess: number, crowdEstimate: number): {
  category: 'aligned' | 'close' | 'different';
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  bgColor: string;
  borderColor: string;
} {
  const percentDiff = Math.abs((userGuess - crowdEstimate) / crowdEstimate) * 100;

  if (percentDiff <= 5) {
    return {
      category: 'aligned',
      icon: 'checkmark-circle',
      iconColor: '#22C55E',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
    };
  }
  if (percentDiff <= 15) {
    return {
      category: 'close',
      icon: 'information-circle',
      iconColor: '#3B82F6',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
    };
  }
  return {
    category: 'different',
    icon: 'trending-up',
    iconColor: '#F59E0B',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  };
}

// Format price in Dutch locale
function formatPrice(price: number): string {
  return `\u20AC${price.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`;
}

// Generate the main message based on alignment
function generateMessage(
  userGuess: number,
  crowdEstimate: number,
  alignmentPercentage: number
): string {
  const percentDiff = ((userGuess - crowdEstimate) / crowdEstimate) * 100;
  const absDiff = Math.abs(percentDiff);

  if (absDiff <= 5) {
    return `You agree with ${Math.round(alignmentPercentage)}% of top predictors`;
  }
  if (absDiff <= 15) {
    return `Your guess is close to the crowd consensus`;
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
  isVisible = true,
  testID = 'consensus-alignment',
}: ConsensusAlignmentProps) {
  // Animation values
  const slideIn = useSharedValue(0);
  const iconScale = useSharedValue(0);
  const textOpacity = useSharedValue(0);

  useEffect(() => {
    if (isVisible) {
      // Slide in animation
      slideIn.value = withSpring(1, { damping: 15, stiffness: 150 });

      // Icon scale animation with bounce
      iconScale.value = withDelay(
        200,
        withSequence(
          withSpring(1.2, { damping: 8 }),
          withSpring(1, { damping: 12 })
        )
      );

      // Text fade in
      textOpacity.value = withDelay(300, withTiming(1, { duration: 300 }));

      // Trigger haptic feedback
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } else {
      slideIn.value = 0;
      iconScale.value = 0;
      textOpacity.value = 0;
    }
  }, [isVisible, slideIn, iconScale, textOpacity]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: slideIn.value,
    transform: [
      { translateY: interpolate(slideIn.value, [0, 1], [20, 0]) },
      { scale: interpolate(slideIn.value, [0, 1], [0.95, 1]) },
    ],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  if (!isVisible || !crowdEstimate || crowdEstimate === 0) {
    return null;
  }

  const hasEnoughGuesses = guessCount >= MIN_GUESSES_FOR_CONSENSUS;

  // Calculate real alignment from guesses array, or fall back to topPredictorsAgreement
  const alignmentPercentage = topPredictorsAgreement
    ?? (guesses && guesses.length > 0
      ? calculateAlignmentPercentage(userGuess, guesses)
      : 0);
  const alignmentInfo = getAlignmentInfo(userGuess, crowdEstimate);
  const message = hasEnoughGuesses
    ? generateMessage(userGuess, crowdEstimate, alignmentPercentage)
    : 'Not enough data for consensus';

  return (
    <Animated.View
      className={`p-4 rounded-xl border ${alignmentInfo.bgColor} ${alignmentInfo.borderColor}`}
      style={containerStyle}
      testID={testID}
    >
      <View className="flex-row items-start">
        {/* Icon */}
        <Animated.View style={iconStyle} className="mr-3 mt-0.5">
          <Ionicons
            name={alignmentInfo.icon}
            size={28}
            color={alignmentInfo.iconColor}
          />
        </Animated.View>

        {/* Text content */}
        <Animated.View style={textStyle} className="flex-1">
          <Text className="text-base font-semibold text-gray-800 mb-1" testID="consensus-message">
            {message}
          </Text>

          {/* Secondary info */}
          <View className="space-y-1">
            {percentileRank !== undefined && (
              <Text className="text-sm text-gray-500">
                Your guess is higher than {Math.round(percentileRank)}% of predictions
              </Text>
            )}

            <Text className="text-xs text-gray-400 mt-1">
              Based on {guessCount} guess{guessCount === 1 ? '' : 'es'}
            </Text>
          </View>

          {/* Visual representation */}
          {hasEnoughGuesses && alignmentInfo.category !== 'different' && (
            <View className="flex-row items-center mt-3">
              <View className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <View
                  className={`h-full rounded-full ${
                    alignmentInfo.category === 'aligned' ? 'bg-green-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${alignmentPercentage}%` }}
                />
              </View>
              <Text className="text-xs font-medium text-gray-500 ml-2">
                {Math.round(alignmentPercentage)}%
              </Text>
            </View>
          )}

          {/* Price comparison for "different" category */}
          {hasEnoughGuesses && alignmentInfo.category === 'different' && (
            <View className="flex-row items-center justify-between mt-3 bg-white/50 rounded-lg p-2">
              <View className="items-center">
                <Text className="text-xs text-gray-400">Your guess</Text>
                <Text className="text-sm font-semibold text-gray-700">
                  {formatPrice(userGuess)}
                </Text>
              </View>
              <Ionicons name="swap-horizontal" size={20} color="#9CA3AF" />
              <View className="items-center">
                <Text className="text-xs text-gray-400">Crowd estimate</Text>
                <Text className="text-sm font-semibold text-gray-700">
                  {formatPrice(crowdEstimate)}
                </Text>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
    </Animated.View>
  );
}
