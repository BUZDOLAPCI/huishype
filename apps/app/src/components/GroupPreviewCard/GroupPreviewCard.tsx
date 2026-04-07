import { useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Pressable,
  Text,
  View,
  Platform,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { Icon } from '../ui/Icon';
import { PropertyPreviewCard } from '../PropertyPreviewCard';
import type { GroupPreviewCardProps, GroupPreviewProperty } from './types';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

const CARD_WIDTH = 270;

/** Maximum movement (px) to still count as a tap, not a drag. */
const TAP_MOVE_THRESHOLD = 40;
/** Maximum duration (ms) for a touch to count as a tap. */
const TAP_DURATION_THRESHOLD = 500;

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

// ─── Coordinate-based hit-testing types ──────────────────────────────────

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type HitZone =
  | 'close'
  | 'navLeft'
  | 'navRight'
  | 'like'
  | 'comment'
  | 'guess'
  | 'cardBody';

/**
 * Check whether a point (px, py) falls inside a rectangle.
 */
function pointInRect(px: number, py: number, rect: Rect): boolean {
  return (
    px >= rect.x &&
    px <= rect.x + rect.width &&
    py >= rect.y &&
    py <= rect.y + rect.height
  );
}

/** Minimum horizontal movement (px) before a swipe gesture is recognized. */
const SWIPE_THRESHOLD = 40;
/** Maximum horizontal drag distance (px) for the swipe animation. */
const SWIPE_MAX_DRAG = 80;

// ─── useMarkerHitTest hook ───────────────────────────────────────────────

/**
 * Coordinate-based hit-testing system for use inside MapLibre <Marker> on
 * Android where Pressable.onPress does not fire due to Fabric limitations.
 *
 * Uses `measureLayout` to get each zone's bounds **relative to the L2
 * container**. A transparent overlay View (rendered as the last child of L2
 * on native) captures all touches. Because the overlay is position:absolute
 * covering L2, `locationX`/`locationY` from the overlay's touch events are
 * L2-relative — matching the `measureLayout` coordinate space exactly. This
 * avoids the broken `measure()` path that returns Marker-container-relative
 * coordinates inside MapLibre Markers.
 *
 * This is a "belt and suspenders" approach: Pressable components remain in the
 * tree (for accessibility, test compatibility, and web), but on native the
 * overlay captures taps and dispatches them. In the real Marker scenario,
 * only the overlay handler fires; in tests, fireEvent.press on Pressable
 * still works.
 */
function useMarkerHitTest(translateX: Animated.Value) {
  const boundsMap = useRef<Record<string, Rect>>({});
  const l2Ref = useRef<View>(null);
  const zoneNodes = useRef<Record<string, any>>({});

  const touchStart = useRef<{
    locX: number;
    locY: number;
    pageX: number;
    pageY: number;
    ts: number;
  } | null>(null);

  /** Re-measure ALL zone positions relative to L2 container. */
  const remeasureAll = useCallback(() => {
    const l2 = l2Ref.current;
    if (!l2) return;
    for (const [zone, node] of Object.entries(zoneNodes.current)) {
      if (node?.measureLayout) {
        try {
          node.measureLayout(
            l2,
            (x: number, y: number, width: number, height: number) => {
              boundsMap.current[zone] = { x, y, width, height };
            },
            () => {
              // measureLayout failed — view may be detached
            }
          );
        } catch {
          // measureLayout can throw if views are detached
        }
      }
    }
  }, []);

  /**
   * Returns a callback ref for a zone element that stores the native node.
   *
   * NOTE: We return individual functions instead of a spreadable object because
   * `{...{ref: fn}}` does NOT reliably forward refs to Pressable components
   * on React Native Fabric (New Architecture). Only explicit `ref={fn}` works.
   */
  const zoneRef = useCallback(
    (zone: HitZone) => (node: any) => {
      zoneNodes.current[zone] = node;
    },
    []
  );

  const zoneLayout = useCallback(
    (_zone: HitZone) => () => {
      remeasureAll();
    },
    [remeasureAll]
  );

  /**
   * Call on the overlay's onTouchStart.
   * Stores locationX/locationY (overlay-relative = L2-relative) plus
   * pageX/pageY for swipe delta calculation.
   */
  const handleTouchStart = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = e.nativeEvent;
    touchStart.current = {
      locX: locationX,
      locY: locationY,
      pageX,
      pageY,
      ts: Date.now(),
    };
  }, []);

  /**
   * Call on the overlay's onTouchMove.
   * Drives the swipe animation using page-coordinate deltas.
   */
  const handleTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      const start = touchStart.current;
      if (!start) return;
      const dx = e.nativeEvent.pageX - start.pageX;
      translateX.setValue(
        Math.max(-SWIPE_MAX_DRAG, Math.min(SWIPE_MAX_DRAG, dx))
      );
    },
    [translateX]
  );

  /**
   * Call on the overlay's onTouchEnd.
   * Returns `{ zone, dx }` where `zone` is the hit zone name if it was a
   * valid tap, or null otherwise. `dx` is the horizontal swipe distance.
   */
  const handleTouchEnd = useCallback(
    (
      e: GestureResponderEvent
    ): { zone: HitZone | null; dx: number } => {
      const start = touchStart.current;
      if (!start) return { zone: null, dx: 0 };
      touchStart.current = null;

      const endLocX = e.nativeEvent.locationX;
      const endLocY = e.nativeEvent.locationY;
      const endPageX = e.nativeEvent.pageX;
      const endPageY = e.nativeEvent.pageY;
      const duration = Date.now() - start.ts;
      const dx = endPageX - start.pageX;
      const dy = endPageY - start.pageY;

      // Check tap criteria using page coordinates (consistent regardless of target)
      if (
        Math.abs(dx) > TAP_MOVE_THRESHOLD ||
        Math.abs(dy) > TAP_MOVE_THRESHOLD
      ) {
        return { zone: null, dx };
      }
      if (duration > TAP_DURATION_THRESHOLD) {
        return { zone: null, dx };
      }

      // locationX/locationY from the overlay are L2-relative — use directly
      const hitX = endLocX;
      const hitY = endLocY;

      // Hit-test in priority order (smallest / most specific first)
      const priorityOrder: HitZone[] = [
        'close',
        'navLeft',
        'navRight',
        'like',
        'comment',
        'guess',
        'cardBody',
      ];

      for (const zone of priorityOrder) {
        const rect = boundsMap.current[zone];
        if (rect && pointInRect(hitX, hitY, rect)) {
          return { zone, dx };
        }
      }

      // If no specific zone matched, treat as card body tap
      return { zone: 'cardBody', dx };
    },
    []
  );

  return {
    l2Ref,
    zoneRef,
    zoneLayout,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}

// ─── GroupPreviewCard ────────────────────────────────────────────────────

/**
 * GroupPreviewCard — unified preview card for both single properties and clusters.
 *
 * - Single (1 property): shows PropertyPreviewCard content + close button
 * - Cluster (>1 properties): adds left/right arrows, page indicator, swipe gestures
 * - Optional arrow pointer to visually connect to map marker
 *
 * On native (Android inside MapLibre <Marker>), Pressable.onPress does not fire
 * due to Fabric touch dispatch limitations. All tap interactions are ALSO handled
 * via coordinate-based hit-testing at the L2 (main card container) level using
 * onTouchStart/onTouchEnd. Pressable components remain in the tree for
 * accessibility, web compatibility, and test compatibility.
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

  const isNative = Platform.OS !== 'web';
  const reducedMotion = useReducedMotion();

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
      onStartShouldSetPanResponder: () => false, // Don't claim taps — let hit-test / Pressable handle them
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 10 && Math.abs(gs.dy) < 30,
      onPanResponderTerminationRequest: () => false, // Don't let map steal the gesture
      onPanResponderMove: (_, gs) => {
        translateX.setValue(Math.max(-80, Math.min(80, gs.dx)));
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

  // ── Coordinate-based hit-testing (native only) ───────────────────────

  const hitTest = useMarkerHitTest(translateX);
  const { l2Ref } = hitTest;

  // Stable refs for callbacks used in the hit-test handler
  const onCloseRef = useRef(onClose);
  const onPropertyTapRef = useRef(onPropertyTap);
  const onLikeRef = useRef(onLike);
  const onCommentRef = useRef(onComment);
  const onGuessRef = useRef(onGuess);
  const currentPropertyRef = useRef(currentProperty);
  onCloseRef.current = onClose;
  onPropertyTapRef.current = onPropertyTap;
  onLikeRef.current = onLike;
  onCommentRef.current = onComment;
  onGuessRef.current = onGuess;
  currentPropertyRef.current = currentProperty;

  /** Dispatch a tap hit to the appropriate callback. */
  const dispatchHit = useCallback((zone: HitZone) => {
    const prop = currentPropertyRef.current;
    if (!prop) return;

    switch (zone) {
      case 'close':
        onCloseRef.current();
        break;
      case 'navLeft':
        goLeftRef.current();
        break;
      case 'navRight':
        goRightRef.current();
        break;
      case 'like':
        onLikeRef.current?.(prop);
        break;
      case 'comment':
        onCommentRef.current?.(prop);
        break;
      case 'guess':
        onGuessRef.current?.(prop);
        break;
      case 'cardBody':
        onPropertyTapRef.current?.(prop);
        break;
    }
  }, []);

  // Ref for onTouchStart callback prop so overlay handler stays stable
  const onTouchStartRef = useRef(onTouchStart);
  onTouchStartRef.current = onTouchStart;

  /** Overlay onTouchStart — record position + notify parent. */
  const onOverlayTouchStart = useMemo(() => {
    if (!isNative) return undefined;
    return (e: GestureResponderEvent) => {
      onTouchStartRef.current?.();
      hitTest.handleTouchStart(e);
    };
  }, [isNative, hitTest]);

  /** Overlay onTouchMove — drive swipe animation. */
  const onOverlayTouchMove = useMemo(() => {
    if (!isNative || !isCluster) return undefined;
    return (e: GestureResponderEvent) => {
      hitTest.handleTouchMove(e);
    };
  }, [isNative, isCluster, hitTest]);

  /** Overlay onTouchEnd — hit-test / swipe dispatch. */
  const onOverlayTouchEnd = useMemo(() => {
    if (!isNative) return undefined;
    return (e: GestureResponderEvent) => {
      const { zone, dx } = hitTest.handleTouchEnd(e);

      // Check for swipe gestures first (cluster mode only)
      if (isCluster && Math.abs(dx) > SWIPE_THRESHOLD) {
        if (dx > 0 && canGoLeftRef.current) {
          goLeftRef.current();
          return;
        } else if (dx < 0 && canGoRightRef.current) {
          goRightRef.current();
          return;
        }
        // Swipe attempted but cannot navigate — spring back
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
        }).start();
        return;
      }

      // Not a swipe — spring back and dispatch tap if valid
      if (isCluster) {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
        }).start();
      }

      if (zone) {
        dispatchHit(zone);
      }
    };
  }, [isNative, isCluster, hitTest, dispatchHit, translateX]);

  if (!currentProperty) return null;

  const arrowUp = arrowDirection === 'up';

  // Convert GroupPreviewProperty to PropertyPreviewData for the content card
  const previewData = {
    id: currentProperty.id,
    address: currentProperty.address,
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
      ref={isNative ? l2Ref : undefined}
      style={styles.outerWrapper}
      collapsable={isNative ? false : undefined}
      testID="group-preview-card"
    >
      {/* Arrow pointing up */}
      {showArrow && arrowUp && (
        <View
          style={[
            styles.arrowUp,
            Platform.OS === 'web'
              ? { filter: 'drop-shadow(0px -2px 3px rgba(0,0,0,0.08))' } as any
              : {},
          ]}
          testID="group-preview-arrow-up"
        />
      )}

      {/* Cluster navigation header — floats above the card content */}
      {isCluster && (
        <View style={styles.clusterHeader}>
          {/* Left arrow */}
          <Pressable
            onPress={goLeft}
            ref={isNative ? hitTest.zoneRef('navLeft') : undefined}
            onLayout={isNative ? hitTest.zoneLayout('navLeft') : undefined}
            collapsable={isNative ? false : undefined}
            disabled={!canGoLeft}
            hitSlop={6}
            style={[
              styles.navArrow,
              { backgroundColor: canGoLeft ? COLORS.gold500 : COLORS.warm200 },
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
              color={canGoLeft ? COLORS.white : COLORS.warm400}
            />
          </Pressable>

          {/* Page indicator pill */}
          <View style={styles.pageIndicator} testID="group-preview-page-indicator">
            <Icon name="ListBullets" size={14} color={COLORS.white} />
            <Text style={styles.pageText} testID="group-preview-page-text">
              {currentIndex + 1} of {properties.length}
            </Text>
          </View>

          {/* Right arrow */}
          <Pressable
            onPress={goRight}
            ref={isNative ? hitTest.zoneRef('navRight') : undefined}
            onLayout={isNative ? hitTest.zoneLayout('navRight') : undefined}
            collapsable={isNative ? false : undefined}
            disabled={!canGoRight}
            hitSlop={6}
            style={[
              styles.navArrow,
              { backgroundColor: canGoRight ? COLORS.gold500 : COLORS.warm200 },
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
              color={canGoRight ? COLORS.white : COLORS.warm400}
            />
          </Pressable>
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
          {...(isCluster && !isNative ? panResponder.panHandlers : {})}
        >
          <View
            ref={isNative ? hitTest.zoneRef('cardBody') : undefined}
            onLayout={isNative ? hitTest.zoneLayout('cardBody') : undefined}
            collapsable={isNative ? false : undefined}
          >
            <PropertyPreviewCard
              property={previewData}
              isLiked={isLiked}
              onPress={() => onPropertyTap?.(currentProperty)}
              onLike={() => onLike?.(currentProperty)}
              onComment={() => onComment?.(currentProperty)}
              onGuess={() => onGuess?.(currentProperty)}
              onClose={onClose}
              showCloseButton={!isCluster}
            />
          </View>

          {/* Hit-test zone refs for native action buttons — wrapped around the actual Pressables
              inside PropertyPreviewCard. Since PropertyPreviewCard renders the buttons,
              we register hit zones via overlay refs on the outer action row. */}
          {isNative && (
            <>
              <View
                ref={hitTest.zoneRef('like')}
                onLayout={hitTest.zoneLayout('like')}
                collapsable={false}
                style={styles.hitZoneMarker}
                testID="group-preview-like-hitzone"
              />
              <View
                ref={hitTest.zoneRef('comment')}
                onLayout={hitTest.zoneLayout('comment')}
                collapsable={false}
                style={styles.hitZoneMarker}
                testID="group-preview-comment-hitzone"
              />
              <View
                ref={hitTest.zoneRef('guess')}
                onLayout={hitTest.zoneLayout('guess')}
                collapsable={false}
                style={styles.hitZoneMarker}
                testID="group-preview-guess-hitzone"
              />
            </>
          )}
        </Animated.View>

        {/* Close button — in cluster mode, positioned over the image area */}
        {isCluster && (
          <Pressable
            onPress={onClose}
            ref={isNative ? hitTest.zoneRef('close') : undefined}
            onLayout={isNative ? hitTest.zoneLayout('close') : undefined}
            collapsable={isNative ? false : undefined}
            style={styles.clusterCloseButton}
            hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
            testID="group-preview-close-button"
            accessibilityLabel="Close preview"
            accessibilityHint="Closes this property preview card"
            accessibilityRole="button"
          >
            <Icon name="X" size={14} color={COLORS.warm700} />
          </Pressable>
        )}

        {/* For single property mode, register the close button from PropertyPreviewCard
            for hit testing (it renders inside PropertyPreviewCard) */}
        {!isCluster && isNative && (
          <View
            ref={hitTest.zoneRef('close')}
            onLayout={hitTest.zoneLayout('close')}
            collapsable={false}
            style={styles.hitZoneMarker}
            testID="group-preview-close-hitzone"
          />
        )}

      </View>

      {/* Transparent touch overlay — captures ALL touches on native (Android
          inside MapLibre Marker). locationX/locationY from this overlay are
          outer-wrapper-relative, matching measureLayout zone bounds exactly. */}
      {isNative && (
        <View
          style={styles.touchOverlay}
          collapsable={false}
          onTouchStart={onOverlayTouchStart}
          onTouchMove={onOverlayTouchMove}
          onTouchEnd={onOverlayTouchEnd}
          testID="group-preview-touch-overlay"
        />
      )}

      {/* Arrow pointing down */}
      {showArrow && !arrowUp && (
        <View
          style={[
            styles.arrowDown,
            Platform.OS === 'web'
              ? { filter: 'drop-shadow(0px 2px 3px rgba(0,0,0,0.08))' } as any
              : {},
          ]}
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
    width: CARD_WIDTH,
    maxWidth: '85%',
    alignSelf: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  cardContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    // Preview shadow from design spec
    ...Platform.select({
      ios: {
        shadowColor: '#B47712',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
      },
      android: { elevation: 6 },
      default: {},
    }),
    // Web shadow
    ...(Platform.OS === 'web'
      ? { boxShadow: '0px 4px 20px rgba(180, 119, 18, 0.12)' } as any
      : {}),
  },

  // Cluster header
  clusterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingTop: 4,
    paddingBottom: 6,
    paddingHorizontal: 8,
    gap: 8,
  },
  navArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warm800,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 5,
  },
  pageText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },

  // Close button for cluster mode
  clusterCloseButton: {
    position: 'absolute',
    // Position over the image area in the card's top-right corner.
    top: 5,
    right: 5,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderWidth: 1,
    borderColor: '#F5F0E8',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },

  // Touch overlay for native hit-testing
  touchOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: 'transparent',
  },

  // Hidden hit-zone marker (zero-size, for native measureLayout registration)
  hitZoneMarker: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },

  // Arrow pointers
  arrowUp: {
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFFFFF',
    marginBottom: -1,
  },
  arrowDown: {
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
    marginTop: -1,
  },
});
