import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { AuthModal } from '@/src/components';
import { Icon } from '@/src/components/ui/Icon';
import { PropertyContent } from '@/src/components/PropertyBottomSheet/PropertyContent';
import { ResponsivePanel } from '@/src/components/ui/ResponsivePanel';
import { useProperty } from '@/src/hooks/useProperties';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  mergeStyles,
} from '../dom';
import {
  DEFAULT_AUTH_MODAL_COPY,
  resolveAuthModalCopy,
  type AuthModalCopyInput,
} from '@/src/lib/authModalCopy';
import { normalizePropertyReturnTarget } from '@/src/utils/property-route';
import { colors } from '../theme';

function PropertyDetailSkeleton() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={colors.goldDeep} />
      <Text style={styles.statusText}>Loading property...</Text>
    </View>
  );
}

function PropertyNotFound({ onGoBack }: { onGoBack: () => void }) {
  return (
    <View style={styles.centered}>
      <Icon name="HouseLine" size={64} color={colors.border} />
      <Text style={styles.title}>Property not found</Text>
      <Text style={styles.body}>The property you&apos;re looking for doesn&apos;t exist or has been removed.</Text>
      <Pressable onPress={onGoBack} style={styles.goBackButton}>
        <Text style={styles.goBackText}>Go Back</Text>
      </Pressable>
    </View>
  );
}

export function PropertyRoute() {
  const navigate = useNavigate();
  const { id = 'property' } = useParams();
  const [searchParams] = useSearchParams();
  const normalizedReturnTarget = normalizePropertyReturnTarget(searchParams.get('returnTo') ?? undefined);
  const fallbackTo = normalizedReturnTarget ?? '/feed';
  const { data: property, isLoading, error } = useProperty(id ?? null);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authCopy, setAuthCopy] = useState(DEFAULT_AUTH_MODAL_COPY);

  const handleAuthRequired = useCallback((copy?: AuthModalCopyInput) => {
    setAuthCopy(resolveAuthModalCopy(copy, DEFAULT_AUTH_MODAL_COPY));
    setShowAuthModal(true);
  }, []);

  const handleBack = useCallback(() => {
    if (normalizedReturnTarget) {
      navigate(normalizedReturnTarget, { replace: true });
      return;
    }

    navigate(-1);
  }, [navigate, normalizedReturnTarget]);

  const topInset = useMemo(() => 24, []);

  if (isLoading) {
    return (
      <ResponsivePanel title="Property" onClose={handleBack}>
        <View style={styles.routeRoot}>
          <View style={mergeStyles(styles.backRow, { top: topInset })}>
            <Pressable onPress={handleBack} style={styles.floatingButton}>
              <Icon name="ArrowLeft" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
          <PropertyDetailSkeleton />
        </View>
      </ResponsivePanel>
    );
  }

  if (error || !property) {
    return (
      <ResponsivePanel title="Property" onClose={handleBack}>
        <View style={styles.routeRoot}>
          <View style={mergeStyles(styles.backRow, { top: topInset })}>
            <Pressable onPress={handleBack} style={styles.floatingButton}>
              <Icon name="ArrowLeft" size={20} color={colors.text} />
            </Pressable>
          </View>
          <PropertyNotFound onGoBack={handleBack} />
        </View>
      </ResponsivePanel>
    );
  }

  return (
    <ResponsivePanel title="Property details" onClose={handleBack}>
      <View style={styles.routeRoot}>
        <View style={mergeStyles(styles.backRow, { top: topInset })}>
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

        <PropertyContent
          property={property}
          manageInteractionsInternally
          onAuthRequired={handleAuthRequired}
          onViewAllComments={(propertyId) => navigate(`/comments/${propertyId}`)}
          onViewAllGuesses={(propertyId) => navigate(`/guesses/${propertyId}`)}
        />
      </View>

      <AuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        copy={authCopy}
      />
    </ResponsivePanel>
  );
}

const styles = StyleSheet.create({
  routeRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  statusText: {
    color: colors.textMuted,
    marginTop: 16,
    fontSize: 15,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  body: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
  },
  goBackButton: {
    marginTop: 24,
    backgroundColor: colors.gold,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  goBackText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  backRow: {
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
