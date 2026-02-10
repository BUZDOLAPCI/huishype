import { useState, useCallback } from 'react';
import { ScrollView, View, Pressable, ActivityIndicator, Text } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { useProperty } from '@/src/hooks/useProperties';
import { useListings } from '@/src/hooks/useListings';
import { usePropertyLike } from '@/src/hooks/usePropertyLike';
import { usePropertySave } from '@/src/hooks/usePropertySave';
import { AuthModal } from '@/src/components';
import type { Property } from '@/src/hooks/useProperties';
import type { PropertyDetailsData } from '@/src/components/PropertyBottomSheet/types';

// Reuse the same sub-components as the map's bottom sheet
import { PropertyHeader } from '@/src/components/PropertyBottomSheet/PropertyHeader';
import { PriceSection } from '@/src/components/PropertyBottomSheet/PriceSection';
import { QuickActions } from '@/src/components/PropertyBottomSheet/QuickActions';
import { ListingLinks } from '@/src/components/PropertyBottomSheet/ListingLinks';
import { PriceGuessSection } from '@/src/components/PropertyBottomSheet/PriceGuessSection';
import { CommentsSection } from '@/src/components/PropertyBottomSheet/CommentsSection';
import { PropertyDetails } from '@/src/components/PropertyBottomSheet/PropertyDetails';
import { ListingSubmissionSheet } from '@/src/components/PropertyBottomSheet/ListingSubmissionSheet';

// Convert Property/PropertyDetails to PropertyDetailsData, preserving API values when available
function toPropertyDetails(
  property: Property,
  overrides?: { isLiked?: boolean; isSaved?: boolean }
): PropertyDetailsData {
  const p = property as Partial<PropertyDetailsData>;
  return {
    ...property,
    activityLevel: p.activityLevel ?? 'cold',
    commentCount: p.commentCount ?? 0,
    guessCount: p.guessCount ?? 0,
    viewCount: p.viewCount ?? 0,
    isSaved: overrides?.isSaved ?? p.isSaved ?? false,
    isLiked: overrides?.isLiked ?? p.isLiked ?? false,
  };
}

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
  const queryClient = useQueryClient();
  const { data: property, isLoading, error } = useProperty(id ?? null);

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const handleAuthRequired = useCallback(() => setShowAuthModal(true), []);

  // Listing submission modal state
  const [showSubmission, setShowSubmission] = useState(false);

  // Fetch listings for the current property
  const { data: listings = [] } = useListings(id ?? null);

  // Real like/save hooks with auth gating
  const { isLiked, toggleLike } = usePropertyLike({
    propertyId: id ?? null,
    onAuthRequired: handleAuthRequired,
  });
  const { isSaved, toggleSave } = usePropertySave({
    propertyId: id ?? null,
    onAuthRequired: handleAuthRequired,
  });

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

  const propertyDetails = toPropertyDetails(property, { isLiked, isSaved });

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: property.address,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="p-2">
              <Ionicons name="close" size={24} color="#666" />
            </Pressable>
          ),
        }}
      />
      <ScrollView className="flex-1 bg-white" showsVerticalScrollIndicator={false}>
        {/* Property Header with Photos/Satellite */}
        <PropertyHeader property={propertyDetails} />

        {/* Price Section */}
        <PriceSection property={propertyDetails} />

        {/* Quick Actions Bar (Save/Share/Like) */}
        <QuickActions
          property={propertyDetails}
          onSave={toggleSave}
          onShare={() => {}}
          onLike={toggleLike}
        />

        {/* Listing Links */}
        <ListingLinks
          listings={listings}
          onAddListing={() => setShowSubmission(true)}
        />

        {/* Price Guess Section with FMV Visualization */}
        <PriceGuessSection
          property={propertyDetails}
          onLoginRequired={handleAuthRequired}
        />

        {/* Comments Section with real API data */}
        <CommentsSection
          property={propertyDetails}
          onAuthRequired={handleAuthRequired}
        />

        {/* Property Details */}
        <PropertyDetails property={propertyDetails} />

        {/* Bottom padding */}
        <View className="h-10" />
      </ScrollView>

      {/* Auth Modal */}
      <AuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />

      {/* Listing Submission Sheet */}
      {id && (
        <ListingSubmissionSheet
          propertyId={id}
          visible={showSubmission}
          onClose={() => setShowSubmission(false)}
          onSubmitted={() => {
            setShowSubmission(false);
            queryClient.invalidateQueries({ queryKey: ['listings', id] });
          }}
          onAuthRequired={handleAuthRequired}
        />
      )}
    </>
  );
}
