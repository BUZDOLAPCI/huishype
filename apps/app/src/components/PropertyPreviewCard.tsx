import { Pressable, Text, View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';

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
  thumbnailUrl?: string | null;
}

interface PropertyPreviewCardProps {
  property: PropertyPreviewData;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
  onPress?: () => void;
}

// Animated Pressable component for spring animation
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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

  // Activity pulsing indicator colors for hot properties
  const activityPulseColors = {
    hot: '#EF4444',
    warm: '#F97316',
    cold: '#D1D5DB',
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      entering={ZoomIn.springify().damping(15).stiffness(100)}
      className="bg-white rounded-xl shadow-lg p-3 w-[85%] max-w-[340px] self-center"
      testID="property-preview-card"
    >
      {/* Top section: Thumbnail + Address/Price */}
      <View className="flex-row mb-3">
        {/* Thumbnail image */}
        <View className="w-16 h-16 rounded-lg bg-gray-200 mr-3 overflow-hidden">
          {property.thumbnailUrl ? (
            <Image
              source={{ uri: property.thumbnailUrl }}
              className="w-full h-full"
              resizeMode="cover"
            />
          ) : (
            <View className="w-full h-full items-center justify-center">
              <Ionicons name="home-outline" size={24} color="#9CA3AF" />
            </View>
          )}
        </View>

        {/* Address and price info */}
        <View className="flex-1 justify-center">
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-base font-semibold text-gray-900 flex-1" numberOfLines={1}>
              {property.address}
            </Text>
            {/* Activity indicator */}
            <View className="flex-row items-center ml-2">
              <Animated.View
                entering={activityLevel === 'hot' ? FadeInDown.duration(300) : undefined}
                className={`w-2 h-2 rounded-full ${activityColors[activityLevel]} mr-1`}
                style={activityLevel === 'hot' ? {
                  shadowColor: activityPulseColors[activityLevel],
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.8,
                  shadowRadius: 4,
                } : undefined}
              />
              <Text className="text-xs text-gray-400">{activityLabels[activityLevel]}</Text>
            </View>
          </View>
          <Text className="text-sm text-gray-500" numberOfLines={1}>
            {property.city}
            {property.postalCode ? `, ${property.postalCode}` : ''}
          </Text>
          {/* Price display inline */}
          {displayPrice !== undefined && displayPrice !== null && (
            <View className="flex-row items-baseline mt-1">
              <Text className="text-lg font-bold text-primary-600">
                {'\u20AC'}{displayPrice.toLocaleString('nl-NL')}
              </Text>
              <Text className="text-xs text-gray-400 ml-1">
                {property.fmv ? 'FMV' : property.askingPrice ? 'Ask' : 'WOZ'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Quick action buttons - 44px min touch targets */}
      <View className="flex-row justify-around border-t border-gray-100 pt-2">
        <Pressable
          onPress={(e) => {
            e?.stopPropagation?.();
            onLike?.();
          }}
          className="flex-row items-center px-4 py-2 rounded-lg active:bg-gray-100"
          style={{ minHeight: 44, minWidth: 44 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="heart-outline" size={20} color="#6B7280" />
          <Text className="ml-1 text-sm text-gray-600">Like</Text>
        </Pressable>
        <Pressable
          onPress={(e) => {
            e?.stopPropagation?.();
            onComment?.();
          }}
          className="flex-row items-center px-4 py-2 rounded-lg active:bg-gray-100"
          style={{ minHeight: 44, minWidth: 44 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chatbubble-outline" size={20} color="#6B7280" />
          <Text className="ml-1 text-sm text-gray-600">Comment</Text>
        </Pressable>
        <Pressable
          onPress={(e) => {
            e?.stopPropagation?.();
            onGuess?.();
          }}
          className="flex-row items-center px-4 py-2 rounded-lg active:bg-gray-100"
          style={{ minHeight: 44, minWidth: 44 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="pricetag-outline" size={20} color="#6B7280" />
          <Text className="ml-1 text-sm text-gray-600">Guess</Text>
        </Pressable>
      </View>
    </AnimatedPressable>
  );
}
