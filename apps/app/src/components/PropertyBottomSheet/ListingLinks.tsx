import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SectionProps } from './types';

interface ListingLinksProps extends SectionProps {
  onLinkPress?: (source: string) => void;
}

export function ListingLinks({ property, onLinkPress }: ListingLinksProps) {
  if (!property.listingUrl) return null;

  const handleOpenLink = async () => {
    if (property.listingUrl) {
      try {
        const canOpen = await Linking.canOpenURL(property.listingUrl);
        if (canOpen) {
          await Linking.openURL(property.listingUrl);
          onLinkPress?.(property.listingSource ?? 'other');
        }
      } catch (error) {
        console.error('Error opening link:', error);
      }
    }
  };

  const getSourceInfo = (source?: string) => {
    switch (source) {
      case 'funda':
        return {
          name: 'Funda',
          color: 'bg-orange-500',
          icon: 'home' as const,
        };
      case 'pararius':
        return {
          name: 'Pararius',
          color: 'bg-blue-600',
          icon: 'business' as const,
        };
      default:
        return {
          name: 'View Listing',
          color: 'bg-gray-600',
          icon: 'link' as const,
        };
    }
  };

  const sourceInfo = getSourceInfo(property.listingSource);

  return (
    <View className="px-4 py-4 border-t border-gray-100">
      <View className="flex-row items-center mb-3">
        <Ionicons name="link" size={20} color="#3B82F6" />
        <Text className="text-lg font-semibold text-gray-900 ml-2">Listing</Text>
      </View>

      <Pressable
        onPress={handleOpenLink}
        className={`flex-row items-center justify-center py-4 rounded-xl ${sourceInfo.color} active:opacity-80`}
      >
        <Ionicons name={sourceInfo.icon} size={20} color="white" />
        <Text className="text-white font-semibold ml-2">
          View on {sourceInfo.name}
        </Text>
        <Ionicons name="open-outline" size={16} color="white" style={{ marginLeft: 8 }} />
      </Pressable>

      <Text className="text-xs text-gray-400 text-center mt-2">
        Opens in external browser
      </Text>
    </View>
  );
}
