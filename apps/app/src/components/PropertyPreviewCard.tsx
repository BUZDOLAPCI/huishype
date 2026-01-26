import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface PropertyPreviewData {
  id: string;
  address: string;
  city: string;
  postalCode?: string | null;
  wozValue?: number | null;
  askingPrice?: number;
  fmv?: number;
  activityLevel?: 'hot' | 'warm' | 'cold';
  activityScore?: number;
}

interface PropertyPreviewCardProps {
  property: PropertyPreviewData;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
  onPress?: () => void;
}

export function PropertyPreviewCard({
  property,
  onLike,
  onComment,
  onGuess,
  onPress,
}: PropertyPreviewCardProps) {
  const displayPrice = property.fmv ?? property.askingPrice ?? property.wozValue;
  const activityLevel = property.activityLevel ?? 'cold';

  const activityColors = {
    hot: 'bg-red-500',
    warm: 'bg-orange-400',
    cold: 'bg-gray-300',
  };

  const activityLabels = {
    hot: 'Hot',
    warm: 'Active',
    cold: 'Quiet',
  };

  return (
    <Pressable
      onPress={onPress}
      className="bg-white rounded-xl shadow-lg p-4 min-w-[280px] max-w-[320px]"
      testID="property-preview-card"
    >
      {/* Header with address and activity indicator */}
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 mr-2">
          <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
            {property.address}
          </Text>
          <Text className="text-sm text-gray-500">
            {property.city}
            {property.postalCode ? `, ${property.postalCode}` : ''}
          </Text>
        </View>
        <View className="flex-row items-center">
          <View className={`w-2 h-2 rounded-full ${activityColors[activityLevel]} mr-1`} />
          <Text className="text-xs text-gray-400">{activityLabels[activityLevel]}</Text>
        </View>
      </View>

      {/* Price display */}
      {displayPrice !== undefined && displayPrice !== null && (
        <View className="mb-3">
          <Text className="text-xs text-gray-400 uppercase tracking-wide">
            {property.fmv ? 'Crowd FMV' : property.askingPrice ? 'Asking Price' : 'WOZ Value'}
          </Text>
          <Text className="text-xl font-bold text-primary-600">
            {'\u20AC'}{displayPrice.toLocaleString('nl-NL')}
          </Text>
        </View>
      )}

      {/* Quick action buttons */}
      <View className="flex-row justify-around border-t border-gray-100 pt-3 mt-1">
        <Pressable
          onPress={onLike}
          className="flex-row items-center px-3 py-2 rounded-lg active:bg-gray-100"
        >
          <Ionicons name="heart-outline" size={20} color="#6B7280" />
          <Text className="ml-1 text-sm text-gray-600">Like</Text>
        </Pressable>
        <Pressable
          onPress={onComment}
          className="flex-row items-center px-3 py-2 rounded-lg active:bg-gray-100"
        >
          <Ionicons name="chatbubble-outline" size={20} color="#6B7280" />
          <Text className="ml-1 text-sm text-gray-600">Comment</Text>
        </Pressable>
        <Pressable
          onPress={onGuess}
          className="flex-row items-center px-3 py-2 rounded-lg active:bg-gray-100"
        >
          <Ionicons name="pricetag-outline" size={20} color="#6B7280" />
          <Text className="ml-1 text-sm text-gray-600">Guess</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}
