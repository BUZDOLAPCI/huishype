import { Pressable, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SectionProps } from './types';

interface QuickActionsProps extends SectionProps {
  onSave?: () => void;
  onShare?: () => void;
  onLike?: () => void;
}

export function QuickActions({
  property,
  onSave,
  onShare,
  onLike,
}: QuickActionsProps) {
  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this property: ${property.address}, ${property.city}`,
        title: `${property.address} - HuisHype`,
      });
      onShare?.();
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  return (
    <View className="px-4 py-3 border-t border-gray-100">
      <View className="flex-row justify-around">
        {/* Save button */}
        <Pressable
          onPress={onSave}
          className="flex-1 flex-row items-center justify-center py-3 mx-1 bg-gray-50 rounded-xl active:bg-gray-100"
          testID="quick-action-save"
        >
          <Ionicons
            name={property.isSaved ? 'bookmark' : 'bookmark-outline'}
            size={22}
            color={property.isSaved ? '#3B82F6' : '#6B7280'}
          />
          <Text className={`ml-2 font-medium ${property.isSaved ? 'text-primary-600' : 'text-gray-600'}`}>
            {property.isSaved ? 'Saved' : 'Save'}
          </Text>
        </Pressable>

        {/* Share button */}
        <Pressable
          onPress={handleShare}
          className="flex-1 flex-row items-center justify-center py-3 mx-1 bg-gray-50 rounded-xl active:bg-gray-100"
        >
          <Ionicons name="share-outline" size={22} color="#6B7280" />
          <Text className="ml-2 font-medium text-gray-600">Share</Text>
        </Pressable>

        {/* Like button */}
        <Pressable
          onPress={onLike}
          className="flex-1 flex-row items-center justify-center py-3 mx-1 bg-gray-50 rounded-xl active:bg-gray-100"
        >
          <Ionicons
            name={property.isLiked ? 'heart' : 'heart-outline'}
            size={22}
            color={property.isLiked ? '#EF4444' : '#6B7280'}
          />
          <Text className={`ml-2 font-medium ${property.isLiked ? 'text-red-500' : 'text-gray-600'}`}>
            {property.isLiked ? 'Liked' : 'Like'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
