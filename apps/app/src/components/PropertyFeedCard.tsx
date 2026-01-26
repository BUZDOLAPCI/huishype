import { Image, Pressable, Text, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

interface PropertyFeedCardProps {
  id: string;
  address: string;
  city: string;
  postalCode?: string | null;
  photoUrl?: string;
  wozValue?: number | null;
  askingPrice?: number;
  fmvValue?: number;
  activityLevel?: 'hot' | 'warm' | 'cold';
  commentCount?: number;
  guessCount?: number;
  viewCount?: number;
  bouwjaar?: number | null;
  oppervlakte?: number | null;
  onPress?: () => void;
}

/**
 * Format price in Dutch locale with euro symbol
 */
function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return `\u20AC${value.toLocaleString('nl-NL')}`;
}

/**
 * PropertyFeedCard - Social-style property card for the feed
 */
export function PropertyFeedCard({
  address,
  city,
  postalCode,
  photoUrl,
  wozValue,
  askingPrice,
  fmvValue,
  activityLevel = 'cold',
  commentCount = 0,
  guessCount = 0,
  viewCount = 0,
  bouwjaar,
  oppervlakte,
  onPress,
}: PropertyFeedCardProps) {
  const activityColors = {
    hot: 'bg-red-500',
    warm: 'bg-orange-400',
    cold: 'bg-gray-300',
  };

  const activityLabels = {
    hot: 'Trending',
    warm: 'Active',
    cold: '',
  };

  // Calculate price difference if both asking and FMV exist
  const priceDifference =
    askingPrice && fmvValue ? ((askingPrice - fmvValue) / fmvValue) * 100 : null;

  return (
    <Pressable
      onPress={onPress}
      className="bg-white rounded-xl shadow-sm mb-4 mx-4 overflow-hidden active:opacity-90"
      testID="property-feed-card"
    >
      {/* Image section */}
      <View className="relative">
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            className="w-full h-48"
            resizeMode="cover"
            testID="property-image"
          />
        ) : (
          <View className="w-full h-48 bg-gray-200 items-center justify-center">
            <FontAwesome name="home" size={48} color="#9CA3AF" />
            <Text className="text-gray-400 mt-2">No image available</Text>
          </View>
        )}

        {/* Activity badge */}
        {activityLevel !== 'cold' && (
          <View
            className={`absolute top-3 left-3 px-3 py-1 rounded-full ${activityColors[activityLevel]}`}
          >
            <Text className="text-white text-xs font-semibold">
              {activityLabels[activityLevel]}
            </Text>
          </View>
        )}

        {/* View count overlay */}
        <View className="absolute bottom-3 right-3 bg-black/60 px-2 py-1 rounded-md flex-row items-center">
          <FontAwesome name="eye" size={12} color="white" />
          <Text className="text-white text-xs ml-1">{viewCount}</Text>
        </View>
      </View>

      {/* Content section */}
      <View className="p-4">
        {/* Address and activity indicator */}
        <View className="flex-row items-start justify-between mb-1">
          <View className="flex-1 mr-2">
            <Text
              className="text-lg font-semibold text-gray-900"
              numberOfLines={1}
            >
              {address}
            </Text>
            <Text className="text-sm text-gray-500">
              {city}
              {postalCode ? `, ${postalCode}` : ''}
            </Text>
          </View>
          <View
            className={`w-3 h-3 rounded-full mt-2 ${activityColors[activityLevel]}`}
          />
        </View>

        {/* Property details badges */}
        {(bouwjaar || oppervlakte) && (
          <View className="flex-row mt-2 mb-3">
            {bouwjaar && (
              <View className="bg-gray-100 px-2 py-1 rounded-md mr-2">
                <Text className="text-xs text-gray-600">
                  <FontAwesome name="calendar" size={10} color="#6B7280" />{' '}
                  {bouwjaar}
                </Text>
              </View>
            )}
            {oppervlakte && (
              <View className="bg-gray-100 px-2 py-1 rounded-md">
                <Text className="text-xs text-gray-600">
                  {oppervlakte} m{'\u00B2'}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Price section */}
        <View className="flex-row justify-between items-end mt-2 mb-3">
          <View className="flex-1">
            {/* WOZ Value */}
            {wozValue && (
              <View className="mb-1">
                <Text className="text-xs text-gray-400">WOZ Value</Text>
                <Text className="text-base font-medium text-gray-600">
                  {formatPrice(wozValue)}
                </Text>
              </View>
            )}

            {/* Asking Price (if available) */}
            {askingPrice && (
              <View className="mb-1">
                <Text className="text-xs text-gray-400">Asking Price</Text>
                <Text className="text-base font-semibold text-gray-800">
                  {formatPrice(askingPrice)}
                </Text>
              </View>
            )}
          </View>

          {/* FMV (primary price display) */}
          <View className="items-end">
            {fmvValue ? (
              <>
                <Text className="text-xs text-gray-400">Crowd FMV</Text>
                <Text className="text-xl font-bold text-primary-600">
                  {formatPrice(fmvValue)}
                </Text>
                {priceDifference !== null && (
                  <Text
                    className={`text-xs font-medium ${
                      priceDifference > 5
                        ? 'text-red-500'
                        : priceDifference < -5
                          ? 'text-green-500'
                          : 'text-gray-500'
                    }`}
                  >
                    {priceDifference > 0 ? '+' : ''}
                    {priceDifference.toFixed(1)}% vs asking
                  </Text>
                )}
              </>
            ) : wozValue ? (
              <>
                <Text className="text-xs text-gray-400">Est. Value</Text>
                <Text className="text-xl font-bold text-primary-600">
                  {formatPrice(wozValue)}
                </Text>
              </>
            ) : null}
          </View>
        </View>

        {/* Activity stats */}
        <View className="flex-row justify-between pt-3 border-t border-gray-100">
          <View className="flex-row items-center">
            <FontAwesome name="comments-o" size={14} color="#6B7280" />
            <Text className="text-sm text-gray-500 ml-1">{commentCount}</Text>
          </View>
          <View className="flex-row items-center">
            <FontAwesome name="bar-chart" size={14} color="#6B7280" />
            <Text className="text-sm text-gray-500 ml-1">
              {guessCount} guesses
            </Text>
          </View>
          <View className="flex-row items-center">
            <FontAwesome name="eye" size={14} color="#6B7280" />
            <Text className="text-sm text-gray-500 ml-1">{viewCount}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
