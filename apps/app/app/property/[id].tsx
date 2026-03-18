import { useState, useCallback } from 'react';
import { ScrollView, View, Pressable, ActivityIndicator, Text } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useProperty } from '@/src/hooks/useProperties';
import { AuthModal } from '@/src/components';
import { PropertyContent } from '@/src/components/PropertyBottomSheet/PropertyContent';

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

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const handleAuthRequired = useCallback(() => setShowAuthModal(true), []);

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
          headerTitle: property.address,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="p-2">
              <Ionicons name="close" size={24} color="#666" />
            </Pressable>
          ),
        }}
      />
      <ScrollView className="flex-1 bg-white" showsVerticalScrollIndicator={false}>
        <PropertyContent
          property={property}
          manageInteractionsInternally
          onAuthRequired={handleAuthRequired}
        />
        {/* Bottom padding */}
        <View className="h-10" />
      </ScrollView>

      {/* Auth Modal */}
      <AuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
