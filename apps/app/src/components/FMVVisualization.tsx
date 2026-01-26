import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
  withDelay,
  interpolate,
  Easing,
} from 'react-native-reanimated';

export interface FMVData {
  value: number;
  confidence: 'low' | 'medium' | 'high';
  guessCount: number;
  distribution: {
    min: number;
    max: number;
    median: number;
  };
}

export interface FMVVisualizationProps {
  fmv: FMVData | null;
  userGuess?: number;
  askingPrice?: number;
  wozValue?: number;
  isLoading?: boolean;
  testID?: string;
}

// Format price in Dutch locale
function formatPrice(price: number): string {
  return `\u20AC${price.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`;
}

// Get confidence badge color and text
function getConfidenceInfo(confidence: 'low' | 'medium' | 'high', guessCount: number): {
  bgColor: string;
  textColor: string;
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
} {
  switch (confidence) {
    case 'low':
      return {
        bgColor: 'bg-yellow-100',
        textColor: 'text-yellow-700',
        text: `Low confidence - only ${guessCount} guess${guessCount === 1 ? '' : 'es'}`,
        icon: 'alert-circle-outline',
      };
    case 'medium':
      return {
        bgColor: 'bg-blue-100',
        textColor: 'text-blue-700',
        text: 'Building consensus',
        icon: 'trending-up-outline',
      };
    case 'high':
      return {
        bgColor: 'bg-green-100',
        textColor: 'text-green-700',
        text: 'Strong consensus',
        icon: 'checkmark-circle-outline',
      };
  }
}

// Calculate position on distribution bar (0-100%)
function getPositionOnBar(value: number, min: number, max: number): number {
  if (max === min) return 50;
  const position = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, position));
}

// Loading skeleton component
function LoadingSkeleton() {
  return (
    <View className="p-4 bg-white rounded-xl" testID="fmv-loading">
      <View className="flex-row items-center justify-between mb-3">
        <View className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
        <View className="h-5 w-24 bg-gray-200 rounded-full animate-pulse" />
      </View>
      <View className="h-10 w-40 bg-gray-200 rounded mb-4 animate-pulse" />
      <View className="h-4 bg-gray-200 rounded-full mb-4 animate-pulse" />
      <View className="h-4 w-28 bg-gray-200 rounded animate-pulse" />
    </View>
  );
}

// No data state
function NoDataState() {
  return (
    <View className="p-4 bg-gray-50 rounded-xl" testID="fmv-no-data">
      <View className="flex-row items-center mb-2">
        <Ionicons name="analytics-outline" size={20} color="#9CA3AF" />
        <Text className="text-base font-medium text-gray-500 ml-2">
          Crowd Estimate
        </Text>
      </View>
      <Text className="text-sm text-gray-400">
        Not enough data yet. Be the first to guess!
      </Text>
    </View>
  );
}

// Distribution marker component
function Marker({
  position,
  color,
  label,
  isAbove,
}: {
  position: number;
  color: string;
  label: string;
  isAbove: boolean;
}) {
  const animatedPosition = useSharedValue(0);

  useEffect(() => {
    animatedPosition.value = withDelay(200, withSpring(position, { damping: 15 }));
  }, [position, animatedPosition]);

  const animatedStyle = useAnimatedStyle(() => ({
    left: `${animatedPosition.value}%`,
  }));

  return (
    <Animated.View
      className={`absolute ${isAbove ? '-top-6' : '-bottom-6'}`}
      style={[animatedStyle, { transform: [{ translateX: -12 }] }]}
    >
      <View className="items-center">
        {isAbove && (
          <Text className={`text-xs font-medium ${color} mb-0.5`}>{label}</Text>
        )}
        <View className={`w-0.5 h-3 ${color.replace('text-', 'bg-')}`} />
        {!isAbove && (
          <Text className={`text-xs font-medium ${color} mt-0.5`}>{label}</Text>
        )}
      </View>
    </Animated.View>
  );
}

export function FMVVisualization({
  fmv,
  userGuess,
  askingPrice,
  wozValue,
  isLoading = false,
  testID = 'fmv-visualization',
}: FMVVisualizationProps) {
  // Animation values
  const barWidth = useSharedValue(0);
  const valueOpacity = useSharedValue(0);

  useEffect(() => {
    if (fmv) {
      barWidth.value = withTiming(100, { duration: 800, easing: Easing.out(Easing.cubic) });
      valueOpacity.value = withDelay(300, withTiming(1, { duration: 400 }));
    }
  }, [fmv, barWidth, valueOpacity]);

  const barAnimatedStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%`,
  }));

  const valueAnimatedStyle = useAnimatedStyle(() => ({
    opacity: valueOpacity.value,
    transform: [
      {
        scale: interpolate(valueOpacity.value, [0, 1], [0.9, 1]),
      },
    ],
  }));

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!fmv) {
    return <NoDataState />;
  }

  const confidenceInfo = getConfidenceInfo(fmv.confidence, fmv.guessCount);
  const { min, max, median } = fmv.distribution;

  // Calculate comparison percentages
  const askingPriceDiff = askingPrice
    ? ((askingPrice - fmv.value) / fmv.value) * 100
    : null;
  const userGuessDiff = userGuess
    ? ((userGuess - fmv.value) / fmv.value) * 100
    : null;

  return (
    <View className="p-4 bg-white rounded-xl shadow-sm" testID={testID}>
      {/* Header with confidence badge */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <Ionicons name="analytics" size={20} color="#3B82F6" />
          <Text className="text-base font-medium text-gray-700 ml-2">
            Crowd Estimate
          </Text>
        </View>
        <View className={`flex-row items-center px-2 py-1 rounded-full ${confidenceInfo.bgColor}`}>
          <Ionicons
            name={confidenceInfo.icon}
            size={14}
            color={confidenceInfo.textColor.includes('yellow') ? '#B45309' :
                   confidenceInfo.textColor.includes('blue') ? '#1D4ED8' : '#15803D'}
          />
          <Text className={`text-xs font-medium ml-1 ${confidenceInfo.textColor}`}>
            {fmv.confidence === 'low' ? 'Low' : fmv.confidence === 'medium' ? 'Medium' : 'High'}
          </Text>
        </View>
      </View>

      {/* FMV Value */}
      <Animated.View style={valueAnimatedStyle}>
        <Text className="text-3xl font-bold text-primary-600 mb-1" testID="fmv-value">
          {formatPrice(fmv.value)}
        </Text>
        <Text className="text-xs text-gray-400 mb-4">
          {confidenceInfo.text}
        </Text>
      </Animated.View>

      {/* Distribution Bar */}
      <View className="mb-8">
        <View className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
          <Animated.View
            className="h-full bg-gradient-to-r from-blue-300 to-primary-500 rounded-full"
            style={barAnimatedStyle}
          />

          {/* Median marker (center indicator) */}
          <View
            className="absolute top-0 bottom-0 w-1 bg-primary-700"
            style={{ left: `${getPositionOnBar(median, min, max)}%`, transform: [{ translateX: -2 }] }}
          />
        </View>

        {/* Min/Max labels */}
        <View className="flex-row justify-between mt-1">
          <Text className="text-xs text-gray-400">{formatPrice(min)}</Text>
          <Text className="text-xs text-gray-400">{formatPrice(max)}</Text>
        </View>

        {/* Markers */}
        <View className="relative h-8 mt-2">
          {/* Median marker */}
          <View
            className="absolute"
            style={{ left: `${getPositionOnBar(median, min, max)}%`, transform: [{ translateX: -16 }] }}
          >
            <Text className="text-xs font-medium text-primary-600">Median</Text>
          </View>

          {/* User guess marker */}
          {userGuess && (
            <View
              className="absolute -top-2"
              style={{ left: `${getPositionOnBar(userGuess, min, max)}%`, transform: [{ translateX: -8 }] }}
            >
              <View className="w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-sm" />
              <Text className="text-xs font-medium text-green-600 mt-0.5">You</Text>
            </View>
          )}

          {/* Asking price marker */}
          {askingPrice && (
            <View
              className="absolute -top-2"
              style={{
                left: `${getPositionOnBar(askingPrice, min, max)}%`,
                transform: [{ translateX: -8 }]
              }}
            >
              <View className="w-4 h-4 bg-orange-500 rounded-full border-2 border-white shadow-sm" />
              <Text className="text-xs font-medium text-orange-600 mt-0.5">Ask</Text>
            </View>
          )}
        </View>
      </View>

      {/* Comparisons */}
      <View className="space-y-2">
        {askingPriceDiff !== null && (
          <View className="flex-row items-center">
            <Ionicons
              name={askingPriceDiff > 0 ? 'arrow-up' : 'arrow-down'}
              size={14}
              color={askingPriceDiff > 0 ? '#EF4444' : '#22C55E'}
            />
            <Text className="text-sm text-gray-600 ml-1">
              Asking price is{' '}
              <Text className={askingPriceDiff > 0 ? 'text-red-500 font-medium' : 'text-green-500 font-medium'}>
                {Math.abs(askingPriceDiff).toFixed(0)}% {askingPriceDiff > 0 ? 'above' : 'below'}
              </Text>
              {' '}crowd estimate
            </Text>
          </View>
        )}

        {userGuessDiff !== null && (
          <View className="flex-row items-center mt-1">
            <Ionicons name="person" size={14} color="#6B7280" />
            <Text className="text-sm text-gray-600 ml-1">
              Your guess is{' '}
              <Text className="font-medium">
                {Math.abs(userGuessDiff) < 5
                  ? 'aligned with'
                  : `${Math.abs(userGuessDiff).toFixed(0)}% ${userGuessDiff > 0 ? 'above' : 'below'}`}
              </Text>
              {' '}the median
            </Text>
          </View>
        )}

        {wozValue && (
          <View className="flex-row items-center mt-1">
            <Ionicons name="business" size={14} color="#6B7280" />
            <Text className="text-sm text-gray-500 ml-1">
              WOZ: {formatPrice(wozValue)}
            </Text>
          </View>
        )}
      </View>

      {/* Guess count */}
      <Text className="text-xs text-gray-400 mt-3 text-center">
        Based on {fmv.guessCount} guess{fmv.guessCount === 1 ? '' : 'es'}
      </Text>
    </View>
  );
}
