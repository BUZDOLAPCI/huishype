import { useCallback, useRef, useEffect } from 'react';
import { Pressable, Text, View, StyleSheet, Animated, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Property } from '@/src/hooks/useProperties';

export interface ClusterPreviewCardProps {
  properties: Property[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onPropertyPress: (property: Property) => void;
}

/**
 * ClusterPreviewCard displays a paginated view of properties in a cluster.
 * Shows "X of Y" navigation with left/right arrows and swipe gesture support.
 * Similar to Funda's clustered listing preview UI.
 */
export function ClusterPreviewCard({
  properties,
  currentIndex,
  onIndexChange,
  onClose,
  onPropertyPress,
}: ClusterPreviewCardProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const currentProperty = properties[currentIndex];

  const canGoLeft = currentIndex > 0;
  const canGoRight = currentIndex < properties.length - 1;

  const goLeft = useCallback(() => {
    if (canGoLeft) {
      // Animate slide from left
      translateX.setValue(-50);
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
      }).start();
      onIndexChange(currentIndex - 1);
    }
  }, [canGoLeft, currentIndex, onIndexChange, translateX]);

  const goRight = useCallback(() => {
    if (canGoRight) {
      // Animate slide from right
      translateX.setValue(50);
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
      }).start();
      onIndexChange(currentIndex + 1);
    }
  }, [canGoRight, currentIndex, onIndexChange, translateX]);

  // Swipe gesture handling
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only capture horizontal swipes
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 30;
      },
      onPanResponderMove: (_, gestureState) => {
        // Limit the drag range
        const clampedDx = Math.max(-100, Math.min(100, gestureState.dx));
        translateX.setValue(clampedDx);
      },
      onPanResponderRelease: (_, gestureState) => {
        const swipeThreshold = 50;

        if (gestureState.dx > swipeThreshold && canGoLeft) {
          // Swipe right to go to previous
          goLeft();
        } else if (gestureState.dx < -swipeThreshold && canGoRight) {
          // Swipe left to go to next
          goRight();
        } else {
          // Reset position
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
          }).start();
        }
      },
    })
  ).current;

  // Reset animation when index changes externally
  useEffect(() => {
    translateX.setValue(0);
  }, [currentIndex, translateX]);

  if (!currentProperty) {
    return null;
  }

  // Format price for display
  const formatPrice = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return 'N/A';
    return `\u20AC${value.toLocaleString('nl-NL')}`;
  };

  return (
    <View style={styles.container} testID="cluster-preview-card">
      {/* Navigation Header */}
      <View style={styles.header}>
        {/* Left Arrow */}
        <Pressable
          onPress={goLeft}
          disabled={!canGoLeft}
          style={[styles.navButton, !canGoLeft && styles.navButtonDisabled]}
          testID="cluster-nav-left"
          accessibilityLabel="Previous property"
          accessibilityRole="button"
        >
          <Ionicons
            name="chevron-back"
            size={28}
            color={canGoLeft ? '#FFFFFF' : '#9CA3AF'}
          />
        </Pressable>

        {/* Page Indicator */}
        <View style={styles.pageIndicator} testID="cluster-page-indicator">
          <Text style={styles.pageText}>
            {currentIndex + 1} of {properties.length}
          </Text>
        </View>

        {/* Right Arrow */}
        <Pressable
          onPress={goRight}
          disabled={!canGoRight}
          style={[styles.navButton, !canGoRight && styles.navButtonDisabled]}
          testID="cluster-nav-right"
          accessibilityLabel="Next property"
          accessibilityRole="button"
        >
          <Ionicons
            name="chevron-forward"
            size={28}
            color={canGoRight ? '#FFFFFF' : '#9CA3AF'}
          />
        </Pressable>

        {/* Spacer */}
        <View style={styles.headerSpacer} />

        {/* Close Button */}
        <Pressable
          onPress={onClose}
          style={styles.closeButton}
          testID="cluster-close-button"
          accessibilityLabel="Close cluster preview"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={28} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Property Card with swipe gestures */}
      <Animated.View
        style={[styles.cardContainer, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={() => onPropertyPress(currentProperty)}
          style={styles.card}
          testID="cluster-property-card"
        >
          {/* Property Info */}
          <View style={styles.propertyInfo}>
            {/* Address */}
            <Text style={styles.address} numberOfLines={1}>
              {currentProperty.address}
            </Text>
            <Text style={styles.cityPostal}>
              {currentProperty.postalCode ? `${currentProperty.postalCode} ` : ''}
              {currentProperty.city}
            </Text>

            {/* Price */}
            <View style={styles.priceContainer}>
              <Text style={styles.priceLabel}>WOZ Value</Text>
              <Text style={styles.price}>
                {formatPrice(currentProperty.wozValue)}
              </Text>
            </View>

            {/* Details Row */}
            <View style={styles.detailsRow}>
              {currentProperty.oppervlakte && (
                <View style={styles.detailItem}>
                  <Ionicons name="resize-outline" size={16} color="#6B7280" />
                  <Text style={styles.detailText}>
                    {currentProperty.oppervlakte} m\u00B2
                  </Text>
                </View>
              )}
              {currentProperty.bouwjaar && (
                <View style={styles.detailItem}>
                  <Ionicons name="calendar-outline" size={16} color="#6B7280" />
                  <Text style={styles.detailText}>{currentProperty.bouwjaar}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Tap indicator */}
          <View style={styles.tapIndicator}>
            <Text style={styles.tapText}>Tap for details</Text>
            <Ionicons name="chevron-forward" size={18} color="#F97316" />
          </View>
        </Pressable>
      </Animated.View>

      {/* Swipe hint */}
      <View style={styles.swipeHint}>
        <Text style={styles.swipeHintText}>Swipe to browse</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 4,
  },
  navButton: {
    backgroundColor: '#F97316', // Orange like Funda
    borderRadius: 6,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  navButtonDisabled: {
    backgroundColor: '#D1D5DB',
    shadowOpacity: 0.1,
  },
  pageIndicator: {
    backgroundColor: '#1F2937',
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minWidth: 80,
    alignItems: 'center',
  },
  pageText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSpacer: {
    flex: 1,
  },
  closeButton: {
    backgroundColor: '#F97316', // Orange like Funda
    borderRadius: 6,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  cardContainer: {
    // For animation
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  propertyInfo: {
    marginBottom: 16,
  },
  address: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F97316', // Orange link color like Funda
    marginBottom: 4,
  },
  cityPostal: {
    fontSize: 15,
    color: '#4B5563',
    marginBottom: 16,
  },
  priceContainer: {
    marginBottom: 16,
    backgroundColor: '#FFF7ED', // Light orange background
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#F97316',
  },
  priceLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  price: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1F2937',
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  detailText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  tapIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 16,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  tapText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F97316',
  },
  swipeHint: {
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignSelf: 'center',
  },
  swipeHintText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
});
