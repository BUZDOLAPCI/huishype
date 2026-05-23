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
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';
import { getCountryConfig, isValidCountryCode } from '@huishype/shared/config';
import { toPropertyImageSource } from '../utils/property-image';
import { PropertyImageSurface } from './PropertyImageSurface';
import type { WebViewStyle } from '@/src/lib/webStyle';
import { useT } from '@/src/i18n';
import { ActivityPill, ListingPill, type ListingMarketState } from './PropertyStatusPills';

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

const IMAGE_HEIGHT = 100;
const CARD_RADIUS = 20;
const ADDRESS_BASE_FONT_SIZE = 16;
const ADDRESS_BASE_LINE_HEIGHT = 20;
const ADDRESS_MIN_FONT_SIZE = 11.5;
const WEB_ARROW_STYLE: WebViewStyle = {
  filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.09))',
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
  officialValuationYear?: number | null;
  askingPrice?: number | null;
  fmv?: number | null;
  activityLevel?: 'hot' | 'warm' | 'cold';
  marketState?: ListingMarketState | null;
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
  /** Whether to show the close button on the image. */
  showCloseButton?: boolean;
  /** Override for the close button testID when composed inside wrapper components. */
  closeButtonTestID?: string;
  /** Whether to show the speech bubble arrow pointing downwards */
  showArrow?: boolean;
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
  const lineHeight = Math.round(ADDRESS_BASE_LINE_HEIGHT * (fontSize / ADDRESS_BASE_FONT_SIZE));

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

function getPreviewAddressLine(
  property: Pick<
    PropertyPreviewData,
    'address' | 'streetName' | 'houseNumber' | 'houseNumberAddition' | 'countryCode'
  >
): string {
  const streetName = property.streetName?.trim();
  const houseNumber = property.houseNumber != null ? String(property.houseNumber).trim() : '';

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

function formatValuationLabel(countryCode?: string, year?: number | null): string {
  const label = getValuationLabel(countryCode);
  return year ? `${label} (${year})` : label;
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
      label: formatValuationLabel(property.countryCode, property.officialValuationYear),
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
  closeButtonTestID = 'property-preview-close-button',
  showArrow = false,
}: PropertyPreviewCardProps) {
  const t = useT();
  const activityLevel = property.activityLevel ?? 'cold';
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
      <Pressable onPress={onPress} style={styles.cardPressable} testID="property-preview-card">
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
          {/* Address row + status pills */}
          <View style={styles.addressRow}>
            <AutoFitAddressText address={previewAddressLine} />
            <View style={styles.statusPillsStack} testID="property-preview-status-pills">
              <ActivityPill level={activityLevel} testID="property-preview-activity-pill" />
            </View>
          </View>

          {/* City */}
          <View style={styles.cityRow} testID="property-preview-city-row">
            <Text style={styles.city} numberOfLines={1}>
              {property.city}
              {property.postalCode ? `, ${property.postalCode}` : ''}
            </Text>
            <ListingPill
              marketState={property.marketState}
              testID="property-preview-listing-pill"
            />
          </View>

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
            style={styles.actionButton}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            testID="group-preview-like-button"
            accessibilityRole="button"
            accessibilityLabel={isLiked ? t('property.preview.liked') : t('property.preview.like')}
          >
            <Icon
              name="Heart"
              size={18}
              weight={isLiked ? 'fill' : 'regular'}
              color={isLiked ? COLORS.hotRed500 : COLORS.heartPink}
            />
            <Text
              style={[styles.actionLabel, { color: isLiked ? COLORS.hotRed500 : COLORS.heartPink }]}
            >
              {isLiked ? t('property.preview.liked') : t('property.preview.like')}
            </Text>
          </Pressable>

          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onComment?.();
            }}
            style={styles.actionButton}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            testID="group-preview-comment-button"
            accessibilityRole="button"
            accessibilityLabel={t('property.preview.comment')}
          >
            <Icon name="ChatCircle" size={18} color={COLORS.commentGreen} />
            <Text style={[styles.actionLabel, { color: COLORS.commentGreen }]}>
              {t('property.preview.comment')}
            </Text>
          </Pressable>

          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onGuess?.();
            }}
            style={styles.actionButton}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            testID="group-preview-guess-button"
            accessibilityRole="button"
            accessibilityLabel={t('property.preview.guess')}
          >
            <Icon name="Tag" size={18} color={COLORS.guessOlive} />
            <Text style={[styles.actionLabel, { color: COLORS.guessOlive }]}>
              {t('property.preview.guess')}
            </Text>
          </Pressable>
        </View>
      </Pressable>

      {/* Close button — overlayed outside the main pressable so it cannot
          trigger the card body press handler on native. */}
      {showCloseButton && onClose && (
        <Pressable
          onPress={(e) => {
            e?.stopPropagation?.();
            onClose();
          }}
          collapsable={Platform.OS !== 'web' ? false : undefined}
          style={styles.closeButtonHitArea}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          testID={closeButtonTestID}
          accessibilityLabel={t('property.preview.close')}
          accessibilityHint={t('property.preview.closeHint')}
          accessibilityRole="button"
        >
          <View pointerEvents="none" style={styles.closeButton}>
            <Icon name="X" size={14} color={COLORS.warm700} />
          </View>
        </Pressable>
      )}
    </View>
  );

  if (showArrow) {
    return (
      <View style={styles.wrapperWithArrow} testID="property-preview-wrapper">
        {cardContent}
        {/* Arrow pointer triangle */}
        <View
          style={[styles.arrow, Platform.OS === 'web' ? WEB_ARROW_STYLE : null]}
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
    top: 6,
    right: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  closeButton: {
    width: 30,
    height: 30,
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
  statusPillsStack: {
    alignItems: 'flex-end',
    marginTop: 1,
    maxWidth: 92,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  city: {
    flex: 1,
    minWidth: 0,
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
    marginLeft: 'auto',
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
