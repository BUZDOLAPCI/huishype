import { useState, useCallback, useRef } from 'react';
import {
  ScrollView,
  View,
  TouchableOpacity,
  Text,
  Platform,
  StyleSheet,
  BackHandler,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect } from 'react';

import { RouteLoadingShell } from '@/src/components/RouteLoadingShell';
import { Icon } from '@/src/components/ui/Icon';
import { useProperty } from '@/src/hooks/useProperties';
import { AuthModal } from '@/src/components';
import { PropertyContent } from '@/src/components/PropertyBottomSheet/PropertyContent';
import {
  DEFAULT_AUTH_MODAL_COPY,
  resolveAuthModalCopy,
  type AuthModalCopyInput,
} from '@/src/lib/authModalCopy';
import {
  buildPropertyMapRoute,
  buildPropertyCommentsRoute,
  buildPropertyGuessesRoute,
  buildPropertyRoute,
  normalizePropertyReturnTarget,
  toInternalAppHref,
} from '@/src/utils/property-route';

function PropertyDetailSkeleton() {
  return (
    <RouteLoadingShell
      title="Loading property"
      subtitle="Preparing the property detail surface..."
    />
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
      <TouchableOpacity onPress={onGoBack} style={styles.goBackButton}>
        <Text style={styles.goBackText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}

export interface PropertyDetailRouteScreenProps {
  propertyId?: string | null;
  returnTo?: string | string[] | null;
  onNavigate?: (path: string) => void;
}

export function PropertyDetailRouteScreen({
  propertyId,
  returnTo,
  onNavigate,
}: PropertyDetailRouteScreenProps) {
  const insets = useSafeAreaInsets();
  const { data: property, isLoading, error } = useProperty(propertyId ?? null);
  const normalizedReturnTarget = normalizePropertyReturnTarget(returnTo);
  const lastBackAtRef = useRef(0);
  const [isHydrated, setIsHydrated] = useState(Platform.OS !== 'web');

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authCopy, setAuthCopy] = useState(DEFAULT_AUTH_MODAL_COPY);
  const pendingAuthSuccessRef = useRef<(() => void) | null>(null);
  const handleAuthRequired = useCallback((
    copy?: AuthModalCopyInput,
    onAuthenticated?: () => void,
  ) => {
    pendingAuthSuccessRef.current = onAuthenticated ?? null;
    setAuthCopy(resolveAuthModalCopy(copy, DEFAULT_AUTH_MODAL_COPY));
    setShowAuthModal(true);
  }, []);
  const handleAuthModalClose = useCallback(() => {
    pendingAuthSuccessRef.current = null;
    setShowAuthModal(false);
  }, []);
  const handleAuthSuccess = useCallback(() => {
    const pendingAction = pendingAuthSuccessRef.current;
    pendingAuthSuccessRef.current = null;
    setShowAuthModal(false);
    if (pendingAction) {
      setTimeout(pendingAction, 0);
    }
  }, []);

  const handleViewAllComments = useCallback(
    (nextPropertyId: string) => {
      if (!property || property.id !== nextPropertyId) {
        return;
      }

      router.push(
        toInternalAppHref(
          buildPropertyCommentsRoute(
            property,
            buildPropertyRoute(property, normalizedReturnTarget),
          ),
        ),
      );
    },
    [normalizedReturnTarget, property],
  );

  const handleViewAllGuesses = useCallback(
    (nextPropertyId: string) => {
      if (!property || property.id !== nextPropertyId) {
        return;
      }

      router.push(
        toInternalAppHref(
          buildPropertyGuessesRoute(
            property,
            buildPropertyRoute(property, normalizedReturnTarget),
          ),
        ),
      );
    },
    [normalizedReturnTarget, property],
  );

  const handleBack = useCallback(() => {
    if (normalizedReturnTarget) {
      if (onNavigate) {
        onNavigate(normalizedReturnTarget);
        return;
      }

      const href = toInternalAppHref(normalizedReturnTarget);
      if (Platform.OS === 'web') {
        router.navigate(href);
        return;
      }

      router.dismissTo(href);
      return;
    }

    if (property) {
      const previewRoute = buildPropertyMapRoute(property);
      if (onNavigate) {
        onNavigate(previewRoute);
        return;
      }

      const href = toInternalAppHref(previewRoute);
      if (Platform.OS === 'web') {
        router.navigate(href);
        return;
      }

      router.dismissTo(href);
      return;
    }

    if (router.canDismiss()) {
      router.dismiss();
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.navigate('/');
  }, [normalizedReturnTarget, onNavigate, property]);

  const triggerBack = useCallback(() => {
    const now = Date.now();
    if (now - lastBackAtRef.current < 250) {
      return;
    }

    lastBackAtRef.current = now;
    handleBack();
  }, [handleBack]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        return undefined;
      }

      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          handleBack();
          return true;
        },
      );

      return () => {
        subscription.remove();
      };
    }, [handleBack]),
  );

  const topInset = Platform.OS === 'web' ? 16 : insets.top;
  const shouldRenderHydrationShell = Platform.OS === 'web' && !isHydrated;

  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsHydrated(true);
    }
  }, []);

  if (shouldRenderHydrationShell || isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.floatingBackRow, { top: topInset + 8 }]}>
          <TouchableOpacity
            onPress={triggerBack}
            style={styles.floatingButton}
            activeOpacity={0.8}
          >
            <Icon name="ArrowLeft" size={20} color="#FFFFFF" />
          </TouchableOpacity>
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
          <TouchableOpacity
            onPress={triggerBack}
            style={styles.floatingButton}
            activeOpacity={0.8}
          >
            <Icon name="ArrowLeft" size={20} color="#3D3832" />
          </TouchableOpacity>
        </View>
        <PropertyNotFound onGoBack={triggerBack} />
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
            onGuessPress={handleViewAllGuesses}
            onViewAllComments={handleViewAllComments}
          />
        </ScrollView>

        <View
          style={[styles.floatingBackRow, { top: topInset + 8 }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            onPress={triggerBack}
            style={styles.floatingButton}
            testID="property-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            activeOpacity={0.8}
          >
            <Icon name="CaretLeft" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <AuthModal
        visible={showAuthModal}
        onClose={handleAuthModalClose}
        copy={authCopy}
        onSuccess={handleAuthSuccess}
      />
    </>
  );
}

export default PropertyDetailRouteScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
  scrollView: {
    flex: 1,
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
