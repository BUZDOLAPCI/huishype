import { useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Pressable,
  Text,
  View,
  Image,
  Platform,
  Animated,
  PanResponder,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GroupPreviewCardProps, GroupPreviewProperty } from './types';

const CARD_WIDTH = 320;
const THUMBNAIL_SIZE = 56;

/** Maximum movement (px) to still count as a tap, not a drag. */
const TAP_MOVE_THRESHOLD = 40;
/** Maximum duration (ms) for a touch to count as a tap. */
const TAP_DURATION_THRESHOLD = 500;

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

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatPrice(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `\u20AC${value.toLocaleString('nl-NL')}`;
}

function getPriceLabel(property: GroupPreviewProperty): string {
  if (property.fmv != null) return 'FMV';
  if (property.askingPrice != null) return 'Ask';
  if (property.wozValue != null) return 'WOZ';
  return '';
}

function getDisplayPrice(property: GroupPreviewProperty): number | null {
  return property.fmv ?? property.askingPrice ?? property.wozValue ?? null;
}

const ACTIVITY_CONFIG = {
  hot: { color: '#EF4444', label: 'Hot', bg: '#EF4444' },
  warm: { color: '#FB923C', label: 'Active', bg: '#FB923C' },
  cold: { color: '#D1D5DB', label: 'Quiet', bg: '#D1D5DB' },
} as const;

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

// ─── PropertyCardContent ─────────────────────────────────────────────────

/** Single property card content — shared between single and cluster modes. */
function PropertyCardContent({
  property,
  isLiked = false,
  onPress,
  onLike,
  onComment,
  onGuess,
  zoneRef,
  zoneLayout,
}: {
  property: GroupPreviewProperty;
  isLiked: boolean;
  onPress?: () => void;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
  /** Callback ref generator for native hit-testing zones (undefined on web). */
  zoneRef?: (zone: HitZone) => (node: any) => void;
  /** Layout handler generator for native hit-testing zones (undefined on web). */
  zoneLayout?: (zone: HitZone) => () => void;
}) {
  const displayPrice = getDisplayPrice(property);
  const priceLabel = getPriceLabel(property);
  const formattedPrice = formatPrice(displayPrice);
  const activity = ACTIVITY_CONFIG[property.activityLevel ?? 'cold'];

  return (
    <Pressable
      onPress={onPress}
      ref={zoneRef?.('cardBody')}
      onLayout={zoneLayout?.('cardBody')}
      collapsable={zoneRef ? false : undefined}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 12,
        width: '100%',
      }}
      testID="group-preview-property-card"
    >
      {/* Top: Thumbnail + Info */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {/* Thumbnail */}
        <View
          style={{
            width: THUMBNAIL_SIZE,
            height: THUMBNAIL_SIZE,
            minWidth: THUMBNAIL_SIZE,
            borderRadius: 8,
            backgroundColor: '#E5E7EB',
            overflow: 'hidden',
            flexShrink: 0,
            marginRight: 10,
          }}
        >
          {property.thumbnailUrl ? (
            <Image
              source={{ uri: property.thumbnailUrl }}
              style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
              resizeMode="cover"
              testID="group-preview-thumbnail"
            />
          ) : (
            <View
              style={{
                width: THUMBNAIL_SIZE,
                height: THUMBNAIL_SIZE,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="home-outline" size={22} color="#9CA3AF" />
            </View>
          )}
        </View>

        {/* Address + Price */}
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 2,
            }}
          >
            <Text
              style={{ flex: 1, fontSize: 15, fontWeight: '600', color: '#111827' }}
              numberOfLines={1}
            >
              {property.address}
            </Text>
            {/* Activity dot + label */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 6 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: activity.bg,
                  marginRight: 3,
                }}
              />
              <Text style={{ fontSize: 11, color: '#9CA3AF' }}>{activity.label}</Text>
            </View>
          </View>

          <Text style={{ fontSize: 13, color: '#6B7280' }} numberOfLines={1}>
            {property.city}
            {property.postalCode ? `, ${property.postalCode}` : ''}
          </Text>

          {formattedPrice && (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 3 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#2563EB' }}>
                {formattedPrice}
              </Text>
              <Text style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 4 }}>
                {priceLabel}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Quick actions */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          borderTopWidth: 1,
          borderTopColor: '#F3F4F6',
          paddingTop: 8,
          marginTop: 10,
        }}
      >
        <Pressable
          onPress={() => onLike?.()}
          ref={zoneRef?.('like')}
          onLayout={zoneLayout?.('like')}
          collapsable={zoneRef ? false : undefined}
          style={{
            minHeight: 40,
            minWidth: 40,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            paddingVertical: 6,
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="group-preview-like-button"
        >
          <Ionicons
            name={isLiked ? 'heart' : 'heart-outline'}
            size={18}
            color={isLiked ? '#EF4444' : '#6B7280'}
          />
          <Text
            style={{
              marginLeft: 4,
              fontSize: 13,
              color: isLiked ? '#EF4444' : '#4B5563',
            }}
          >
            {isLiked ? 'Liked' : 'Like'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onComment?.()}
          ref={zoneRef?.('comment')}
          onLayout={zoneLayout?.('comment')}
          collapsable={zoneRef ? false : undefined}
          style={{
            minHeight: 40,
            minWidth: 40,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            paddingVertical: 6,
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="group-preview-comment-button"
        >
          <Ionicons name="chatbubble-outline" size={18} color="#6B7280" />
          <Text style={{ marginLeft: 4, fontSize: 13, color: '#4B5563' }}>Comment</Text>
        </Pressable>

        <Pressable
          onPress={() => onGuess?.()}
          ref={zoneRef?.('guess')}
          onLayout={zoneLayout?.('guess')}
          collapsable={zoneRef ? false : undefined}
          style={{
            minHeight: 40,
            minWidth: 40,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            paddingVertical: 6,
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="group-preview-guess-button"
        >
          <Ionicons name="pricetag-outline" size={18} color="#6B7280" />
          <Text style={{ marginLeft: 4, fontSize: 13, color: '#4B5563' }}>Guess</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── GroupPreviewCard ────────────────────────────────────────────────────

/**
 * GroupPreviewCard — unified preview card for both single properties and clusters.
 *
 * - Single (1 property): shows card content + close button
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

  const canGoLeft = currentIndex > 0;
  const canGoRight = currentIndex < properties.length - 1;

  // Animation for swipe
  const translateX = useRef(new Animated.Value(0)).current;

  const goLeft = useCallback(() => {
    if (!canGoLeft) return;
    translateX.setValue(-40);
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
    }).start();
    onIndexChange?.(currentIndex - 1);
  }, [canGoLeft, currentIndex, onIndexChange, translateX]);

  const goRight = useCallback(() => {
    if (!canGoRight) return;
    translateX.setValue(40);
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
    }).start();
    onIndexChange?.(currentIndex + 1);
  }, [canGoRight, currentIndex, onIndexChange, translateX]);

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

  const cardBody = (
    <View
      style={{
        width: CARD_WIDTH,
        maxWidth: '92%',
        alignSelf: 'center',
        position: 'relative',
        overflow: 'visible',
      }}
      testID="group-preview-card"
    >
      {/* Arrow pointing up */}
      {showArrow && arrowUp && (
        <View
          style={{
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
            ...(Platform.OS === 'web'
              ? { filter: 'drop-shadow(0px -2px 3px rgba(0,0,0,0.08))' }
              : {}),
          }}
          testID="group-preview-arrow-up"
        />
      )}

      {/* Main card container with shadow (L2 — overlay captures touches on native) */}
      <View
        ref={isNative ? l2Ref : undefined}
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 14,
          boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.18)',
          elevation: 6,
          overflow: 'hidden',
          position: 'relative',
        }}
        collapsable={false}
      >
        {/* Close button - top right corner */}
        <Pressable
          onPress={onClose}
          ref={isNative ? hitTest.zoneRef('close') : undefined}
          onLayout={isNative ? hitTest.zoneLayout('close') : undefined}
          collapsable={isNative ? false : undefined}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            zIndex: 20,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: 'rgba(0,0,0,0.35)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          testID="group-preview-close-button"
          accessibilityLabel="Close preview"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={16} color="#FFFFFF" />
        </Pressable>

        {/* Cluster navigation header */}
        {isCluster && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 10,
              paddingBottom: 2,
              paddingHorizontal: 40, // space for close button
              gap: 8,
            }}
          >
            {/* Left arrow */}
            <Pressable
              onPress={goLeft}
              ref={isNative ? hitTest.zoneRef('navLeft') : undefined}
              onLayout={isNative ? hitTest.zoneLayout('navLeft') : undefined}
              collapsable={isNative ? false : undefined}
              disabled={!canGoLeft}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: canGoLeft ? '#F97316' : '#E5E7EB',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              testID="group-preview-nav-left"
              accessibilityLabel="Previous property"
              accessibilityRole="button"
            >
              <Ionicons
                name="chevron-back"
                size={18}
                color={canGoLeft ? '#FFFFFF' : '#9CA3AF'}
              />
            </Pressable>

            {/* Page indicator */}
            <View
              style={{
                backgroundColor: '#1F2937',
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 4,
              }}
              testID="group-preview-page-indicator"
            >
              <Text
                style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}
                testID="group-preview-page-text"
              >
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
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: canGoRight ? '#F97316' : '#E5E7EB',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              testID="group-preview-nav-right"
              accessibilityLabel="Next property"
              accessibilityRole="button"
            >
              <Ionicons
                name="chevron-forward"
                size={18}
                color={canGoRight ? '#FFFFFF' : '#9CA3AF'}
              />
            </Pressable>
          </View>
        )}

        {/* Property card content with swipe */}
        <Animated.View
          style={[
            { paddingHorizontal: 0, paddingTop: isCluster ? 4 : 0 },
            isCluster ? { transform: [{ translateX }] } : {},
          ]}
          {...(isCluster && !isNative ? panResponder.panHandlers : {})}
        >
          <PropertyCardContent
            property={currentProperty}
            isLiked={isLiked}
            onPress={() => onPropertyTap?.(currentProperty)}
            onLike={() => onLike?.(currentProperty)}
            onComment={() => onComment?.(currentProperty)}
            onGuess={() => onGuess?.(currentProperty)}
            zoneRef={isNative ? hitTest.zoneRef : undefined}
            zoneLayout={isNative ? hitTest.zoneLayout : undefined}
          />
        </Animated.View>

        {/* Transparent touch overlay — captures ALL touches on native (Android
            inside MapLibre Marker). locationX/locationY from this overlay are
            L2-relative, matching measureLayout zone bounds exactly. */}
        {isNative && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 100,
              backgroundColor: 'transparent',
            }}
            collapsable={false}
            onTouchStart={onOverlayTouchStart}
            onTouchMove={onOverlayTouchMove}
            onTouchEnd={onOverlayTouchEnd}
            testID="group-preview-touch-overlay"
          />
        )}
      </View>

      {/* Arrow pointing down */}
      {showArrow && !arrowUp && (
        <View
          style={{
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
            ...(Platform.OS === 'web'
              ? { filter: 'drop-shadow(0px 2px 3px rgba(0,0,0,0.08))' }
              : {}),
          }}
          testID="group-preview-arrow-down"
        />
      )}
    </View>
  );

  return cardBody;
}
