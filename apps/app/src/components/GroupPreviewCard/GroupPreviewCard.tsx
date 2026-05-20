import { useCallback, useRef, useEffect, useState } from 'react';
import {
  Pressable,
  Text,
  View,
  Platform,
  Animated,
  Image,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { PropertyPreviewCard } from '../PropertyPreviewCard';
import type { GroupPreviewCardProps } from './types';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';
import type { WebViewStyle } from '@/src/lib/webStyle';
import {
  getPropertyImageCandidates,
  toPropertyImageSource,
} from '@/src/utils/property-image';

const CARD_WIDTH = 280;
const COMPACT_CLUSTER_CARD_WIDTH = Math.round(CARD_WIDTH * 0.85);
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

const SWIPE_COMMIT_DISTANCE = 40;
const SWIPE_TRANSITION_DURATION_MS = 190;
const SWIPE_SNAP_DURATION_MS = 150;
const WEB_ARROW_SHADOW_STYLE: WebViewStyle = {
  filter: 'drop-shadow(0px -2px 3px rgba(0,0,0,0.08))',
};
const WEB_ARROW_DOWN_SHADOW_STYLE: WebViewStyle = {
  filter: 'drop-shadow(0px 2px 3px rgba(0,0,0,0.08))',
};
const WEB_CARD_SHADOW_STYLE: WebViewStyle = {
  boxShadow: '0px 14px 30px rgba(26, 25, 24, 0.18), 0px 4px 12px rgba(180, 119, 18, 0.10)',
};
const WEB_SWIPE_TOUCH_STYLE: WebViewStyle = {
  touchAction: 'pan-y',
  userSelect: 'none',
};

type PreviewSwipeGesture = {
  dx: number;
  dy: number;
  vx?: number;
};

type WebSwipeState = {
  startX: number;
  startY: number;
  lastX: number;
  lastTimestamp: number;
  claimed: boolean;
};

type SwipeDirection = -1 | 1;

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

function clampCarouselDrag(dx: number, canGoLeft: boolean, canGoRight: boolean, cardWidth: number): number {
  const min = canGoRight ? -cardWidth : 0;
  const max = canGoLeft ? cardWidth : 0;
  return Math.max(min, Math.min(max, dx));
}

function getCommitDirection(dx: number, canGoLeft: boolean, canGoRight: boolean): SwipeDirection | null {
  if (dx > SWIPE_COMMIT_DISTANCE && canGoLeft) {
    return -1;
  }

  if (dx < -SWIPE_COMMIT_DISTANCE && canGoRight) {
    return 1;
  }

  return null;
}

function stopTranslateAnimation(translateX: Animated.Value): void {
  if (typeof translateX.stopAnimation === 'function') {
    translateX.stopAnimation();
  }
}

function getPreviewCardWidth(isCluster: boolean, viewportWidth: number): number {
  if (Platform.OS === 'web') {
    return Math.min(COMPACT_CLUSTER_CARD_WIDTH, Math.round(viewportWidth * 0.85));
  }

  if (isCluster) {
    return COMPACT_CLUSTER_CARD_WIDTH;
  }

  return CARD_WIDTH;
}

function toPreviewData(property: GroupPreviewCardProps['properties'][number]) {
  return {
    id: property.id,
    address: property.address,
    streetName: property.streetName,
    houseNumber: property.houseNumber,
    houseNumberAddition: property.houseNumberAddition,
    city: property.city,
    postalCode: property.postalCode,
    countryCode: property.countryCode,
    officialValuation: property.officialValuation,
    officialValuationYear: property.officialValuationYear,
    askingPrice: property.askingPrice,
    fmv: property.fmv,
    activityLevel: property.activityLevel,
    activityScore: property.activityScore,
    thumbnailUrl: property.thumbnailUrl,
    aerialImageUrl: property.aerialImageUrl,
    likeCount: property.likeCount,
    commentCount: property.commentCount,
    guessCount: property.guessCount,
  };
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
  const [transitionAnchorIndex, setTransitionAnchorIndex] = useState<number | null>(null);
  const webSwipeStateRef = useRef<WebSwipeState | null>(null);
  const suppressWebPressUntilRef = useRef(0);

  const cardWidth = getPreviewCardWidth(isCluster, viewportWidth);

  const animateBackToCurrent = useCallback(() => {
    if (reducedMotion) {
      translateX.setValue(0);
      return;
    }

    Animated.timing(translateX, {
      toValue: 0,
      duration: SWIPE_SNAP_DURATION_MS,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, translateX]);

  const navigateBy = useCallback((direction: SwipeDirection) => {
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= properties.length) {
      animateBackToCurrent();
      return;
    }

    stopTranslateAnimation(translateX);

    if (reducedMotion) {
      translateX.setValue(0);
      onIndexChange?.(targetIndex);
      return;
    }

    setTransitionAnchorIndex(currentIndex);
    Animated.timing(translateX, {
      toValue: direction > 0 ? -cardWidth : cardWidth,
      duration: SWIPE_TRANSITION_DURATION_MS,
      useNativeDriver: true,
    }).start(() => {
      translateX.setValue(0);
      setTransitionAnchorIndex(null);
    });

    onIndexChange?.(targetIndex);
  }, [
    animateBackToCurrent,
    cardWidth,
    currentIndex,
    onIndexChange,
    properties.length,
    reducedMotion,
    translateX,
  ]);

  const goLeft = useCallback(() => {
    if (!canGoLeft) return;
    navigateBy(-1);
  }, [canGoLeft, navigateBy]);

  const goRight = useCallback(() => {
    if (!canGoRight) return;
    navigateBy(1);
  }, [canGoRight, navigateBy]);

  // Refs to hold latest navigation state — read inside PanResponder to avoid stale closures
  const canGoLeftRef = useRef(canGoLeft);
  const canGoRightRef = useRef(canGoRight);
  const animateBackToCurrentRef = useRef(animateBackToCurrent);
  const goLeftRef = useRef(goLeft);
  const goRightRef = useRef(goRight);
  const cardWidthRef = useRef(cardWidth);
  canGoLeftRef.current = canGoLeft;
  canGoRightRef.current = canGoRight;
  animateBackToCurrentRef.current = animateBackToCurrent;
  goLeftRef.current = goLeft;
  goRightRef.current = goRight;
  cardWidthRef.current = cardWidth;

  const getTouchPoint = useCallback((event: GestureResponderEvent) => {
    const nativeEvent = event.nativeEvent;
    return nativeEvent.touches[0] ?? nativeEvent.changedTouches[0] ?? null;
  }, []);

  const suppressNextWebPress = useCallback(() => {
    suppressWebPressUntilRef.current = Date.now() + 350;
  }, []);

  const handleWebTouchStart = useCallback((event: GestureResponderEvent) => {
    if (Platform.OS !== 'web' || !isCluster) return;

    const touch = getTouchPoint(event);
    if (!touch) return;

    stopTranslateAnimation(translateX);
    webSwipeStateRef.current = {
      startX: touch.pageX,
      startY: touch.pageY,
      lastX: touch.pageX,
      lastTimestamp: Date.now(),
      claimed: false,
    };
  }, [getTouchPoint, isCluster, translateX]);

  const handleWebTouchMove = useCallback((event: GestureResponderEvent) => {
    if (Platform.OS !== 'web' || !isCluster) return;

    const state = webSwipeStateRef.current;
    const touch = getTouchPoint(event);
    if (!state || !touch) return;

    const now = Date.now();
    const elapsedMs = Math.max(now - state.lastTimestamp, 1);
    const dx = touch.pageX - state.startX;
    const dy = touch.pageY - state.startY;
    const vx = (touch.pageX - state.lastX) / elapsedMs;

    if (state.claimed || shouldClaimPreviewSwipe({ dx, dy, vx })) {
      state.claimed = true;
      event.stopPropagation();
      translateX.setValue(
        clampCarouselDrag(dx, canGoLeftRef.current, canGoRightRef.current, cardWidthRef.current)
      );
    }

    state.lastX = touch.pageX;
    state.lastTimestamp = now;
  }, [getTouchPoint, isCluster, translateX]);

  const handleWebTouchEnd = useCallback((event: GestureResponderEvent) => {
    if (Platform.OS !== 'web' || !isCluster) return;

    const state = webSwipeStateRef.current;
    const touch = getTouchPoint(event);
    webSwipeStateRef.current = null;
    if (!state || !touch) return;

    const dx = touch.pageX - state.startX;
    const dy = touch.pageY - state.startY;
    const claimed = state.claimed || shouldClaimPreviewSwipe({ dx, dy });
    if (!claimed) return;

    event.stopPropagation();
    suppressNextWebPress();

    const direction = getCommitDirection(dx, canGoLeftRef.current, canGoRightRef.current);
    if (direction === -1) {
      goLeftRef.current();
    } else if (direction === 1) {
      goRightRef.current();
    } else {
      animateBackToCurrent();
    }
  }, [animateBackToCurrent, getTouchPoint, isCluster, suppressNextWebPress]);

  const handleWebTouchCancel = useCallback(() => {
    if (Platform.OS !== 'web') return;
    webSwipeStateRef.current = null;
    animateBackToCurrent();
  }, [animateBackToCurrent]);

  const handlePropertyPress = useCallback((property: GroupPreviewCardProps['properties'][number]) => {
    if (Platform.OS === 'web' && Date.now() < suppressWebPressUntilRef.current) {
      return;
    }

    onPropertyTap?.(property);
  }, [onPropertyTap]);

  // PanResponder for swipe gestures
  // Guard against PanResponder being undefined in test environments
  const panResponder = useRef(
    PanResponder?.create?.({
      onStartShouldSetPanResponder: () => false, // Let Pressable handle taps; only claim horizontal drags.
      onMoveShouldSetPanResponder: (_, gs) => shouldClaimPreviewSwipe(gs),
      onPanResponderTerminationRequest: () => false, // Don't let map steal the gesture
      onPanResponderGrant: () => {
        stopTranslateAnimation(translateX);
      },
      onPanResponderMove: (_, gs) => {
        translateX.setValue(
          clampCarouselDrag(gs.dx, canGoLeftRef.current, canGoRightRef.current, cardWidthRef.current)
        );
      },
      onPanResponderRelease: (_, gs) => {
        const direction = getCommitDirection(gs.dx, canGoLeftRef.current, canGoRightRef.current);
        if (direction === -1) {
          goLeftRef.current();
        } else if (direction === 1) {
          goRightRef.current();
        } else {
          animateBackToCurrentRef.current();
        }
      },
    }) ?? { panHandlers: {} }
  ).current;

  // Reset translateX when index changes externally
  useEffect(() => {
    if (transitionAnchorIndex === null) {
      translateX.setValue(0);
    }
  }, [currentIndex, transitionAnchorIndex, translateX]);

  useEffect(() => {
    if (!isCluster) {
      return;
    }

    const urls = new Set<string>();
    for (const adjacentIndex of [currentIndex - 1, currentIndex + 1]) {
      const adjacentProperty = properties[adjacentIndex];
      if (!adjacentProperty) {
        continue;
      }

      const candidates = getPropertyImageCandidates(toPropertyImageSource(adjacentProperty));
      for (const candidate of candidates) {
        urls.add(candidate.url);
      }
    }

    for (const url of urls) {
      try {
        void Image.prefetch(url).catch(() => undefined);
      } catch {
        // Image prefetching is best-effort and must not affect preview rendering.
      }
    }
  }, [currentIndex, isCluster, properties]);

  if (!currentProperty) return null;

  const arrowUp = arrowDirection === 'up';
  const carouselIndex = transitionAnchorIndex ?? currentIndex;
  const visibleStartIndex = isCluster ? Math.max(0, carouselIndex - 1) : carouselIndex;
  const visibleEndIndex = isCluster ? Math.min(properties.length - 1, carouselIndex + 1) : carouselIndex;
  const currentCarouselOffset = (carouselIndex - visibleStartIndex) * cardWidth;
  const visibleProperties = properties.slice(visibleStartIndex, visibleEndIndex + 1);

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
        testID="group-preview-card-container"
        collapsable={false}
      >

        <View style={styles.carouselViewport} testID="group-preview-carousel-viewport">
          {/* Property card content with swipe */}
          <Animated.View
            testID="group-preview-swipe-surface"
            style={[
              styles.carouselTrack,
              { width: visibleProperties.length * cardWidth },
              isCluster ? { transform: [{ translateX: -currentCarouselOffset }, { translateX }] } : {},
              Platform.OS === 'web' && isCluster ? WEB_SWIPE_TOUCH_STYLE : null,
            ]}
            onTouchStart={Platform.OS === 'web' && isCluster ? handleWebTouchStart : undefined}
            onTouchMove={Platform.OS === 'web' && isCluster ? handleWebTouchMove : undefined}
            onTouchEnd={Platform.OS === 'web' && isCluster ? handleWebTouchEnd : undefined}
            onTouchCancel={Platform.OS === 'web' && isCluster ? handleWebTouchCancel : undefined}
            {...(isCluster && Platform.OS !== 'web' ? panResponder.panHandlers : {})}
          >
            {visibleProperties.map((property, visibleOffset) => {
              const propertyIndex = visibleStartIndex + visibleOffset;
              const isCurrentCard = propertyIndex === carouselIndex;
              const previewData = toPreviewData(property);

              return (
                <View
                  key={property.id}
                  pointerEvents={isCurrentCard ? 'auto' : 'none'}
                  style={[styles.carouselItem, { width: cardWidth, flexBasis: cardWidth }]}
                  testID={
                    isCurrentCard
                      ? 'group-preview-active-card'
                      : 'group-preview-adjacent-card'
                  }
                >
                  <PropertyPreviewCard
                    property={previewData}
                    isLiked={isCurrentCard ? isLiked : false}
                    onPress={isCurrentCard ? () => handlePropertyPress(property) : undefined}
                    onLike={isCurrentCard ? () => onLike?.(property) : undefined}
                    onComment={isCurrentCard ? () => onComment?.(property) : undefined}
                    onGuess={isCurrentCard ? () => onGuess?.(property) : undefined}
                    onClose={isCurrentCard ? onClose : undefined}
                    showCloseButton={isCurrentCard && !!onClose}
                    closeButtonTestID="group-preview-close-button"
                  />
                </View>
              );
            })}
          </Animated.View>
        </View>

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
    alignSelf: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  cardContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
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
  carouselViewport: {
    width: '100%',
    overflow: 'hidden',
  },
  carouselTrack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexShrink: 0,
  },
  carouselItem: {
    flexShrink: 0,
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
