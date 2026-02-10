import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  interpolate,
  Easing,
} from 'react-native-reanimated';

import type { FmvDistribution } from '../hooks/usePriceGuess';

export interface FMVData {
  value: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  guessCount: number;
  distribution: FmvDistribution | null;
  wozValue?: number | null;
  askingPrice?: number | null;
  divergence?: number | null;
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
function getConfidenceInfo(confidence: 'none' | 'low' | 'medium' | 'high', guessCount: number): {
  bgColor: string;
  textColor: string;
  text: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconHex: string;
} {
  switch (confidence) {
    case 'none':
      return {
        bgColor: 'bg-gray-100',
        textColor: 'text-gray-500',
        text: 'No guesses yet',
        label: 'None',
        icon: 'help-circle-outline',
        iconHex: '#6B7280',
      };
    case 'low':
      return {
        bgColor: 'bg-yellow-100',
        textColor: 'text-yellow-700',
        text: `Low confidence \u2013 only ${guessCount} guess${guessCount === 1 ? '' : 'es'}`,
        label: 'Low',
        icon: 'alert-circle-outline',
        iconHex: '#B45309',
      };
    case 'medium':
      return {
        bgColor: 'bg-blue-100',
        textColor: 'text-blue-700',
        text: 'Building consensus',
        label: 'Medium',
        icon: 'trending-up-outline',
        iconHex: '#1D4ED8',
      };
    case 'high':
      return {
        bgColor: 'bg-green-100',
        textColor: 'text-green-700',
        text: 'Strong consensus',
        label: 'High',
        icon: 'checkmark-circle-outline',
        iconHex: '#15803D',
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

export function FMVVisualization({
  fmv,
  userGuess,
  askingPrice: askingPriceProp,
  wozValue: wozValueProp,
  isLoading = false,
  testID = 'fmv-visualization',
}: FMVVisualizationProps) {
  // Animation values
  const barWidth = useSharedValue(0);
  const valueOpacity = useSharedValue(0);

  useEffect(() => {
    if (fmv && fmv.value) {
      barWidth.value = withTiming(100, { duration: 800, easing: Easing.out(Easing.cubic) });
      valueOpacity.value = withDelay(300, withTiming(1, { duration: 400 }));
    }
  }, [fmv, barWidth, valueOpacity]);

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

  // Show no-data when null, no confidence, or no FMV value
  if (!fmv || fmv.confidence === 'none' || fmv.value === null) {
    return <NoDataState />;
  }

  const confidenceInfo = getConfidenceInfo(fmv.confidence, fmv.guessCount);
  const dist = fmv.distribution;

  // Use props or FMV-embedded values for asking price and WOZ
  const askingPrice = askingPriceProp ?? fmv.askingPrice ?? undefined;
  const wozValue = wozValueProp ?? fmv.wozValue ?? undefined;

  // Use backend divergence or calculate from asking price
  const divergence = fmv.divergence ?? (
    askingPrice && fmv.value
      ? Math.round(((fmv.value - askingPrice) / askingPrice) * 100)
      : null
  );

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
            color={confidenceInfo.iconHex}
          />
          <Text className={`text-xs font-medium ml-1 ${confidenceInfo.textColor}`}>
            {confidenceInfo.label}
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

      {/* Percentile Distribution Bar */}
      {dist && (
        <View className="mb-6">
          {/* Full range bar (p10 to p90) */}
          <View className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
            {/* P10-P90 range (light fill) */}
            <View
              className="absolute top-0 bottom-0 bg-blue-100 rounded-full"
              style={{
                left: `${getPositionOnBar(dist.p10, dist.min, dist.max)}%`,
                right: `${100 - getPositionOnBar(dist.p90, dist.min, dist.max)}%`,
              }}
            />
            {/* P25-P75 IQR (darker fill) */}
            <View
              className="absolute top-0 bottom-0 bg-blue-300 rounded-full"
              style={{
                left: `${getPositionOnBar(dist.p25, dist.min, dist.max)}%`,
                right: `${100 - getPositionOnBar(dist.p75, dist.min, dist.max)}%`,
              }}
            />
            {/* Median marker (P50) */}
            <View
              className="absolute top-0 bottom-0 w-0.5 bg-primary-700"
              style={{
                left: `${getPositionOnBar(dist.p50, dist.min, dist.max)}%`,
                transform: [{ translateX: -1 }],
              }}
            />
          </View>

          {/* Min/Max labels */}
          <View className="flex-row justify-between mt-1">
            <Text className="text-xs text-gray-400">{formatPrice(dist.min)}</Text>
            <Text className="text-xs text-gray-400">{formatPrice(dist.max)}</Text>
          </View>

          {/* Percentile legend */}
          <View className="flex-row items-center justify-center mt-2 gap-3">
            <View className="flex-row items-center">
              <View className="w-3 h-2 bg-blue-100 rounded-sm mr-1" />
              <Text className="text-xs text-gray-400">P10-P90</Text>
            </View>
            <View className="flex-row items-center">
              <View className="w-3 h-2 bg-blue-300 rounded-sm mr-1" />
              <Text className="text-xs text-gray-400">P25-P75</Text>
            </View>
            <View className="flex-row items-center">
              <View className="w-2 h-2 bg-primary-700 rounded-sm mr-1" />
              <Text className="text-xs text-gray-400">Median</Text>
            </View>
          </View>

          {/* Markers row */}
          <View className="relative h-8 mt-2">
            {/* User guess marker */}
            {userGuess && (
              <View
                className="absolute -top-1"
                style={{
                  left: `${getPositionOnBar(userGuess, dist.min, dist.max)}%`,
                  transform: [{ translateX: -8 }],
                }}
              >
                <View className="w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-sm" />
                <Text className="text-xs font-medium text-green-600 mt-0.5">You</Text>
              </View>
            )}

            {/* Asking price marker */}
            {askingPrice && (
              <View
                className="absolute -top-1"
                style={{
                  left: `${getPositionOnBar(askingPrice, dist.min, dist.max)}%`,
                  transform: [{ translateX: -8 }],
                }}
              >
                <View className="w-4 h-4 bg-orange-500 rounded-full border-2 border-white shadow-sm" />
                <Text className="text-xs font-medium text-orange-600 mt-0.5">Ask</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Comparisons */}
      <View className="space-y-2">
        {/* Divergence from asking price */}
        {divergence !== null && askingPrice && (
          <View className="flex-row items-center">
            <Ionicons
              name={divergence > 0 ? 'trending-up' : divergence < 0 ? 'trending-down' : 'remove'}
              size={14}
              color={divergence > 0 ? '#22C55E' : divergence < 0 ? '#EF4444' : '#6B7280'}
            />
            <Text className="text-sm text-gray-600 ml-1">
              {divergence > 0
                ? `Crowd thinks it\u2019s worth ${Math.abs(divergence)}% more than asking`
                : divergence < 0
                ? `Asking price is ${Math.abs(divergence)}% above crowd estimate`
                : 'Asking price matches crowd estimate'}
            </Text>
          </View>
        )}

        {askingPriceDiff !== null && !divergence && (
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
