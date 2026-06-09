import { useState, useCallback, useRef } from 'react';
import {
  ScrollView,
  View,
  TouchableOpacity,
  Text,
  Platform,
  StyleSheet,
  BackHandler,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
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
import { useT } from '@/src/i18n';
import { getSectionScrollTarget } from '@/src/components/PropertyBottomSheet/sectionScroll';

function PropertyDetailSkeleton() {
  const t = useT();

  return (
    <RouteLoadingShell
      title={t('property.loading.title')}
      subtitle={t('property.loading.subtitle')}
    />
  );
}

function PropertyNotFound({ onGoBack }: { onGoBack: () => void }) {
  const t = useT();

  return (
    <View style={styles.notFoundContainer}>
      <Icon name="HouseLine" size={64} color="#E8E0D4" />
      <Text style={styles.notFoundTitle}>{t('property.notFound.title')}</Text>
      <Text style={styles.notFoundMessage}>
        {t('property.notFound.body')}
      </Text>
      <TouchableOpacity onPress={onGoBack} style={styles.goBackButton}>
        <Text style={styles.goBackText}>{t('property.goBack')}</Text>
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
  const t = useT();
  const insets = useSafeAreaInsets();
  const { data: property, isLoading, isSuccess } = useProperty(propertyId ?? null);
  const normalizedReturnTarget = normalizePropertyReturnTarget(returnTo);
  const lastBackAtRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const guessSectionY = useRef(0);
  const commentsSectionY = useRef(0);
  const [isHydrated, setIsHydrated] = useState(Platform.OS !== 'web');
  const [scrollViewport, setScrollViewport] = useState({ offsetY: 0, height: 0 });

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

  const scrollToSection = useCallback((sectionY: number) => {
    scrollRef.current?.scrollTo({
      y: getSectionScrollTarget(sectionY),
      animated: true,
    });
  }, []);

  const handleScrollToComments = useCallback(() => {
    scrollToSection(commentsSectionY.current);
  }, [scrollToSection]);

  const handleScrollToGuess = useCallback(() => {
    scrollToSection(guessSectionY.current);
  }, [scrollToSection]);

  const handleScrollViewLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    setScrollViewport((current) => {
      if (Math.abs(current.height - nextHeight) < 1) {
        return current;
      }

      return {
        ...current,
        height: nextHeight,
      };
    });
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextOffsetY = event.nativeEvent.contentOffset.y;
    setScrollViewport((current) => {
      if (Math.abs(current.offsetY - nextOffsetY) < 48) {
        return current;
      }

      return {
        ...current,
        offsetY: nextOffsetY,
      };
    });
  }, []);

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

  if (shouldRenderHydrationShell || isLoading || (!property && !isSuccess)) {
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

  if (!property) {
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
          ref={scrollRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          onLayout={handleScrollViewLayout}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          <PropertyContent
            property={property}
            manageInteractionsInternally
            onAuthRequired={handleAuthRequired}
            onScrollToComments={handleScrollToComments}
            onScrollToGuess={handleScrollToGuess}
            onGuessPress={handleViewAllGuesses}
            onViewAllComments={handleViewAllComments}
            onGuessSectionLayout={(y) => { guessSectionY.current = y; }}
            onCommentsSectionLayout={(y) => { commentsSectionY.current = y; }}
            scrollViewport={scrollViewport}
            deferSocialSectionsUntilActionsVisible
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
            accessibilityLabel={t('common.back')}
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
