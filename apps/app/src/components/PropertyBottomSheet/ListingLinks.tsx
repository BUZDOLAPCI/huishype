import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPropertyPrice } from '@huishype/shared';
import type { ListingData } from '../../hooks/useListings';

interface ListingLinksProps {
  listings: ListingData[];
  onLinkPress?: (source: string) => void;
  onAddListing?: () => void;
}

export function ListingLinks({ listings, onLinkPress, onAddListing }: ListingLinksProps) {
  const hasListings = listings && listings.length > 0;

  const handleOpenLink = async (url: string, source: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        onLinkPress?.(source);
      }
    } catch (error) {
      console.error('Error opening link:', error);
    }
  };

  const getSourceInfo = (source: string) => {
    switch (source) {
      case 'funda':
        return { name: 'Funda', color: '#F97316', icon: 'home' as const };
      case 'pararius':
        return { name: 'Pararius', color: '#DE911D', icon: 'business' as const };
      default:
        return { name: 'Listing', color: '#9C958A', icon: 'link' as const };
    }
  };

  const formatPrice = (price: number | null, priceType: string | null) => {
    if (price == null) return null;
    const suffix = priceType === 'rent' ? '/mo' : '';
    return `${formatPropertyPrice(price)}${suffix}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sold':
        return { text: 'Sold', color: '#EF4444' };
      case 'rented':
        return { text: 'Rented', color: '#F59E0B' };
      case 'withdrawn':
        return { text: 'Withdrawn', color: '#9C958A' };
      default:
        return null;
    }
  };

  return (
    <View className="px-4 py-4 border-t border-warm-100">
      <View className="flex-row items-center mb-3">
        <Ionicons name="link" size={20} color="#F5A623" />
        <Text className="text-lg font-semibold text-warm-900 ml-2">
          Listings{hasListings ? ` (${listings.length})` : ''}
        </Text>
      </View>

      {hasListings &&
        listings.map((listing) => {
          const sourceInfo = getSourceInfo(listing.sourceName);
          const price = formatPrice(listing.askingPrice, listing.priceType);
          const statusBadge = getStatusBadge(listing.status);

          return (
            <Pressable
              key={listing.id}
              onPress={() => handleOpenLink(listing.sourceUrl, listing.sourceName)}
              className="flex-row items-center p-3 mb-2 rounded-xl bg-warm-50 active:bg-warm-100"
            >
              <View
                style={{ backgroundColor: sourceInfo.color }}
                className="w-10 h-10 rounded-lg items-center justify-center"
              >
                <Ionicons name={sourceInfo.icon} size={20} color="white" />
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-sm font-semibold text-warm-900">
                  {sourceInfo.name}
                </Text>
                {price && (
                  <Text className="text-sm text-warm-600">{price}</Text>
                )}
              </View>
              {statusBadge && (
                <View
                  style={{ backgroundColor: statusBadge.color }}
                  className="px-2 py-1 rounded-full mr-2"
                >
                  <Text className="text-xs text-white font-medium">
                    {statusBadge.text}
                  </Text>
                </View>
              )}
              <Ionicons name="open-outline" size={16} color="#C7BFB3" />
            </Pressable>
          );
        })}

      {onAddListing && (
        <Pressable
          onPress={onAddListing}
          className="flex-row items-center justify-center p-3 rounded-xl border border-dashed border-warm-300 active:bg-warm-50"
        >
          <Ionicons name="add-circle-outline" size={20} color="#9C958A" />
          <Text className="text-sm text-warm-500 font-medium ml-1.5">Add listing</Text>
        </Pressable>
      )}
    </View>
  );
}
