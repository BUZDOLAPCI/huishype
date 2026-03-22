import { Image, Text, View } from 'react-native';
import { formatPropertyPrice, type CountryCode } from '@huishype/shared';

interface PropertyCardProps {
  address: string;
  city: string;
  imageUrl?: string;
  fmv?: number;
  askingPrice?: number;
  activityLevel?: 'hot' | 'warm' | 'cold';
  countryCode?: CountryCode;
}

export function PropertyCard({
  address,
  city,
  imageUrl,
  fmv,
  askingPrice,
  activityLevel = 'cold',
  countryCode,
}: PropertyCardProps) {
  const activityColors = {
    hot: 'bg-red-500',
    warm: 'bg-orange-400',
    cold: 'bg-warm-300',
  };

  return (
    <View className="bg-surface-card rounded-xl shadow-md overflow-hidden m-2">
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          className="w-full h-40"
          resizeMode="cover"
        />
      ) : (
        <View className="w-full h-40 bg-warm-200 items-center justify-center">
          <Text className="text-warm-400">No image available</Text>
        </View>
      )}
      <View className="p-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-lg font-semibold text-warm-900" numberOfLines={1}>
            {address}
          </Text>
          <View
            className={`w-3 h-3 rounded-full ${activityColors[activityLevel]}`}
          />
        </View>
        <Text className="text-sm text-warm-500 mb-3">{city}</Text>
        <View className="flex-row justify-between">
          {fmv !== undefined && (
            <View>
              <Text className="text-xs text-warm-400">Crowd FMV</Text>
              <Text className="text-base font-bold text-primary-600">
                {formatPropertyPrice(fmv, countryCode)}
              </Text>
            </View>
          )}
          {askingPrice !== undefined && (
            <View>
              <Text className="text-xs text-warm-400">Asking Price</Text>
              <Text className="text-base font-semibold text-warm-700">
                {formatPropertyPrice(askingPrice, countryCode)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
