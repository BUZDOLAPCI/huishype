import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Icon } from './ui/Icon';
import { SkeletonBlock } from './ui/Skeleton';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  interpolate,
  Easing,
} from 'react-native-reanimated';

import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';
import type { FmvDistribution } from '../hooks/usePriceGuess';
import type { IconName } from './ui/Icon';

// ─── Types ────────────────────────────────────────────────────────────────

export type FMVVisualizationVariant = 'compact' | 'full' | 'embedded';

export interface FMVData {
  value: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  guessCount: number;
  distribution: FmvDistribution | null;
  officialValuation?: number | null;
  askingPrice?: number | null;
  divergence?: number | null;
}

export interface FMVVisualizationProps {
  fmv: FMVData | null;
  userGuess?: number;
  askingPrice?: number;
  officialValuation?: number;
  officialValuationYear?: number | null;
  officialValuationLoading?: boolean;
  countryCode?: string;
  isLoading?: boolean;
  /** Display variant. Default 'full'. */
  variant?: FMVVisualizationVariant;
  testID?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

function formatValuationLabel(countryCode?: string, year?: number | null): string {
  const label = getValuationLabel(countryCode);
  return year ? `${label} (${year})` : label;
}

function getConfidenceInfo(confidence: 'none' | 'low' | 'medium' | 'high', guessCount: number): {
  bgColor: string;
  textColor: string;
  text: string;
  label: string;
  icon: IconName;
  iconHex: string;
} {
  switch (confidence) {
    case 'none':
      return {
        bgColor: 'bg-warm-100',
        textColor: 'text-warm-500',
        text: 'No guesses yet',
        label: 'None',
        icon: 'Info',
        iconHex: '#9C958A',
      };
    case 'low':
      return {
        bgColor: 'bg-yellow-100',
        textColor: 'text-yellow-700',
        text: `Low confidence \u2013 only ${guessCount} guess${guessCount === 1 ? '' : 'es'}`,
        label: 'Low',
        icon: 'WarningCircle',
        iconHex: '#B45309',
      };
    case 'medium':
      return {
        bgColor: 'bg-primary-100',
        textColor: 'text-primary-700',
        text: 'Building consensus',
        label: 'Medium',
        icon: 'ChartLineUp',
        iconHex: '#B47712',
      };
    case 'high':
      return {
        bgColor: 'bg-green-100',
        textColor: 'text-green-700',
        text: `High confidence (${guessCount} guesses)`,
        label: 'High confidence',
        icon: 'CheckCircle',
        iconHex: '#15803D',
      };
  }
}

function getPositionOnBar(value: number, min: number, max: number): number {
  if (max === min) return 50;
  const position = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, position));
}

// ─── Sub-components ───────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <View className="p-4 bg-surface-card rounded-xl" testID="fmv-loading">
      <View className="flex-row items-center justify-between mb-3">
        <SkeletonBlock className="h-6 w-32" />
        <SkeletonBlock className="h-5 w-24" radius={999} />
      </View>
      <SkeletonBlock className="h-10 w-40 mb-4" />
      <SkeletonBlock className="h-4 mb-4" radius={999} />
      <SkeletonBlock className="h-4 w-28" />
    </View>
  );
}

function NoDataState() {
  return (
    <View className="p-4 bg-warm-50 rounded-xl" testID="fmv-no-data">
      <View className="flex-row items-center mb-2">
        <Icon name="ChartLineUp" size={20} color="#C7BFB3" />
        <Text className="text-base font-medium text-warm-500 ml-2">
          Crowd Estimate
        </Text>
      </View>
      <Text className="text-sm text-warm-400">
        Not enough data yet. Be the first to guess!
      </Text>
    </View>
  );
}

/**
 * Price comparison bar with dot markers for WOZ, Crowd, Asking, and User guess.
 * Design spec: Section 7.7 (Price comparison bar, Dot markers).
 */
function ComparisonBar({
  fmvValue,
  officialValuation,
  askingPrice,
  userGuess,
  countryCode,
}: {
  fmvValue: number;
  officialValuation?: number;
  askingPrice?: number;
  userGuess?: number;
  countryCode?: string;
}) {
  // Collect all values to determine min/max for positioning
  const values = [fmvValue];
  if (officialValuation) values.push(officialValuation);
  if (askingPrice) values.push(askingPrice);
  if (userGuess) values.push(userGuess);

  const minVal = Math.min(...values) * 0.95;
  const maxVal = Math.max(...values) * 1.05;

  const markers: Array<{ value: number; color: string; label: string }> = [];

  if (officialValuation) {
    markers.push({
      value: officialValuation,
      color: '#1A1918',
      label: getValuationLabel(countryCode).split(' ')[0],
    });
  }

  markers.push({
    value: fmvValue,
    color: '#4CAF50',
    label: 'Crowd',
  });

  if (askingPrice) {
    markers.push({
      value: askingPrice,
      color: '#F5A623',
      label: 'Asking',
    });
  }

  if (userGuess) {
    markers.push({
      value: userGuess,
      color: '#42A5F5',
      label: 'Yours',
    });
  }

  return (
    <View className="mt-4 mb-2">
      {/* Track */}
      <View className="h-1.5 bg-warm-200 rounded-full relative overflow-visible">
        {markers.map((marker) => {
          const pos = getPositionOnBar(marker.value, minVal, maxVal);
          return (
            <View
              key={marker.label}
              className="absolute"
              style={{
                left: `${pos}%`,
                top: -3,
                transform: [{ translateX: -6 }],
              }}
            >
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: marker.color,
                  borderWidth: 2,
                  borderColor: '#FFFFFF',
                }}
              />
            </View>
          );
        })}
      </View>

      {/* Labels below track */}
      <View className="flex-row justify-between mt-3">
        {markers.map((marker) => (
          <View key={marker.label} className="items-center">
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: marker.color,
                marginBottom: 2,
              }}
            />
            <Text className="text-micro text-warm-500">{marker.label}</Text>
            <Text className="text-micro text-warm-700 font-medium">
              {formatPrice(marker.value, countryCode)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

export function FMVVisualization({
  fmv,
  userGuess,
  askingPrice: askingPriceProp,
  officialValuation: officialValuationProp,
  officialValuationYear,
  officialValuationLoading = false,
  countryCode,
  isLoading = false,
  variant = 'full',
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
  const officialValuation = officialValuationProp ?? fmv.officialValuation ?? undefined;

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

  if (variant === 'embedded') {
    return (
      <View testID={testID}>
        <Text className="font-display-semibold text-[11px] uppercase tracking-[0.8px] text-[#9C9B99]">
          Crowd Estimate
        </Text>

        <View className="mt-2 flex-row items-center gap-3">
          <Animated.View style={valueAnimatedStyle}>
            <Text
              className="font-display-bold text-[32px] leading-[38px] tracking-[-1px] text-[#1A1918]"
              testID="fmv-value"
            >
              {formatPrice(fmv.value, countryCode)}
            </Text>
          </Animated.View>

          <View
            className="flex-row items-center rounded-full px-2.5 py-1"
            style={{
              backgroundColor:
                fmv.confidence === 'high'
                  ? '#C8F0D8'
                  : fmv.confidence === 'medium'
                    ? '#F5E8BC'
                    : '#F5E4DA',
            }}
          >
            <Icon
              name={
                fmv.confidence === 'high'
                  ? 'ShieldCheck'
                  : fmv.confidence === 'medium'
                    ? 'ChartLineUp'
                    : 'Info'
              }
              size={12}
              color={
                fmv.confidence === 'high'
                  ? '#3D8A5A'
                  : fmv.confidence === 'medium'
                    ? '#8C6A16'
                    : '#B56D4E'
              }
            />
            <Text
              className="ml-1 font-display-semibold text-[11px]"
              style={{
                color:
                  fmv.confidence === 'high'
                    ? '#3D8A5A'
                    : fmv.confidence === 'medium'
                      ? '#8C6A16'
                      : '#B56D4E',
              }}
            >
              {confidenceInfo.label}
            </Text>
          </View>
        </View>

        <View className="mt-4 h-px bg-[#E5E4E1]" />
      </View>
    );
  }

  return (
    <View className="p-4 bg-surface-card rounded-xl shadow-sm" testID={testID}>
      {/* Header with confidence badge */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <Icon name="ChartLineUp" size={20} color="#F5A623" />
          <Text className="text-base font-medium text-warm-700 ml-2">
            Crowd Estimate
          </Text>
        </View>
        <View className={`flex-row items-center px-2 py-1 rounded-full ${confidenceInfo.bgColor}`}>
          <Icon
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
          {formatPrice(fmv.value, countryCode)}
        </Text>
        <Text className="text-xs text-warm-400 mb-4">
          {confidenceInfo.text}
        </Text>
      </Animated.View>

      {/* Comparison bar (full variant only, when multiple price references exist) */}
      {variant === 'full' && (officialValuation || askingPrice || userGuess) && (
        <ComparisonBar
          fmvValue={fmv.value}
          officialValuation={officialValuation}
          askingPrice={askingPrice}
          userGuess={userGuess}
          countryCode={countryCode}
        />
      )}

      {/* Percentile Distribution Bar */}
      {dist && (
        <View className="mb-6">
          {/* Full range bar (p10 to p90) */}
          <View className="relative h-3 bg-warm-100 rounded-full overflow-hidden">
            {/* P10-P90 range (light fill) */}
            <View
              className="absolute top-0 bottom-0 bg-primary-100 rounded-full"
              style={{
                left: `${getPositionOnBar(dist.p10, dist.min, dist.max)}%`,
                right: `${100 - getPositionOnBar(dist.p90, dist.min, dist.max)}%`,
              }}
            />
            {/* P25-P75 IQR (darker fill) */}
            <View
              className="absolute top-0 bottom-0 bg-primary-300 rounded-full"
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
            <Text className="text-xs text-warm-400">{formatPrice(dist.min, countryCode)}</Text>
            <Text className="text-xs text-warm-400">{formatPrice(dist.max, countryCode)}</Text>
          </View>

          {/* Percentile legend (full variant only) */}
          {variant === 'full' && (
            <View className="flex-row items-center justify-center mt-2 gap-3">
              <View className="flex-row items-center">
                <View className="w-3 h-2 bg-primary-100 rounded-sm mr-1" />
                <Text className="text-xs text-warm-400">P10-P90</Text>
              </View>
              <View className="flex-row items-center">
                <View className="w-3 h-2 bg-primary-300 rounded-sm mr-1" />
                <Text className="text-xs text-warm-400">P25-P75</Text>
              </View>
              <View className="flex-row items-center">
                <View className="w-2 h-2 bg-primary-700 rounded-sm mr-1" />
                <Text className="text-xs text-warm-400">Median</Text>
              </View>
            </View>
          )}

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
            <Icon
              name={divergence > 0 ? 'ChartLineUp' : divergence < 0 ? 'TrendDown' : 'Info'}
              size={14}
              color={divergence > 0 ? '#22C55E' : divergence < 0 ? '#EF4444' : '#9C958A'}
            />
            <Text className="text-sm text-warm-600 ml-1">
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
            <Icon
              name={askingPriceDiff > 0 ? 'ChartLineUp' : 'TrendDown'}
              size={14}
              color={askingPriceDiff > 0 ? '#EF4444' : '#22C55E'}
            />
            <Text className="text-sm text-warm-600 ml-1">
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
            <Icon name="User" size={14} color="#9C958A" />
            <Text className="text-sm text-warm-600 ml-1">
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

        {/* Show official valuation in comparisons section when no side-by-side cards */}
        {variant === 'compact' && (officialValuation || officialValuationLoading) && (
          <View className="flex-row items-center mt-1">
            <Icon name="Buildings" size={14} color="#9C958A" />
            <View className="ml-1 flex-row items-center">
              <Text className="text-sm text-warm-500">
                {formatValuationLabel(countryCode, officialValuationYear)}:{' '}
              </Text>
              {officialValuationLoading ? (
                <SkeletonBlock
                  testID="fmv-valuation-value-skeleton"
                  width={72}
                  height={14}
                  radius={5}
                />
              ) : officialValuation ? (
                <Text className="text-sm text-warm-500">
                  {formatPrice(officialValuation, countryCode)}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      </View>

      {/* Guess count */}
      <Text className="text-xs text-warm-400 mt-3 text-center">
        Based on {fmv.guessCount} guess{fmv.guessCount === 1 ? '' : 'es'}
      </Text>
    </View>
  );
}
