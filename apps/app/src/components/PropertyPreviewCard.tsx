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

import { Pressable, Text, View, Platform, StyleSheet } from 'react-native';
import { Icon } from './ui/Icon';
import {
  formatPropertyPrice,
  type CountryCode,
} from '@huishype/shared';
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

type HitZoneRef = ((node: any) => void) | undefined;
type HitZoneLayout = (() => void) | undefined;

// ─── Types ───────────────────────────────────────────────────────────────

export interface PropertyPreviewData {
  id: string;
  address: string;
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
  /** Optional native hit-test registration for the close button. */
  closeButtonRef?: HitZoneRef;
  closeButtonOnLayout?: HitZoneLayout;
  /** Optional native hit-test registration for action buttons. */
  likeButtonRef?: HitZoneRef;
  likeButtonOnLayout?: HitZoneLayout;
  commentButtonRef?: HitZoneRef;
  commentButtonOnLayout?: HitZoneLayout;
  guessButtonRef?: HitZoneRef;
  guessButtonOnLayout?: HitZoneLayout;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatPrice(value: number | null | undefined, countryCode?: string): string | null {
  if (value === null || value === undefined) return null;
  return formatPropertyPrice(value, countryCode as CountryCode);
}

function getDisplayPrice(property: PropertyPreviewData): number | null {
  return property.fmv ?? property.askingPrice ?? property.officialValuation ?? null;
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
  closeButtonRef,
  closeButtonOnLayout,
  likeButtonRef,
  likeButtonOnLayout,
  commentButtonRef,
  commentButtonOnLayout,
  guessButtonRef,
  guessButtonOnLayout,
}: PropertyPreviewCardProps) {
  const activityLevel = property.activityLevel ?? 'cold';
  const activity = ACTIVITY_CONFIG[activityLevel];
  const displayPrice = getDisplayPrice(property);
  const formattedPrice = formatPrice(displayPrice, property.countryCode);

  // Resolve image using shared fallback rules
  const imageSource = toPropertyImageSource({
    listingPhotoUrl: property.listingPhotoUrl,
    thumbnailUrl: property.thumbnailUrl,
    aerialImageUrl: property.aerialImageUrl,
    countryCode: property.countryCode,
  });

  const cardContent = (
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

        {/* Close button — translucent white circle in top-right of image */}
        {showCloseButton && onClose && (
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onClose();
            }}
            ref={closeButtonRef}
            onLayout={closeButtonOnLayout}
            style={styles.closeButton}
            hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
            testID="property-preview-close-button"
            accessibilityLabel="Close preview"
            accessibilityHint="Closes this property preview card"
            accessibilityRole="button"
          >
            <Icon name="X" size={14} color={COLORS.warm700} />
          </Pressable>
        )}
      </View>

      {/* Body section */}
      <View style={styles.body}>
        {/* Address row + activity badge */}
        <View style={styles.addressRow}>
          <Text style={styles.address} numberOfLines={1}>
            {property.address}
          </Text>
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
              <Icon name="HouseLine" size={14} color={COLORS.gold500} />
              <Text style={styles.priceText}>{formattedPrice}</Text>
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
          ref={likeButtonRef}
          onLayout={likeButtonOnLayout}
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
          ref={commentButtonRef}
          onLayout={commentButtonOnLayout}
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
          ref={guessButtonRef}
          onLayout={guessButtonOnLayout}
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
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
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
  address: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: COLORS.warm900,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto' as any,
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
