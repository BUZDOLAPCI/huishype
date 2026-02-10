import { ScrollView, Text, View, Pressable, ActivityIndicator, Linking, Share } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatPrice } from '@huishype/shared';

import { PriceGuessSlider, CommentList } from '@/src/components';
import { useProperty } from '@/src/hooks/useProperties';

// Mock comments data - will be replaced with API data in Task #5
// Uses karma levels matching the expectation requirements:
// - Newbie (0-10): Gray
// - Regular (11-50): Green
// - Trusted (51-100): Blue
// - Expert (101-500): Purple
// - Legend (500+): Amber/gold
const MOCK_COMMENTS = [
  {
    id: '1',
    author: 'Jan de Vries',
    authorKarma: 2500, // Legend - gold badge
    content: 'This is way overpriced for this area. The WOZ value tells the real story.',
    likes: 45,
    createdAt: '2h ago',
    replies: [
      {
        id: '1-1',
        author: 'Maria Bakker',
        authorKarma: 85, // Trusted - blue badge
        content: '@JandeVries I disagree, the renovations add significant value',
        likes: 12,
        createdAt: '1h ago',
      },
      {
        id: '1-2',
        author: 'Sophie Meijer',
        authorKarma: 5200, // Legend - gold badge
        content: '@MariaBakker Agreed, but the location premium is also justified here.',
        likes: 8,
        createdAt: '45m ago',
      },
    ],
  },
  {
    id: '2',
    author: 'Pieter Jansen',
    authorKarma: 125, // Expert - purple badge
    content: 'Great location though. Close to everything you need.',
    likes: 23,
    createdAt: '4h ago',
  },
  {
    id: '3',
    author: 'Lisa van Berg',
    authorKarma: 35, // Regular - green badge
    content: 'Does anyone know if the basement has flooding issues? Seen some reports for this area.',
    likes: 7,
    createdAt: '6h ago',
  },
  {
    id: '4',
    author: 'New User',
    authorKarma: 5, // Newbie - gray badge
    content: 'Just moved to this neighborhood. It is a great area for families!',
    likes: 3,
    createdAt: '8h ago',
  },
];

function PropertyDetailSkeleton() {
  return (
    <View className="flex-1 bg-white items-center justify-center">
      <ActivityIndicator size="large" color="#3B82F6" />
      <Text className="text-gray-500 mt-4">Loading property...</Text>
    </View>
  );
}

function PropertyNotFound() {
  return (
    <View className="flex-1 bg-white items-center justify-center px-8">
      <Ionicons name="home-outline" size={64} color="#D1D5DB" />
      <Text className="text-gray-900 text-xl font-semibold mt-4">Property not found</Text>
      <Text className="text-gray-500 text-center mt-2">
        The property you're looking for doesn't exist or has been removed.
      </Text>
      <Pressable
        onPress={() => router.back()}
        className="mt-6 bg-primary-600 px-6 py-3 rounded-xl"
      >
        <Text className="text-white font-semibold">Go Back</Text>
      </Pressable>
    </View>
  );
}

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: property, isLoading, error } = useProperty(id ?? null);

  const handleLikeComment = (commentId: string) => {
    console.log('Liked comment:', commentId);
  };

  const handleReplyComment = (commentId: string) => {
    console.log('Reply to comment:', commentId);
  };

  const handleSubmitGuess = (price: number) => {
    console.log('Submitted guess for property', id, ':', price);
    // TODO: Submit to API
  };

  const handleShare = async () => {
    if (!property) return;
    try {
      await Share.share({
        message: `Check out this property: ${property.address}, ${property.city}`,
        title: `${property.address} - HuisHype`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const handleSave = () => {
    console.log('Save property:', id);
    // TODO: Implement save functionality
  };

  const handleLike = () => {
    console.log('Like property:', id);
    // TODO: Implement like functionality
  };

  if (isLoading) {
    return (
      <>
        <Stack.Screen
          options={{
            headerTitle: 'Property Details',
            headerLeft: () => (
              <Pressable onPress={() => router.back()} className="p-2">
                <Ionicons name="close" size={24} color="#666" />
              </Pressable>
            ),
          }}
        />
        <PropertyDetailSkeleton />
      </>
    );
  }

  if (error || !property) {
    return (
      <>
        <Stack.Screen
          options={{
            headerTitle: 'Property Details',
            headerLeft: () => (
              <Pressable onPress={() => router.back()} className="p-2">
                <Ionicons name="close" size={24} color="#666" />
              </Pressable>
            ),
          }}
        />
        <PropertyNotFound />
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: 'Property Details',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="p-2">
              <Ionicons name="close" size={24} color="#666" />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={handleShare} className="p-2">
              <Ionicons name="share-outline" size={24} color="#666" />
            </Pressable>
          ),
        }}
      />
      <ScrollView className="flex-1 bg-white">
        {/* Property header image */}
        <View className="bg-gray-200 h-56 items-center justify-center">
          <Ionicons name="image-outline" size={48} color="#9CA3AF" />
          <Text className="text-gray-400 mt-2">Property Photo</Text>
          <Text className="text-xs text-gray-400 mt-1">ID: {id}</Text>
        </View>

        <View className="p-4">
          {/* Address and basic info */}
          <View className="mb-4">
            <Text className="text-2xl font-bold text-gray-900">
              {property.address}
            </Text>
            <Text className="text-gray-500 mt-1">
              {property.city}
              {property.postalCode ? `, ${property.postalCode}` : ''}
            </Text>
          </View>

          {/* Property badges */}
          <View className="flex-row flex-wrap gap-2 mb-4">
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
            {property.status && (
              <View className="flex-row items-center bg-gray-100 px-3 py-1.5 rounded-full">
                <Ionicons name="checkmark-circle-outline" size={14} color="#6B7280" />
                <Text className="text-sm text-gray-600 ml-1 capitalize">{property.status}</Text>
              </View>
            )}
          </View>

          {/* Quick stats */}
          <View className="flex-row flex-wrap mb-6 bg-gray-50 rounded-xl p-4">
            {property.wozValue && (
              <View className="w-1/2 mb-3">
                <Text className="text-xs text-gray-400">WOZ Value</Text>
                <Text className="text-lg font-semibold text-gray-700">
                  {formatPrice(property.wozValue)}
                </Text>
              </View>
            )}
            <View className="w-1/2 mb-3">
              <Text className="text-xs text-gray-400">Asking Price</Text>
              <Text className="text-lg font-semibold text-gray-700">
                --
              </Text>
            </View>
            <View className="w-1/2">
              <Text className="text-xs text-gray-400">Crowd FMV</Text>
              <Text className="text-lg font-bold text-primary-600">
                --
              </Text>
            </View>
            <View className="w-1/2">
              <Text className="text-xs text-gray-400">Guesses</Text>
              <Text className="text-lg font-semibold text-gray-700">0</Text>
            </View>
          </View>

          {/* Quick Actions */}
          <View className="flex-row justify-around mb-6 py-3 border-y border-gray-100">
            <Pressable
              onPress={handleSave}
              className="flex-row items-center px-4 py-2"
            >
              <Ionicons name="bookmark-outline" size={22} color="#6B7280" />
              <Text className="ml-2 text-gray-600">Save</Text>
            </Pressable>
            <Pressable
              onPress={handleShare}
              className="flex-row items-center px-4 py-2"
            >
              <Ionicons name="share-outline" size={22} color="#6B7280" />
              <Text className="ml-2 text-gray-600">Share</Text>
            </Pressable>
            <Pressable
              onPress={handleLike}
              className="flex-row items-center px-4 py-2"
            >
              <Ionicons name="heart-outline" size={22} color="#6B7280" />
              <Text className="ml-2 text-gray-600">Like</Text>
            </Pressable>
          </View>

          {/* External listing link - placeholder */}
          <View className="mb-6">
            <Pressable
              disabled
              className="flex-row items-center justify-center bg-gray-200 py-3 rounded-xl"
            >
              <Ionicons name="link-outline" size={16} color="#9CA3AF" />
              <Text className="text-gray-400 font-semibold ml-2">
                No listing available
              </Text>
            </Pressable>
          </View>

          {/* Price guess section */}
          <View className="mb-6">
            <PriceGuessSlider
              propertyId={property.id}
              wozValue={property.wozValue ?? undefined}
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
                  {property.address}, {property.postalCode ?? ''} {property.city}
                </Text>
              </View>
              {property.bouwjaar && (
                <View className="flex-row items-center py-2 border-b border-gray-100">
                  <View className="w-8 items-center">
                    <Ionicons name="calendar-outline" size={16} color="#6B7280" />
                  </View>
                  <Text className="flex-1 text-gray-500 text-sm">Year Built</Text>
                  <Text className="text-gray-900 text-sm font-medium">{property.bouwjaar}</Text>
                </View>
              )}
              {property.oppervlakte && (
                <View className="flex-row items-center py-2 border-b border-gray-100">
                  <View className="w-8 items-center">
                    <Ionicons name="resize-outline" size={16} color="#6B7280" />
                  </View>
                  <Text className="flex-1 text-gray-500 text-sm">Surface Area</Text>
                  <Text className="text-gray-900 text-sm font-medium">{property.oppervlakte} m{'\u00B2'}</Text>
                </View>
              )}
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
    </>
  );
}
