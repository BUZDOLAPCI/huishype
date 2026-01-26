import { Image, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SectionProps } from './types';

// Placeholder image for properties without photos
const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/400x300/E5E7EB/9CA3AF?text=No+Photo';

export function PropertyHeader({ property }: SectionProps) {
  const photos = property.photos?.length ? property.photos : [PLACEHOLDER_IMAGE];

  const activityColors = {
    hot: 'bg-red-500',
    warm: 'bg-orange-400',
    cold: 'bg-gray-300',
  };

  return (
    <View>
      {/* Photo Carousel */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        className="h-48"
      >
        {photos.map((photo, index) => (
          <View key={index} className="w-screen h-48 px-4">
            <Image
              source={{ uri: photo }}
              className="w-full h-full rounded-xl bg-gray-200"
              resizeMode="cover"
            />
          </View>
        ))}
      </ScrollView>

      {/* Photo count indicator */}
      {photos.length > 1 && (
        <View className="absolute top-2 right-6 bg-black/50 px-2 py-1 rounded-full">
          <Text className="text-white text-xs">{photos.length} photos</Text>
        </View>
      )}

      {/* Address and info */}
      <View className="px-4 pt-4">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <Text className="text-xl font-bold text-gray-900" numberOfLines={2}>
              {property.address}
            </Text>
            <Text className="text-base text-gray-500 mt-1">
              {property.city}
              {property.postalCode ? `, ${property.postalCode}` : ''}
            </Text>
          </View>

          {/* Activity indicator */}
          <View className="flex-row items-center bg-gray-50 px-3 py-1.5 rounded-full">
            <View className={`w-2 h-2 rounded-full ${activityColors[property.activityLevel]} mr-1.5`} />
            <Text className="text-xs text-gray-600 capitalize">{property.activityLevel}</Text>
          </View>
        </View>

        {/* Property badges */}
        <View className="flex-row flex-wrap gap-2 mt-3">
          {property.bouwjaar && (
            <View className="flex-row items-center bg-gray-100 px-3 py-1.5 rounded-full">
              <Ionicons name="calendar-outline" size={14} color="#6B7280" />
              <Text className="text-sm text-gray-600 ml-1">Built {property.bouwjaar}</Text>
            </View>
          )}
          {property.oppervlakte && (
            <View className="flex-row items-center bg-gray-100 px-3 py-1.5 rounded-full">
              <Ionicons name="resize-outline" size={14} color="#6B7280" />
              <Text className="text-sm text-gray-600 ml-1">{property.oppervlakte} m{'\u00B2'}</Text>
            </View>
          )}
          {property.viewCount > 0 && (
            <View className="flex-row items-center bg-gray-100 px-3 py-1.5 rounded-full">
              <Ionicons name="eye-outline" size={14} color="#6B7280" />
              <Text className="text-sm text-gray-600 ml-1">{property.viewCount} views</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
