import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { AuthModal } from '@/src/components';
import { PropertyContent } from '@/src/components/PropertyBottomSheet/PropertyContent';
import { RouteLoadingShell } from '@/src/components/RouteLoadingShell';
import { useProperty } from '@/src/hooks/useProperties';
import {
  DEFAULT_AUTH_MODAL_COPY,
  resolveAuthModalCopy,
  type AuthModalCopyInput,
} from '@/src/lib/authModalCopy';
import {
  buildPropertyCommentsRoute,
  buildPropertyGuessesRoute,
  buildPropertyRoute,
  toInternalAppHref,
} from '@/src/utils/property-route';

export interface PropertyDetailRouteScreenProps {
  propertyId?: string | null;
}

export function PropertyDetailRouteScreen({
  propertyId,
}: PropertyDetailRouteScreenProps) {
  const insets = useSafeAreaInsets();
  const { data: property, isLoading } = useProperty(propertyId ?? null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authCopy, setAuthCopy] = useState(DEFAULT_AUTH_MODAL_COPY);

  const handleAuthRequired = useCallback((copy?: AuthModalCopyInput) => {
    setAuthCopy(resolveAuthModalCopy(copy, DEFAULT_AUTH_MODAL_COPY));
    setShowAuthModal(true);
  }, []);

  const handleViewAllComments = useCallback(
    (nextPropertyId: string) => {
      if (!property || property.id !== nextPropertyId) {
        return;
      }

      router.push(
        toInternalAppHref(
          buildPropertyCommentsRoute(property, buildPropertyRoute(property)),
        ),
      );
    },
    [property],
  );

  const handleViewAllGuesses = useCallback(
    (nextPropertyId: string) => {
      if (!property || property.id !== nextPropertyId) {
        return;
      }

      router.push(
        toInternalAppHref(
          buildPropertyGuessesRoute(property, buildPropertyRoute(property)),
        ),
      );
    },
    [property],
  );

  if (isLoading) {
    return (
      <RouteLoadingShell
        title="Loading property"
        subtitle="Preparing the property detail surface..."
      />
    );
  }

  if (!property) {
    return null;
  }

  return (
    <>
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

      <AuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        copy={authCopy}
      />
    </>
  );
}

export default PropertyDetailRouteScreen;

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
});
