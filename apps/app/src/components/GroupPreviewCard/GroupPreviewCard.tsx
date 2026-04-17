import { useCallback, useRef, useEffect } from 'react';
import {
  Pressable,
  Text,
  View,
  Platform,
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { PropertyPreviewCard } from '../PropertyPreviewCard';
import type { GroupPreviewCardProps } from './types';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';
import type { WebViewStyle } from '@/src/lib/webStyle';

const CARD_WIDTH = 280;
const PREVIEW_ARROW_SIZE = 10;
const PAGE_PROGRESS_DOT_COUNT = 4;
const SWIPE_ACTIVATION_DISTANCE = 18;
const SWIPE_FLICK_DISTANCE = 12;
const SWIPE_FLICK_VELOCITY = 0.35;
const SWIPE_DIRECTIONAL_BIAS = 1.25;
const SWIPE_DIRECTIONAL_LEEWAY = 6;

// ─── Warm palette constants ──────────────────────────────────────────────

const COLORS = {
  white: '#FFFFFF',
  warm200: '#F5F0E8',
  warm400: '#C7BFB3',
  warm700: '#504A42',
  warm800: '#3D3832',
  warm900: '#2D2926',
  gold500: '#F5A623',
  gold600: '#DE911D',
} as const;

function getProgressDotIndex(currentIndex: number, total: number): number {
  if (total <= 1) return 0;
  const maxIndex = PAGE_PROGRESS_DOT_COUNT - 1;
  return Math.round((currentIndex / (total - 1)) * maxIndex);
}

/** Maximum horizontal drag distance (px) for the swipe animation. */
const SWIPE_MAX_DRAG = 80;
const WEB_ARROW_SHADOW_STYLE: WebViewStyle = {
  filter: 'drop-shadow(0px -2px 3px rgba(0,0,0,0.08))',
};
const WEB_ARROW_DOWN_SHADOW_STYLE: WebViewStyle = {
  filter: 'drop-shadow(0px 2px 3px rgba(0,0,0,0.08))',
};
const WEB_CARD_SHADOW_STYLE: WebViewStyle = {
  boxShadow: '0px 14px 30px rgba(26, 25, 24, 0.18), 0px 4px 12px rgba(180, 119, 18, 0.10)',
};

type PreviewSwipeGesture = {
  dx: number;
  dy: number;
  vx?: number;
};

export function shouldClaimPreviewSwipe(gesture: PreviewSwipeGesture): boolean {
  const absDx = Math.abs(gesture.dx);
  const absDy = Math.abs(gesture.dy);
  const absVx = Math.abs(gesture.vx ?? 0);

  if (absDx < SWIPE_FLICK_DISTANCE) {
    return false;
  }

  const isClearlyHorizontal =
    absDx >= absDy * SWIPE_DIRECTIONAL_BIAS ||
    absDx >= absDy + SWIPE_DIRECTIONAL_LEEWAY;

  if (!isClearlyHorizontal) {
    return false;
  }

  return absDx >= SWIPE_ACTIVATION_DISTANCE || absVx >= SWIPE_FLICK_VELOCITY;
}

/**
 * GroupPreviewCard — unified preview card for both single properties and clusters.
 *
 * - Single (1 property): shows PropertyPreviewCard content + outer close button
 * - Cluster (>1 properties): adds left/right arrows, page indicator, swipe gestures
 * - Optional arrow pointer to visually connect to map marker
 *
 * Native preview cards now render in an absolute overlay outside MapLibre, so
 * direct Pressable / PanResponder interactions work again on Android. The old
 * transparent hit-test overlay is intentionally gone; it was swallowing taps
 * above the real buttons, including the close button.
 */
export function GroupPreviewCard({
  properties,
  currentIndex: controlledIndex,
  onIndexChange,
  onClose,
  onPropertyTap,
  onLike,
  onComment,
  onGuess,
  isLiked = false,
  showArrow = false,
  arrowDirection = 'down',
  onTouchStart,
}: GroupPreviewCardProps) {
  const isCluster = properties.length > 1;
  const currentIndex = controlledIndex ?? 0;
  const currentProperty = properties[currentIndex];
  const { width: viewportWidth } = useWindowDimensions();

  const reducedMotion = useReducedMotion();
  const handleDirectTouchStart = useCallback(() => {
    onTouchStart?.();
  }, [onTouchStart]);

  const canGoLeft = currentIndex > 0;
  const canGoRight = currentIndex < properties.length - 1;

  // Animation for swipe
  const translateX = useRef(new Animated.Value(0)).current;

  const goLeft = useCallback(() => {
    if (!canGoLeft) return;
    if (reducedMotion) {
      translateX.setValue(0);
    } else {
      translateX.setValue(-40);
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
      }).start();
    }
    onIndexChange?.(currentIndex - 1);
  }, [canGoLeft, currentIndex, onIndexChange, translateX, reducedMotion]);

  const goRight = useCallback(() => {
    if (!canGoRight) return;
    if (reducedMotion) {
      translateX.setValue(0);
    } else {
      translateX.setValue(40);
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
      }).start();
    }
    onIndexChange?.(currentIndex + 1);
  }, [canGoRight, currentIndex, onIndexChange, translateX, reducedMotion]);

  // Refs to hold latest navigation state — read inside PanResponder to avoid stale closures
  const canGoLeftRef = useRef(canGoLeft);
  const canGoRightRef = useRef(canGoRight);
  const goLeftRef = useRef(goLeft);
  const goRightRef = useRef(goRight);
  canGoLeftRef.current = canGoLeft;
  canGoRightRef.current = canGoRight;
  goLeftRef.current = goLeft;
  goRightRef.current = goRight;

  // PanResponder for swipe gestures
  // Guard against PanResponder being undefined in test environments
  const panResponder = useRef(
    PanResponder?.create?.({
      onStartShouldSetPanResponder: () => false, // Let Pressable handle taps; only claim horizontal drags.
      onMoveShouldSetPanResponder: (_, gs) => shouldClaimPreviewSwipe(gs),
      onPanResponderTerminationRequest: () => false, // Don't let map steal the gesture
      onPanResponderMove: (_, gs) => {
        translateX.setValue(Math.max(-SWIPE_MAX_DRAG, Math.min(SWIPE_MAX_DRAG, gs.dx)));
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 40 && canGoLeftRef.current) {
          goLeftRef.current();
        } else if (gs.dx < -40 && canGoRightRef.current) {
          goRightRef.current();
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
          }).start();
        }
      },
    }) ?? { panHandlers: {} }
  ).current;

  // Reset translateX when index changes externally
  useEffect(() => {
    translateX.setValue(0);
  }, [currentIndex, translateX]);

  if (!currentProperty) return null;

  const arrowUp = arrowDirection === 'up';
  const cardWidth = Platform.OS === 'web'
    ? Math.min(CARD_WIDTH, Math.round(viewportWidth * 0.85))
    : CARD_WIDTH;

  // Convert GroupPreviewProperty to PropertyPreviewData for the content card
  const previewData = {
    id: currentProperty.id,
    address: currentProperty.address,
    streetName: currentProperty.streetName,
    houseNumber: currentProperty.houseNumber,
    houseNumberAddition: currentProperty.houseNumberAddition,
    city: currentProperty.city,
    postalCode: currentProperty.postalCode,
    countryCode: currentProperty.countryCode,
    officialValuation: currentProperty.officialValuation,
    askingPrice: currentProperty.askingPrice,
    fmv: currentProperty.fmv,
    activityLevel: currentProperty.activityLevel,
    activityScore: currentProperty.activityScore,
    thumbnailUrl: currentProperty.thumbnailUrl,
    aerialImageUrl: currentProperty.aerialImageUrl,
    likeCount: currentProperty.likeCount,
    commentCount: currentProperty.commentCount,
    guessCount: currentProperty.guessCount,
  };

  const cardBody = (
    <View
      onTouchStart={Platform.OS !== 'web' ? handleDirectTouchStart : undefined}
      style={[styles.outerWrapper, { width: cardWidth }]}
      testID="group-preview-card"
    >
      {/* Arrow pointing up */}
      {showArrow && arrowUp && (
        <View
          style={[styles.arrowUp, Platform.OS === 'web' ? WEB_ARROW_SHADOW_STYLE : null]}
          testID="group-preview-arrow-up"
        />
      )}

      {/* Cluster navigation header — floats above the card content */}
      {isCluster && (
        <View style={styles.clusterHeader}>
          <View style={styles.clusterHeaderTopRow}>
            <Pressable
              onPress={goLeft}
              disabled={!canGoLeft}
              hitSlop={6}
              style={[
                styles.navArrow,
                styles.navArrowDark,
                !canGoLeft && styles.navArrowDisabled,
              ]}
              testID="group-preview-nav-left"
              accessibilityLabel="Previous property"
              accessibilityHint={canGoLeft ? `Go to property ${currentIndex}` : 'No previous property'}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canGoLeft }}
            >
              <Icon
                name="CaretLeft"
                size="md"
                color={COLORS.white}
              />
            </Pressable>

            <View style={styles.pageIndicator} testID="group-preview-page-indicator">
              <Icon name="ListBullets" size={13} color={COLORS.white} />
              <Text style={styles.pageText} testID="group-preview-page-text">
                {currentIndex + 1} of {properties.length}
              </Text>
            </View>

            <Pressable
              onPress={goRight}
              disabled={!canGoRight}
              hitSlop={6}
              style={[
                styles.navArrow,
                styles.navArrowGold,
                !canGoRight && styles.navArrowGoldDisabled,
              ]}
              testID="group-preview-nav-right"
              accessibilityLabel="Next property"
              accessibilityHint={canGoRight ? `Go to property ${currentIndex + 2}` : 'No next property'}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canGoRight }}
            >
              <Icon
                name="CaretRight"
                size="md"
                color={COLORS.white}
              />
            </Pressable>
          </View>

          <View style={styles.pageDotsRow} testID="group-preview-page-dots">
            {Array.from({ length: PAGE_PROGRESS_DOT_COUNT }, (_, index) => (
              <View
                key={`page-dot-${index}`}
                testID="group-preview-page-dot"
                style={[
                  styles.pageDot,
                  index === getProgressDotIndex(currentIndex, properties.length)
                    ? styles.pageDotActive
                    : styles.pageDotInactive,
                ]}
              />
            ))}
          </View>
        </View>
      )}

      {/* Main card container with shadow */}
      <View
        style={styles.cardContainer}
        collapsable={false}
      >

        {/* Property card content with swipe */}
        <Animated.View
          style={[
            isCluster ? { transform: [{ translateX }] } : {},
          ]}
          {...(isCluster ? panResponder.panHandlers : {})}
        >
          <View
            testID={Platform.OS !== 'web' ? 'group-preview-touch-overlay' : undefined}
          >
            <PropertyPreviewCard
              property={previewData}
              isLiked={isLiked}
              onPress={() => onPropertyTap?.(currentProperty)}
              onLike={() => onLike?.(currentProperty)}
              onComment={() => onComment?.(currentProperty)}
              onGuess={() => onGuess?.(currentProperty)}
              onClose={onClose}
              showCloseButton={!!onClose}
              closeButtonTestID="group-preview-close-button"
            />
          </View>
        </Animated.View>

      </View>

      {/* Arrow pointing down */}
      {showArrow && !arrowUp && (
        <View
          style={[styles.arrowDown, Platform.OS === 'web' ? WEB_ARROW_DOWN_SHADOW_STYLE : null]}
          testID="group-preview-arrow-down"
        />
      )}
    </View>
  );

  return cardBody;
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  outerWrapper: {
    maxWidth: '85%',
    alignSelf: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  cardContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
    // Preview shadow from design spec
    ...Platform.select({
      ios: {
        shadowColor: '#1A1918',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 20,
      },
      android: { elevation: 8 },
      default: {},
    }),
    // Web shadow
    ...(Platform.OS === 'web' ? WEB_CARD_SHADOW_STYLE : {}),
  },

  // Cluster header
  clusterHeader: {
    alignSelf: 'center',
    marginBottom: 8,
  },
  clusterHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  navArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#1A1918',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.14,
        shadowRadius: 4,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  navArrowDark: {
    backgroundColor: 'rgba(30, 27, 24, 0.92)',
  },
  navArrowDisabled: {
    opacity: 0.56,
  },
  navArrowGold: {
    backgroundColor: COLORS.gold500,
  },
  navArrowGoldDisabled: {
    opacity: 0.5,
  },
  pageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 29, 27, 0.94)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 5,
    minHeight: 34,
    ...Platform.select({
      ios: {
        shadowColor: '#1A1918',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.14,
        shadowRadius: 4,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  pageText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },
  pageDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 7,
  },
  pageDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  pageDotActive: {
    backgroundColor: COLORS.gold500,
  },
  pageDotInactive: {
    backgroundColor: 'rgba(45, 41, 38, 0.22)',
  },
  // Arrow pointers
  arrowUp: {
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: PREVIEW_ARROW_SIZE,
    borderRightWidth: PREVIEW_ARROW_SIZE,
    borderBottomWidth: PREVIEW_ARROW_SIZE,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFFFFF',
    marginBottom: -1,
  },
  arrowDown: {
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: PREVIEW_ARROW_SIZE,
    borderRightWidth: PREVIEW_ARROW_SIZE,
    borderTopWidth: PREVIEW_ARROW_SIZE,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
    marginTop: -1,
  },
});
