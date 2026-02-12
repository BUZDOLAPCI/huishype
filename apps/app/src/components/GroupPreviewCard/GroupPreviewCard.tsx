import { useCallback, useRef, useEffect } from 'react';
import {
  Pressable,
  Text,
  View,
  Image,
  Platform,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GroupPreviewCardProps, GroupPreviewProperty } from './types';

const CARD_WIDTH = 320;
const THUMBNAIL_SIZE = 56;

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

/** Single property card content — shared between single and cluster modes. */
function PropertyCardContent({
  property,
  isLiked = false,
  onPress,
  onLike,
  onComment,
  onGuess,
}: {
  property: GroupPreviewProperty;
  isLiked: boolean;
  onPress?: () => void;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
}) {
  const displayPrice = getDisplayPrice(property);
  const priceLabel = getPriceLabel(property);
  const formattedPrice = formatPrice(displayPrice);
  const activity = ACTIVITY_CONFIG[property.activityLevel ?? 'cold'];

  return (
    <Pressable
      onPress={onPress}
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
          onPress={(e) => {
            e?.stopPropagation?.();
            onLike?.();
          }}
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
          onPress={(e) => {
            e?.stopPropagation?.();
            onComment?.();
          }}
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
          onPress={(e) => {
            e?.stopPropagation?.();
            onGuess?.();
          }}
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

/**
 * GroupPreviewCard — unified preview card for both single properties and clusters.
 *
 * - Single (1 property): shows card content + close button
 * - Cluster (>1 properties): adds left/right arrows, page indicator, swipe gestures
 * - Optional arrow pointer to visually connect to map marker
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
}: GroupPreviewCardProps) {
  const isCluster = properties.length > 1;
  const currentIndex = controlledIndex ?? 0;
  const currentProperty = properties[currentIndex];

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

  // PanResponder for swipe gestures (cluster only)
  // Guard against PanResponder being undefined in test environments
  const panResponder = useRef(
    PanResponder?.create?.({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 10 && Math.abs(gs.dy) < 30,
      onPanResponderMove: (_, gs) => {
        translateX.setValue(Math.max(-80, Math.min(80, gs.dx)));
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 40 && canGoLeft) {
          goLeft();
        } else if (gs.dx < -40 && canGoRight) {
          goRight();
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

      {/* Main card container with shadow */}
      <View
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 14,
          boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.18)',
          elevation: 6,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Close button - top right corner */}
        <Pressable
          onPress={onClose}
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
          {...(isCluster ? panResponder.panHandlers : {})}
        >
          <PropertyCardContent
            property={currentProperty}
            isLiked={isLiked}
            onPress={() => onPropertyTap?.(currentProperty)}
            onLike={() => onLike?.(currentProperty)}
            onComment={() => onComment?.(currentProperty)}
            onGuess={() => onGuess?.(currentProperty)}
          />
        </Animated.View>
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
