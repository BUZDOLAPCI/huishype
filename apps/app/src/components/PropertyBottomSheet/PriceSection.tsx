import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SectionProps } from './types';

function formatPrice(price: number): string {
  return `\u20AC${price.toLocaleString('nl-NL')}`;
}

function PriceComparisonBar({
  wozValue,
  askingPrice,
  fmv
}: {
  wozValue: number | null;
  askingPrice?: number;
  fmv?: number;
}) {
  if (!wozValue) return null;

  const prices = [
    { label: 'WOZ', value: wozValue, color: 'bg-gray-400' },
    askingPrice ? { label: 'Asking', value: askingPrice, color: 'bg-orange-500' } : null,
    fmv ? { label: 'FMV', value: fmv, color: 'bg-primary-500' } : null,
  ].filter(Boolean) as { label: string; value: number; color: string }[];

  if (prices.length < 2) return null;

  const minPrice = Math.min(...prices.map(p => p.value));
  const maxPrice = Math.max(...prices.map(p => p.value));
  const range = maxPrice - minPrice;

  return (
    <View className="mt-4">
      <Text className="text-xs text-gray-400 mb-2">Price Comparison</Text>
      <View className="h-2 bg-gray-100 rounded-full relative">
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
        <Text className="text-xs text-gray-400">{formatPrice(minPrice)}</Text>
        <Text className="text-xs text-gray-400">{formatPrice(maxPrice)}</Text>
      </View>
      {/* Legend */}
      <View className="flex-row flex-wrap gap-3 mt-2">
        {prices.map((price) => (
          <View key={price.label} className="flex-row items-center">
            <View className={`w-2 h-2 ${price.color} rounded-full mr-1`} />
            <Text className="text-xs text-gray-500">{price.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function PriceSection({ property }: SectionProps) {
  const { wozValue, askingPrice, fmv: fmvData, guessCount } = property;
  const fmv = fmvData?.fmv ?? undefined;
  const fmvConfidence = fmvData?.confidence;

  const confidenceLabels: Record<string, string> = {
    none: 'No data yet',
    low: 'Low confidence',
    medium: 'Medium confidence',
    high: 'High confidence',
  };

  const confidenceColors: Record<string, string> = {
    none: 'text-gray-400',
    low: 'text-red-500',
    medium: 'text-yellow-600',
    high: 'text-green-500',
  };

  return (
    <View className="px-4 py-4 border-t border-gray-100">
      <View className="flex-row flex-wrap">
        {/* WOZ Value */}
        {wozValue && (
          <View className="w-1/2 mb-4 pr-2">
            <View className="flex-row items-center">
              <Ionicons name="home-outline" size={14} color="#9CA3AF" />
              <Text className="text-xs text-gray-400 ml-1">WOZ Value</Text>
            </View>
            <Text className="text-lg font-semibold text-gray-700 mt-1">
              {formatPrice(wozValue)}
            </Text>
          </View>
        )}

        {/* Asking Price */}
        {askingPrice && (
          <View className="w-1/2 mb-4 pl-2">
            <View className="flex-row items-center">
              <Ionicons name="pricetag-outline" size={14} color="#F97316" />
              <Text className="text-xs text-gray-400 ml-1">Asking Price</Text>
            </View>
            <Text className="text-lg font-semibold text-orange-600 mt-1">
              {formatPrice(askingPrice)}
            </Text>
          </View>
        )}

        {/* FMV Estimate */}
        {fmv && (
          <View className="w-1/2 mb-4 pr-2">
            <View className="flex-row items-center">
              <Ionicons name="people-outline" size={14} color="#3B82F6" />
              <Text className="text-xs text-gray-400 ml-1">Crowd FMV</Text>
            </View>
            <Text className="text-xl font-bold text-primary-600 mt-1">
              {formatPrice(fmv)}
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
              <Ionicons name="stats-chart-outline" size={14} color="#9CA3AF" />
              <Text className="text-xs text-gray-400 ml-1">Guesses</Text>
            </View>
            <Text className="text-lg font-semibold text-gray-700 mt-1">
              {guessCount}
            </Text>
          </View>
        )}
      </View>

      {/* Price comparison visualization */}
      <PriceComparisonBar
        wozValue={wozValue}
        askingPrice={askingPrice}
        fmv={fmv}
      />
    </View>
  );
}
