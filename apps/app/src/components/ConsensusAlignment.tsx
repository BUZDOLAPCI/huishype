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
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

export interface ConsensusAlignmentProps {
  userGuess: number;
  crowdEstimate: number;
  percentileRank?: number;
  topPredictorsAgreement?: number;
  guessCount: number;
  isVisible?: boolean;
  testID?: string;
}

// Calculate alignment percentage (mock - in production this would come from backend)
function calculateAlignmentPercentage(userGuess: number, crowdEstimate: number): number {
  const difference = Math.abs(userGuess - crowdEstimate);
  const percentDiff = (difference / crowdEstimate) * 100;

  if (percentDiff <= 5) return 85 + Math.random() * 15; // 85-100%
  if (percentDiff <= 10) return 70 + Math.random() * 15; // 70-85%
  if (percentDiff <= 20) return 50 + Math.random() * 15; // 50-65%
  return 30 + Math.random() * 15; // 30-45%
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

  const alignmentPercentage = topPredictorsAgreement ?? calculateAlignmentPercentage(userGuess, crowdEstimate);
  const alignmentInfo = getAlignmentInfo(userGuess, crowdEstimate);
  const message = generateMessage(userGuess, crowdEstimate, alignmentPercentage);

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
          {alignmentInfo.category !== 'different' && (
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
          {alignmentInfo.category === 'different' && (
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
