/**
 * Catch-All Address Route
 *
 * Handles hierarchical URL structure:
 * - /{city}/ -> City View (heatmap)
 * - /{city}/{zipcode}/ -> Postcode View (neighborhood stats)
 * - /{city}/{zipcode}/{street}/{housenumber} -> Property Detail View
 *
 * Example: /eindhoven/5651hp/deflectiespoelstraat/16
 */

import { useEffect, useState } from 'react';
import { ScrollView, Text, View, Pressable, ActivityIndicator, Share } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { formatPrice } from '@huishype/shared';

import { PriceGuessSlider, CommentList } from '@/src/components';
import {
  resolveUrlParams,
  determineViewType,
  type ResolvedAddress,
  type AddressUrlParams,
  type AddressViewType,
} from '@/src/services/address-resolver';

// Mock comments data (same as property/[id].tsx for consistency)
const MOCK_COMMENTS = [
  {
    id: '1',
    author: 'Jan de Vries',
    authorKarma: 2500,
    content: 'This is way overpriced for this area. The WOZ value tells the real story.',
    likes: 45,
    createdAt: '2h ago',
    replies: [
      {
        id: '1-1',
        author: 'Maria Bakker',
        authorKarma: 85,
        content: '@JandeVries I disagree, the renovations add significant value',
        likes: 12,
        createdAt: '1h ago',
      },
    ],
  },
  {
    id: '2',
    author: 'Pieter Jansen',
    authorKarma: 125,
    content: 'Great location though. Close to everything you need.',
    likes: 23,
    createdAt: '4h ago',
  },
];

/**
 * Parse the catch-all address segments into structured params
 */
function parseAddressSegments(segments: string | string[]): AddressUrlParams {
  const parts = Array.isArray(segments) ? segments : [segments];

  return {
    city: parts[0] || undefined,
    zipcode: parts[1] || undefined,
    street: parts[2] || undefined,
    housenumber: parts[3] || undefined,
  };
}

/**
 * Loading skeleton for address resolution
 */
function AddressLoadingSkeleton() {
  return (
    <View className="flex-1 bg-white items-center justify-center">
      <ActivityIndicator size="large" color="#3B82F6" />
      <Text className="text-gray-500 mt-4">Resolving address...</Text>
    </View>
  );
}

/**
 * 404 - Address not found
 */
function AddressNotFound({ params }: { params: AddressUrlParams }) {
  const addressString = [params.city, params.zipcode, params.street, params.housenumber]
    .filter(Boolean)
    .join(' / ');

  return (
    <View className="flex-1 bg-white items-center justify-center px-8">
      <Ionicons name="search-outline" size={64} color="#D1D5DB" />
      <Text className="text-gray-900 text-xl font-semibold mt-4">Address not found</Text>
      <Text className="text-gray-500 text-center mt-2">
        We couldn't find an address matching:{'\n'}
        <Text className="font-medium">{addressString}</Text>
      </Text>
      <Pressable
        onPress={() => router.replace('/')}
        className="mt-6 bg-primary-600 px-6 py-3 rounded-xl"
      >
        <Text className="text-white font-semibold">Go to Map</Text>
      </Pressable>
    </View>
  );
}

/**
 * City View - Shows city heatmap (placeholder)
 */
function CityView({ city }: { city: string }) {
  const displayCity = city.charAt(0).toUpperCase() + city.slice(1);

  return (
    <View className="flex-1 bg-white">
      <View className="p-6">
        <Text className="text-3xl font-bold text-gray-900">{displayCity}</Text>
        <Text className="text-gray-500 mt-2">City Overview</Text>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        <Ionicons name="map-outline" size={64} color="#D1D5DB" />
        <Text className="text-gray-500 text-center mt-4">
          City heatmap view coming soon.{'\n'}
          Navigate to a specific address to see property details.
        </Text>
      </View>
    </View>
  );
}

/**
 * Postcode View - Shows neighborhood stats (placeholder)
 */
function PostcodeView({ city, zipcode }: { city: string; zipcode: string }) {
  const displayCity = city.charAt(0).toUpperCase() + city.slice(1);
  const displayZip = zipcode.toUpperCase();

  return (
    <View className="flex-1 bg-white">
      <View className="p-6">
        <Text className="text-3xl font-bold text-gray-900">{displayZip}</Text>
        <Text className="text-gray-500 mt-2">{displayCity}</Text>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        <Ionicons name="stats-chart-outline" size={64} color="#D1D5DB" />
        <Text className="text-gray-500 text-center mt-4">
          Neighborhood statistics coming soon.{'\n'}
          Navigate to a specific address to see property details.
        </Text>
      </View>
    </View>
  );
}

/**
 * Property Detail View - Full property page with resolved address
 */
function PropertyDetailView({ address }: { address: ResolvedAddress }) {
  const handleLikeComment = (commentId: string) => {
    console.log('Liked comment:', commentId);
  };

  const handleReplyComment = (commentId: string) => {
    console.log('Reply to comment:', commentId);
  };

  const handleSubmitGuess = (price: number) => {
    console.log('Submitted guess for property', address.bagId, ':', price);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this property: ${address.formattedAddress}`,
        title: `${address.details.street} ${address.details.number} - HuisHype`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const handleSave = () => {
    console.log('Save property:', address.bagId);
  };

  const handleLike = () => {
    console.log('Like property:', address.bagId);
  };

  // Format the address title like the reference: "Street Number" with "Zip City" below
  const streetWithNumber = `${address.details.street} ${address.details.number}`;
  // Format zip with space: "5651HP" -> "5651 HP" per reference styling
  const formattedZip = address.details.zip.length === 6
    ? `${address.details.zip.slice(0, 4)} ${address.details.zip.slice(4).toUpperCase()}`
    : address.details.zip.toUpperCase();
  const zipWithCity = `${formattedZip} ${address.details.city}`;

  return (
    <ScrollView className="flex-1 bg-white">
      {/* Property header image */}
      <View className="bg-gray-200 h-56 items-center justify-center">
        <Ionicons name="image-outline" size={48} color="#9CA3AF" />
        <Text className="text-gray-400 mt-2">Property Photo</Text>
      </View>

      <View className="p-4">
        {/* Address header - styled like reference (address-styling.png) */}
        <View className="mb-4">
          <Text className="text-2xl font-bold text-gray-900" testID="address-title">
            {streetWithNumber}
          </Text>
          <Text className="text-gray-500 mt-1" testID="address-subtitle">
            {zipWithCity}
          </Text>
        </View>

        {/* BAG ID badge */}
        <View className="flex-row flex-wrap gap-2 mb-4">
          <View className="flex-row items-center bg-gray-100 px-3 py-1.5 rounded-full">
            <Ionicons name="barcode-outline" size={14} color="#6B7280" />
            <Text className="text-sm text-gray-600 ml-1" numberOfLines={1}>
              {address.bagId}
            </Text>
          </View>
        </View>

        {/* Quick stats */}
        <View className="flex-row flex-wrap mb-6 bg-gray-50 rounded-xl p-4">
          <View className="w-1/2 mb-3">
            <Text className="text-xs text-gray-400">WOZ Value</Text>
            <Text className="text-lg font-semibold text-gray-700">--</Text>
          </View>
          <View className="w-1/2 mb-3">
            <Text className="text-xs text-gray-400">Asking Price</Text>
            <Text className="text-lg font-semibold text-gray-700">--</Text>
          </View>
          <View className="w-1/2">
            <Text className="text-xs text-gray-400">Crowd FMV</Text>
            <Text className="text-lg font-bold text-primary-600">--</Text>
          </View>
          <View className="w-1/2">
            <Text className="text-xs text-gray-400">Guesses</Text>
            <Text className="text-lg font-semibold text-gray-700">0</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <View className="flex-row justify-around mb-6 py-3 border-y border-gray-100">
          <Pressable onPress={handleSave} className="flex-row items-center px-4 py-2">
            <Ionicons name="bookmark-outline" size={22} color="#6B7280" />
            <Text className="ml-2 text-gray-600">Save</Text>
          </Pressable>
          <Pressable onPress={handleShare} className="flex-row items-center px-4 py-2">
            <Ionicons name="share-outline" size={22} color="#6B7280" />
            <Text className="ml-2 text-gray-600">Share</Text>
          </Pressable>
          <Pressable onPress={handleLike} className="flex-row items-center px-4 py-2">
            <Ionicons name="heart-outline" size={22} color="#6B7280" />
            <Text className="ml-2 text-gray-600">Like</Text>
          </Pressable>
        </View>

        {/* External listing link - placeholder */}
        <View className="mb-6">
          <Pressable disabled className="flex-row items-center justify-center bg-gray-200 py-3 rounded-xl">
            <Ionicons name="link-outline" size={16} color="#9CA3AF" />
            <Text className="text-gray-400 font-semibold ml-2">No listing available</Text>
          </Pressable>
        </View>

        {/* Price guess section */}
        <View className="mb-6">
          <PriceGuessSlider
            propertyId={address.bagId}
            wozValue={undefined}
            onGuessSubmit={handleSubmitGuess}
          />
        </View>

        {/* Property Details */}
        <View className="border-t border-gray-100 pt-4 mb-6">
          <View className="flex-row items-center mb-3">
            <Ionicons name="information-circle" size={20} color="#3B82F6" />
            <Text className="text-lg font-semibold text-gray-900 ml-2">Property Details</Text>
          </View>
          <View className="bg-gray-50 rounded-xl p-3">
            <View className="flex-row items-center py-2 border-b border-gray-100">
              <View className="w-8 items-center">
                <Ionicons name="location-outline" size={16} color="#6B7280" />
              </View>
              <Text className="flex-1 text-gray-500 text-sm">Full Address</Text>
              <Text className="text-gray-900 text-sm font-medium" numberOfLines={1}>
                {address.formattedAddress}
              </Text>
            </View>
            <View className="flex-row items-center py-2 border-b border-gray-100">
              <View className="w-8 items-center">
                <Ionicons name="navigate-outline" size={16} color="#6B7280" />
              </View>
              <Text className="flex-1 text-gray-500 text-sm">Coordinates</Text>
              <Text className="text-gray-900 text-sm font-medium">
                {address.lat.toFixed(6)}, {address.lon.toFixed(6)}
              </Text>
            </View>
            <View className="flex-row items-center py-2">
              <View className="w-8 items-center">
                <Ionicons name="barcode-outline" size={16} color="#6B7280" />
              </View>
              <Text className="flex-1 text-gray-500 text-sm">BAG ID</Text>
              <Text className="text-gray-900 text-sm font-medium" numberOfLines={1}>
                {address.bagId}
              </Text>
            </View>
          </View>
        </View>

        {/* Comments section */}
        <View className="border-t border-gray-100 pt-4">
          <View className="flex-row items-center mb-4">
            <Ionicons name="chatbubbles" size={20} color="#3B82F6" />
            <Text className="text-lg font-semibold text-gray-900 ml-2">
              Comments ({MOCK_COMMENTS.length})
            </Text>
          </View>
          <CommentList
            comments={MOCK_COMMENTS}
            onLike={handleLikeComment}
            onReply={handleReplyComment}
          />
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * Main Address Route Component
 */
export default function AddressScreen() {
  const params = useLocalSearchParams<{ address: string | string[] }>();
  const addressParams = parseAddressSegments(params.address || []);
  const viewType = determineViewType(addressParams);

  // Resolve address using PDOK Locatieserver
  const {
    data: resolvedAddress,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['address', addressParams],
    queryFn: () => resolveUrlParams(addressParams),
    enabled: viewType === 'property',
    retry: 1,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Determine header title
  const getHeaderTitle = (): string => {
    if (viewType === 'city') return addressParams.city || 'City';
    if (viewType === 'postcode') return addressParams.zipcode?.toUpperCase() || 'Area';
    if (resolvedAddress) {
      return `${resolvedAddress.details.street} ${resolvedAddress.details.number}`;
    }
    return 'Property';
  };

  // Render appropriate view based on URL depth
  const renderContent = () => {
    switch (viewType) {
      case 'city':
        return <CityView city={addressParams.city!} />;

      case 'postcode':
        return <PostcodeView city={addressParams.city!} zipcode={addressParams.zipcode!} />;

      case 'property':
        if (isLoading) {
          return <AddressLoadingSkeleton />;
        }
        if (error || !resolvedAddress) {
          return <AddressNotFound params={addressParams} />;
        }
        return <PropertyDetailView address={resolvedAddress} />;

      default:
        return <AddressNotFound params={addressParams} />;
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: getHeaderTitle(),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="p-2">
              <Ionicons name="close" size={24} color="#666" />
            </Pressable>
          ),
          headerRight:
            viewType === 'property' && resolvedAddress
              ? () => (
                  <Pressable
                    onPress={async () => {
                      try {
                        await Share.share({
                          message: `Check out this property: ${resolvedAddress.formattedAddress}`,
                        });
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                    className="p-2"
                  >
                    <Ionicons name="share-outline" size={24} color="#666" />
                  </Pressable>
                )
              : undefined,
        }}
      />
      {renderContent()}
    </>
  );
}
