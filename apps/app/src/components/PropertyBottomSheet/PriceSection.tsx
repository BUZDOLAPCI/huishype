import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';
import type { SectionProps } from './types';

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

function PriceComparisonBar({
  officialValuation,
  askingPrice,
  fmv,
  countryCode,
}: {
  officialValuation: number | null;
  askingPrice?: number;
  fmv?: number;
  countryCode?: string;
}) {
  if (!officialValuation) return null;

  const valuationLabel = getValuationLabel(countryCode);
  // Use short label for comparison bar legend
  const shortValuationLabel = countryCode === 'NL' ? 'WOZ' : 'Val.';

  const prices = [
    { label: shortValuationLabel, value: officialValuation, color: 'bg-warm-400' },
    askingPrice ? { label: 'Asking', value: askingPrice, color: 'bg-orange-500' } : null,
    fmv ? { label: 'FMV', value: fmv, color: 'bg-primary-500' } : null,
  ].filter(Boolean) as { label: string; value: number; color: string }[];

  if (prices.length < 2) return null;

  const minPrice = Math.min(...prices.map(p => p.value));
  const maxPrice = Math.max(...prices.map(p => p.value));
  const range = maxPrice - minPrice;

  return (
    <View className="mt-4">
      <Text className="text-xs text-warm-400 mb-2">Price Comparison</Text>
      <View className="h-2 bg-warm-100 rounded-full relative">
        {prices.map((price, index) => {
          const position = range > 0 ? ((price.value - minPrice) / range) * 100 : 50;
          return (
            <View
              key={price.label}
              className={`absolute w-3 h-3 ${price.color} rounded-full -top-0.5`}
              style={{ left: `${Math.max(0, Math.min(100 - 4, position))}%` }}
            />
          );
        })}
      </View>
      <View className="flex-row justify-between mt-1">
        <Text className="text-xs text-warm-400">{formatPrice(minPrice, countryCode)}</Text>
        <Text className="text-xs text-warm-400">{formatPrice(maxPrice, countryCode)}</Text>
      </View>
      {/* Legend */}
      <View className="flex-row flex-wrap gap-3 mt-2">
        {prices.map((price) => (
          <View key={price.label} className="flex-row items-center">
            <View className={`w-2 h-2 ${price.color} rounded-full mr-1`} />
            <Text className="text-xs text-warm-500">{price.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function PriceSection({ property }: SectionProps) {
  const { officialValuation, askingPrice, fmv: fmvData, guessCount, countryCode } = property;
  const fmv = fmvData?.fmv ?? undefined;
  const fmvConfidence = fmvData?.confidence;

  const confidenceLabels: Record<string, string> = {
    none: 'No data yet',
    low: 'Low confidence',
    medium: 'Medium confidence',
    high: 'High confidence',
  };

  const confidenceColors: Record<string, string> = {
    none: 'text-warm-400',
    low: 'text-red-500',
    medium: 'text-yellow-600',
    high: 'text-green-500',
  };

  return (
    <View className="px-4 py-4 border-t border-warm-100">
      <View className="flex-row flex-wrap">
        {/* Official Valuation */}
        {officialValuation && (
          <View className="w-1/2 mb-4 pr-2">
            <View className="flex-row items-center">
              <Ionicons name="home-outline" size={14} color="#C7BFB3" />
              <Text className="text-xs text-warm-400 ml-1">{getValuationLabel(countryCode)}</Text>
            </View>
            <Text className="text-lg font-semibold text-warm-700 mt-1">
              {formatPrice(officialValuation, countryCode)}
            </Text>
          </View>
        )}

        {/* Asking Price */}
        {askingPrice && (
          <View className="w-1/2 mb-4 pl-2">
            <View className="flex-row items-center">
              <Ionicons name="pricetag-outline" size={14} color="#F97316" />
              <Text className="text-xs text-warm-400 ml-1">Asking Price</Text>
            </View>
            <Text className="text-lg font-semibold text-orange-600 mt-1">
              {formatPrice(askingPrice, countryCode)}
            </Text>
          </View>
        )}

        {/* FMV Estimate */}
        {fmv && (
          <View className="w-1/2 mb-4 pr-2">
            <View className="flex-row items-center">
              <Ionicons name="people-outline" size={14} color="#F5A623" />
              <Text className="text-xs text-warm-400 ml-1">Crowd FMV</Text>
            </View>
            <Text className="text-xl font-bold text-primary-600 mt-1">
              {formatPrice(fmv, countryCode)}
            </Text>
            {fmvConfidence && (
              <Text className={`text-xs ${confidenceColors[fmvConfidence]}`}>
                {confidenceLabels[fmvConfidence]} ({guessCount} {guessCount === 1 ? 'guess' : 'guesses'})
              </Text>
            )}
          </View>
        )}

        {/* Guess count */}
        {!fmv && guessCount > 0 && (
          <View className="w-1/2 mb-4 pl-2">
            <View className="flex-row items-center">
              <Ionicons name="stats-chart-outline" size={14} color="#C7BFB3" />
              <Text className="text-xs text-warm-400 ml-1">Guesses</Text>
            </View>
            <Text className="text-lg font-semibold text-warm-700 mt-1">
              {guessCount}
            </Text>
          </View>
        )}
      </View>

      {/* Price comparison visualization */}
      <PriceComparisonBar
        officialValuation={officialValuation}
        askingPrice={askingPrice}
        fmv={fmv}
        countryCode={countryCode}
      />
    </View>
  );
}
