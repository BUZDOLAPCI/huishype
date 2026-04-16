/**
 * PropertyPreviewCard — Presentational single-property content for map preview cards.
 *
 * Matches the pen design (Preview Card Wrapper.jpg):
 *   - Full-width image area (100px) with close button overlay
 *   - Address row with activity dot
 *   - Stat pills (like count, comment count, price)
 *   - Quick actions (Like, Comment, Guess) separated by divider
 *   - Arrow pointer triangle pointing toward map feature
 *
 * This component is used by GroupPreviewCard as the content primitive.
 * It is NOT a standalone runtime owner of map preview state.
 *
 * Design spec: Section 7.6 (Preview Card).
 */

import { useEffect, useState } from 'react';
import { Pressable, Text, View, Platform, StyleSheet } from 'react-native';
import { Icon } from './ui/Icon';
import {
  formatPropertyPrice,
  getValuationLabel,
  type CountryCode,
} from '@huishype/shared';
import { getCountryConfig, isValidCountryCode } from '@huishype/shared/config';
import {
  toPropertyImageSource,
} from '../utils/property-image';
import { PropertyImageSurface } from './PropertyImageSurface';

// ─── Warm palette constants ──────────────────────────────────────────────

const COLORS = {
  white: '#FFFFFF',
  warm50: '#FFFBF5',
  warm100: '#FFF8F0',
  warm200: '#F5F0E8',
  warm300: '#E8E0D4',
  warm400: '#C7BFB3',
  warm500: '#9C958A',
  warm600: '#736C62',
  warm700: '#504A42',
  warm900: '#2D2926',
  gold500: '#F5A623',
  gold600: '#DE911D',
  hotRed500: '#FF6B35',
  crowdGreen500: '#4CAF50',
  infoBlue500: '#42A5F5',
  // Action label colours — darkened for AA contrast on white (4.5:1+)
  heartPink: '#8C6B76',
  commentGreen: '#607A6A',
  guessOlive: '#7A7A5C',
} as const;

const ACTIVITY_CONFIG = {
  hot: { dot: '#FF6B35', label: 'Hot', bg: 'rgba(255, 107, 53, 0.12)', textColor: '#E6662F' },
  warm: { dot: '#4CAF50', label: 'Active', bg: 'rgba(76, 175, 80, 0.12)', textColor: '#4A9B55' },
  cold: { dot: '#C7BFB3', label: 'Quiet', bg: 'rgba(231, 223, 213, 0.68)', textColor: '#9C958A' },
} as const;

const IMAGE_HEIGHT = 100;
const CARD_RADIUS = 20;
const ADDRESS_BASE_FONT_SIZE = 16;
const ADDRESS_BASE_LINE_HEIGHT = 20;
const ADDRESS_MIN_FONT_SIZE = 11.5;

type HitZoneRef = ((node: any) => void) | undefined;
type HitZoneLayout = (() => void) | undefined;
type NativeHitTargetRegistration = {
  ref?: HitZoneRef;
  onLayout?: HitZoneLayout;
};

// ─── Types ───────────────────────────────────────────────────────────────

export interface PropertyPreviewData {
  id: string;
  address: string;
  streetName?: string | null;
  houseNumber?: string | number | null;
  houseNumberAddition?: string | null;
  city: string;
  postalCode?: string | null;
  countryCode?: string;
  officialValuation?: number | null;
  askingPrice?: number | null;
  fmv?: number | null;
  activityLevel?: 'hot' | 'warm' | 'cold';
  activityScore?: number;
  thumbnailUrl?: string | null;
  /** Listing photo URL (highest priority image). */
  listingPhotoUrl?: string | null;
  /** Aerial/official image URL (country-specific fallback). */
  aerialImageUrl?: string | null;
  /** Likes count for stat pills. */
  likeCount?: number;
  /** Comments count for stat pills. */
  commentCount?: number;
  /** Guesses count for stat pills. */
  guessCount?: number;
}

export interface PropertyPreviewCardProps {
  property: PropertyPreviewData;
  isLiked?: boolean;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
  onPress?: () => void;
  onClose?: () => void;
  /** Whether to show the close button on the image. GroupPreviewCard manages its own close. */
  showCloseButton?: boolean;
  /** Whether to show the speech bubble arrow pointing downwards */
  showArrow?: boolean;
  /** Optional native hit-target registrations used by map marker wrappers. */
  nativeHitTargets?: {
    close?: NativeHitTargetRegistration;
    like?: NativeHitTargetRegistration;
    comment?: NativeHitTargetRegistration;
    guess?: NativeHitTargetRegistration;
  };
}

function AutoFitAddressText({ address }: { address: string }) {
  const [availableWidth, setAvailableWidth] = useState(0);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  useEffect(() => {
    setMeasuredWidth(0);
  }, [address]);

  const scale =
    availableWidth > 0 && measuredWidth > 0 && measuredWidth > availableWidth
      ? availableWidth / measuredWidth
      : 1;
  const fontSize = Math.max(
    ADDRESS_MIN_FONT_SIZE,
    Math.round(ADDRESS_BASE_FONT_SIZE * scale * 10) / 10
  );
  const lineHeight = Math.round(
    ADDRESS_BASE_LINE_HEIGHT * (fontSize / ADDRESS_BASE_FONT_SIZE)
  );

  return (
    <View
      style={styles.addressTextContainer}
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        if (Math.abs(nextWidth - availableWidth) > 0.5) {
          setAvailableWidth(nextWidth);
        }
      }}
      testID="property-preview-address-container"
    >
      <Text
        style={[styles.address, { fontSize, lineHeight }]}
        numberOfLines={1}
        ellipsizeMode="clip"
        testID="property-preview-address"
      >
        {address}
      </Text>

      <View
        pointerEvents="none"
        style={styles.addressMeasurementWrapper}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          style={styles.address}
          numberOfLines={1}
          onLayout={(event) => {
            const nextWidth = event.nativeEvent.layout.width;
            if (Math.abs(nextWidth - measuredWidth) > 0.5) {
              setMeasuredWidth(nextWidth);
            }
          }}
          testID="property-preview-address-measure"
        >
          {address}
        </Text>
      </View>
    </View>
  );
}

function getPreviewAddressLine(property: Pick<
  PropertyPreviewData,
  'address' | 'streetName' | 'houseNumber' | 'houseNumberAddition' | 'countryCode'
>): string {
  const streetName = property.streetName?.trim();
  const houseNumber =
    property.houseNumber != null ? String(property.houseNumber).trim() : '';

  if (streetName && houseNumber) {
    const countryCode: CountryCode =
      property.countryCode && isValidCountryCode(property.countryCode)
        ? property.countryCode
        : 'NL';

    return getCountryConfig(countryCode).addressFormatter({
      street: streetName,
      houseNumber,
      houseNumberAddition: property.houseNumberAddition ?? undefined,
      postalCode: '',
      city: '',
      countryCode,
    });
  }

  const fallbackAddressLine = property.address.trim().split(',', 1)[0]?.trim();
  return fallbackAddressLine || property.address;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatPrice(value: number | null | undefined, countryCode?: string): string | null {
  if (value === null || value === undefined) return null;
  return formatPropertyPrice(value, countryCode as CountryCode);
}

function getDisplayPrice(property: PropertyPreviewData): { price: number; label: string } | null {
  if (property.fmv != null) {
    return { price: property.fmv, label: 'Crowd FMV' };
  }

  if (property.askingPrice != null) {
    return { price: property.askingPrice, label: 'Asking Price' };
  }

  if (property.officialValuation != null) {
    return {
      price: property.officialValuation,
      label: getValuationLabel(property.countryCode),
    };
  }

  return null;
}

// ─── Component ───────────────────────────────────────────────────────────

export function PropertyPreviewCard({
  property,
  isLiked = false,
  onLike,
  onComment,
  onGuess,
  onPress,
  onClose,
  showCloseButton = false,
  showArrow = false,
  nativeHitTargets,
}: PropertyPreviewCardProps) {
  const activityLevel = property.activityLevel ?? 'cold';
  const activity = ACTIVITY_CONFIG[activityLevel];
  const displayPrice = getDisplayPrice(property);
  const formattedPrice = formatPrice(displayPrice?.price, property.countryCode);
  const previewAddressLine = getPreviewAddressLine(property);

  // Resolve image using shared fallback rules
  const imageSource = toPropertyImageSource({
    listingPhotoUrl: property.listingPhotoUrl,
    thumbnailUrl: property.thumbnailUrl,
    aerialImageUrl: property.aerialImageUrl,
    countryCode: property.countryCode,
  });

  const cardContent = (
    <View style={styles.cardContentContainer}>
      <Pressable
        onPress={onPress}
        style={styles.cardPressable}
        testID="property-preview-card"
      >
        {/* Image area */}
        <View style={styles.imageWrapper}>
          <PropertyImageSurface
            source={imageSource}
            style={styles.image}
            markerSize={24}
            imageTestID="property-thumbnail-image"
            markerTestID="property-thumbnail-marker"
            placeholder={
              <View style={styles.placeholder} testID="property-thumbnail-placeholder">
                <Icon name="HouseLine" size="xl" color={COLORS.warm400} />
              </View>
            }
          />
        </View>

        {/* Body section */}
        <View style={styles.body}>
          {/* Address row + activity badge */}
          <View style={styles.addressRow}>
            <AutoFitAddressText address={previewAddressLine} />
            <View style={[styles.activityBadge, { backgroundColor: activity.bg }]}>
              <View style={[styles.activityDot, { backgroundColor: activity.dot }]} />
              <Text style={[styles.activityLabel, { color: activity.textColor }]}>
                {activity.label}
              </Text>
            </View>
          </View>

          {/* City */}
          <Text style={styles.city} numberOfLines={1}>
            {property.city}
            {property.postalCode ? `, ${property.postalCode}` : ''}
          </Text>

          {/* Stat pills row: like count | comment count | price */}
          <View style={styles.statPillsRow}>
            {property.likeCount != null && property.likeCount > 0 && (
              <View style={styles.statMetric} testID="property-preview-like-count">
                <Icon name="Heart" size={14} color={COLORS.gold500} />
                <Text style={[styles.statMetricText, { color: COLORS.gold600 }]}>
                  {formatCompactCount(property.likeCount)}
                </Text>
              </View>
            )}

            {property.commentCount != null && property.commentCount > 0 && (
              <>
                {property.likeCount != null && property.likeCount > 0 && (
                  <View style={styles.statDivider} />
                )}
                <View style={styles.statMetric} testID="property-preview-comment-count">
                  <Icon name="ChatCircle" size={14} color={COLORS.infoBlue500} />
                  <Text style={[styles.statMetricText, { color: '#1E88E5' }]}>
                    {formatCompactCount(property.commentCount)}
                  </Text>
                </View>
              </>
            )}

            {/* Price */}
            {formattedPrice && (
              <View style={styles.priceGroup}>
                <Text style={styles.priceLabel}>{displayPrice?.label}</Text>
                <View style={styles.priceValueRow}>
                  <Icon name="HouseLine" size={14} color={COLORS.gold500} />
                  <Text style={styles.priceText}>{formattedPrice}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Quick actions divider + row */}
        <View style={styles.actionsContainer}>
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onLike?.();
            }}
            ref={nativeHitTargets?.like?.ref}
            onLayout={nativeHitTargets?.like?.onLayout}
            style={styles.actionButton}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            testID="group-preview-like-button"
            accessibilityRole="button"
            accessibilityLabel={isLiked ? 'Liked' : 'Like'}
          >
            <Icon
              name="Heart"
              size={18}
              weight={isLiked ? 'fill' : 'regular'}
              color={isLiked ? COLORS.hotRed500 : COLORS.heartPink}
            />
            <Text style={[styles.actionLabel, { color: isLiked ? COLORS.hotRed500 : COLORS.heartPink }]}>
              {isLiked ? 'Liked' : 'Like'}
            </Text>
          </Pressable>

          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onComment?.();
            }}
            ref={nativeHitTargets?.comment?.ref}
            onLayout={nativeHitTargets?.comment?.onLayout}
            style={styles.actionButton}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            testID="group-preview-comment-button"
            accessibilityRole="button"
            accessibilityLabel="Comment"
          >
            <Icon name="ChatCircle" size={18} color={COLORS.commentGreen} />
            <Text style={[styles.actionLabel, { color: COLORS.commentGreen }]}>Comment</Text>
          </Pressable>

          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onGuess?.();
            }}
            ref={nativeHitTargets?.guess?.ref}
            onLayout={nativeHitTargets?.guess?.onLayout}
            style={styles.actionButton}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            testID="group-preview-guess-button"
            accessibilityRole="button"
            accessibilityLabel="Guess"
          >
            <Icon name="Tag" size={18} color={COLORS.guessOlive} />
            <Text style={[styles.actionLabel, { color: COLORS.guessOlive }]}>Guess</Text>
          </Pressable>
        </View>
      </Pressable>

      {/* Close button — overlayed outside the main pressable so it cannot
          trigger the card body press handler on native. */}
      {showCloseButton && onClose && (
        <View
          ref={nativeHitTargets?.close?.ref}
          onLayout={nativeHitTargets?.close?.onLayout}
          collapsable={Platform.OS !== 'web' ? false : undefined}
          style={styles.closeButtonHitArea}
        >
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onClose();
            }}
            style={styles.closeButton}
            hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
            testID="property-preview-close-button"
            accessibilityLabel="Close preview"
            accessibilityHint="Closes this property preview card"
            accessibilityRole="button"
          >
            <Icon name="X" size={14} color={COLORS.warm700} />
          </Pressable>
        </View>
      )}
    </View>
  );

  if (showArrow) {
    return (
      <View style={styles.wrapperWithArrow} testID="property-preview-wrapper">
        {cardContent}
        {/* Arrow pointer triangle */}
        <View
          style={[
            styles.arrow,
            Platform.OS === 'web'
              ? { filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.09))' } as any
              : {},
          ]}
          testID="property-preview-arrow"
        />
      </View>
    );
  }

  return cardContent;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatCompactCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  cardPressable: {
    backgroundColor: COLORS.white,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    width: '100%',
  },

  // Image
  cardContentContainer: {
    position: 'relative',
    width: '100%',
  },
  imageWrapper: {
    position: 'relative',
    width: '100%',
    height: IMAGE_HEIGHT,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: IMAGE_HEIGHT,
  },
  placeholder: {
    width: '100%',
    height: IMAGE_HEIGHT,
    backgroundColor: COLORS.warm200,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Close button
  closeButtonHitArea: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    zIndex: 3,
  },
  closeButton: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: COLORS.warm200,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#1A1918',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
      default: {},
    }),
  },

  // Body
  body: {
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 4,
    gap: 4,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  addressTextContainer: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  address: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: ADDRESS_BASE_FONT_SIZE,
    lineHeight: ADDRESS_BASE_LINE_HEIGHT,
    fontWeight: '700',
    color: COLORS.warm900,
  },
  addressMeasurementWrapper: {
    position: 'absolute',
    left: -10000,
    top: 0,
    opacity: 0,
  },
  activityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    marginTop: 1,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  activityLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  city: {
    fontSize: 13.5,
    lineHeight: 18,
    color: COLORS.warm600,
  },

  // Stat pills
  statPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    minHeight: 22,
  },
  statMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statMetricText: {
    fontSize: 13,
    fontWeight: '600',
  },
  statDivider: {
    width: 1,
    height: 14,
    backgroundColor: COLORS.warm200,
  },
  priceGroup: {
    alignItems: 'flex-end',
    flexDirection: 'column',
    marginLeft: 'auto' as any,
  },
  priceLabel: {
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '700',
    color: COLORS.warm500,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  priceValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  priceText: {
    fontSize: 15.5,
    fontWeight: '800',
    color: COLORS.warm900,
  },

  // Quick actions
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.warm200,
    paddingHorizontal: 8,
    paddingTop: 9,
    paddingBottom: 10,
    marginTop: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 6,
    gap: 5,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Arrow
  wrapperWithArrow: {
    width: '100%',
    alignSelf: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  arrow: {
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderTopWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.white,
    marginTop: -1,
  },
});
