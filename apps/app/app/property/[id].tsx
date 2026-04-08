import { useState, useCallback } from 'react';
import { ScrollView, View, Pressable, ActivityIndicator, Text, Platform, StyleSheet, BackHandler } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/src/components/ui/Icon';
import { useProperty } from '@/src/hooks/useProperties';
import { AuthModal } from '@/src/components';
import { PropertyContent } from '@/src/components/PropertyBottomSheet/PropertyContent';
import { normalizePropertyReturnTarget } from '@/src/utils/property-route';

function PropertyDetailSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <ActivityIndicator size="large" color="#F5A623" />
      <Text style={styles.skeletonText}>Loading property...</Text>
    </View>
  );
}

function PropertyNotFound({ onGoBack }: { onGoBack: () => void }) {
  return (
    <View style={styles.notFoundContainer}>
      <Icon name="HouseLine" size={64} color="#E8E0D4" />
      <Text style={styles.notFoundTitle}>Property not found</Text>
      <Text style={styles.notFoundMessage}>
        The property you're looking for doesn't exist or has been removed.
      </Text>
      <Pressable
        onPress={onGoBack}
        style={styles.goBackButton}
      >
        <Text style={styles.goBackText}>Go Back</Text>
      </Pressable>
    </View>
  );
}

export default function PropertyDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { data: property, isLoading, error } = useProperty(id ?? null);
  const normalizedReturnTarget = normalizePropertyReturnTarget(returnTo);

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const handleAuthRequired = useCallback(() => setShowAuthModal(true), []);

  // Navigation handlers for sub-routes
  const handleViewAllComments = useCallback((propertyId: string) => {
    router.push(`/comments/${propertyId}`);
  }, []);

  const handleViewAllGuesses = useCallback((propertyId: string) => {
    router.push(`/guesses/${propertyId}`);
  }, []);

  const handleBack = useCallback(() => {
    if (normalizedReturnTarget) {
      router.replace(normalizedReturnTarget);
      return;
    }

    router.back();
  }, [normalizedReturnTarget]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        return undefined;
      }

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBack();
        return true;
      });

      return () => {
        subscription.remove();
      };
    }, [handleBack]),
  );

  const topInset = Platform.OS === 'web' ? 16 : insets.top;

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        {/* Floating back button */}
        <View style={[styles.floatingBackRow, { top: topInset + 8 }]}>
          <Pressable onPress={handleBack} style={styles.floatingButton}>
            <Icon name="ArrowLeft" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
        <PropertyDetailSkeleton />
      </>
    );
  }

  if (error || !property) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.floatingBackRow, { top: topInset + 8 }]}>
          <Pressable onPress={handleBack} style={styles.floatingButton}>
            <Icon name="ArrowLeft" size={20} color="#3D3832" />
          </Pressable>
        </View>
        <PropertyNotFound onGoBack={handleBack} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          <PropertyContent
            property={property}
            manageInteractionsInternally
            onAuthRequired={handleAuthRequired}
            onViewAllComments={handleViewAllComments}
            onViewAllGuesses={handleViewAllGuesses}
          />
        </ScrollView>

        {/* Floating overlay buttons on top of hero image */}
        <View
          style={[styles.floatingBackRow, { top: topInset + 8 }]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={handleBack}
            style={styles.floatingButton}
            testID="property-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Icon name="CaretLeft" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {/* Auth Modal */}
      <AuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
  scrollView: {
    flex: 1,
  },
  skeletonContainer: {
    flex: 1,
    backgroundColor: '#FFFBF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonText: {
    color: '#9C958A',
    marginTop: 16,
    fontSize: 15,
  },
  notFoundContainer: {
    flex: 1,
    backgroundColor: '#FFFBF5',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  notFoundTitle: {
    color: '#2D2926',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  notFoundMessage: {
    color: '#9C958A',
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
  },
  goBackButton: {
    marginTop: 24,
    backgroundColor: '#F5A623',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  goBackText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  floatingBackRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  floatingButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
