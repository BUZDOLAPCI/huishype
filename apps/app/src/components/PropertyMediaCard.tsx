/**
 * PropertyMediaCard — Reusable media-and-metrics card for property-centric surfaces.
 *
 * Provides a unified visual model for:
 *   - Feed cards (full variant)
 *   - Preview cards (compact variant)
 *   - Property detail hero (hero variant)
 *
 * Design spec: Section 7.5 (Feed Card), Section 7.6 (Preview Card), Section 7.7 (Property Detail).
 *
 * Multi-country support:
 *   - Official valuation present or absent by country
 *   - Asking price present or absent
 *   - Listing photo present or absent (falls back via resolvePropertyImage)
 *   - Price label adapts to country (WOZ for NL, Official Valuation for others)
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Icon } from './ui/Icon';
import { SkeletonText } from './ui/Skeleton';
import { Card } from './ui/Card';
import {
  formatPropertyPrice,
  getValuationLabel,
  type CountryCode,
} from '@huishype/shared';
import {
  toPropertyImageSource,
} from '../utils/property-image';
import { PropertyImageSurface } from './PropertyImageSurface';
import {
  getOfficialValuationDisplayState,
  type OfficialValuationSourceFetchHint,
} from '@/src/lib/officialValuationDisplay';

// ─── Types ────────────────────────────────────────────────────────────────

export type PropertyMediaVariant = 'compact' | 'full' | 'hero';

export type ActivityLevel = 'hot' | 'warm' | 'cold';

export interface PropertyMediaData {
  id: string;
  address: string;
  city: string;
  postalCode?: string | null;
  countryCode?: CountryCode | string;
  /** Listing photo URL (highest priority image). */
  listingPhotoUrl?: string | null;
  /** Aerial/official image URL (country-specific fallback). */
  aerialImageUrl?: string | null;
  /** Official government valuation (e.g., WOZ for NL). */
  officialValuation?: number | null;
  /** Year of the official government valuation. */
  officialValuationYear?: number | null;
  officialValuationSourceFetch?: OfficialValuationSourceFetchHint | null;
  officialValuationHydrationHidden?: boolean | null;
  /** Listing asking price. */
  askingPrice?: number | null;
  /** Crowd FMV estimate. */
  fmv?: number | null;
  /** Activity level badge. */
  activityLevel?: ActivityLevel;
  /** Year the property was built. */
  yearBuilt?: number | null;
  /** Floor area in square meters. */
  floorAreaM2?: number | null;
  /** Number of views. */
  viewCount?: number;
}

export interface PropertyMediaCardProps {
  /** Property data. */
  property: PropertyMediaData;
  /** Display variant. Default 'full'. */
  variant?: PropertyMediaVariant;
  /** Called when the card is pressed. */
  onPress?: () => void;
  testID?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const IMAGE_HEIGHTS: Record<PropertyMediaVariant, number> = {
  compact: 100,
  full: 180,
  hero: 240,
};

const ACTIVITY_CONFIG: Record<ActivityLevel, { dot: string; label: string; bgColor: string; textColor: string }> = {
  hot: { dot: '#FF6B35', label: 'Hot', bgColor: '#FFF5F0', textColor: '#C43E00' },
  warm: { dot: '#F5A623', label: 'Active', bgColor: '#FFFBEB', textColor: '#B47712' },
  cold: { dot: '#C7BFB3', label: 'Quiet', bgColor: '#F5F0E8', textColor: '#9C958A' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatPrice(value: number | null | undefined, countryCode?: string): string {
  if (value === null || value === undefined) return '';
  return formatPropertyPrice(value, (countryCode as CountryCode) ?? 'NL');
}

function formatValuationLabel(countryCode?: string, year?: number | null): string {
  const label = getValuationLabel(countryCode);
  return year ? `${label} (${year})` : label;
}

type MediaDisplayPrice =
  | { state: 'ready'; price: number; label: string }
  | { state: 'loading'; label: string };

function getDisplayPrice(property: PropertyMediaData): MediaDisplayPrice | null {
  if (property.fmv) {
    return { state: 'ready', price: property.fmv, label: 'Crowd Estimate' };
  }
  if (property.askingPrice) {
    return { state: 'ready', price: property.askingPrice, label: 'Asking Price' };
  }
  const valuationDisplay = getOfficialValuationDisplayState(property);
  if (valuationDisplay.state === 'ready') {
    return {
      state: 'ready',
      price: valuationDisplay.value,
      label: formatValuationLabel(property.countryCode, valuationDisplay.year),
    };
  }
  if (valuationDisplay.state === 'loading') {
    return {
      state: 'loading',
      label: formatValuationLabel(
        property.countryCode,
        valuationDisplay.expectedYear ?? valuationDisplay.year,
      ),
    };
  }
  return null;
}

// ─── Sub-components ───────────────────────────────────────────────────────

function PropertyImage({
  property,
  height,
  variant,
}: {
  property: PropertyMediaData;
  height: number;
  variant: PropertyMediaVariant;
}) {
  const imageSource = toPropertyImageSource({
    listingPhotoUrl: property.listingPhotoUrl,
    aerialImageUrl: property.aerialImageUrl,
    countryCode: property.countryCode,
  });
  return (
    <PropertyImageSurface
      source={imageSource}
      style={{ width: '100%', height }}
      markerSize={variant === 'compact' ? 18 : variant === 'hero' ? 32 : 28}
      imageTestID="property-media-image"
      markerTestID="property-media-aerial-marker"
      placeholder={(
        <View
          style={[styles.placeholderContainer, { height }]}
          testID="property-media-placeholder"
        >
          <Icon
            name="HouseLine"
            size={variant === 'compact' ? 'xl' : '2xl'}
            color="#C7BFB3"
          />
          {variant !== 'compact' && (
            <Text style={styles.placeholderText}>No image available</Text>
          )}
        </View>
      )}
    />
  );
}

function ActivityBadge({ level }: { level: ActivityLevel }) {
  if (level === 'cold') return null;
  const config = ACTIVITY_CONFIG[level];

  return (
    <View style={[styles.activityBadge, { backgroundColor: config.dot }]} testID="activity-badge">
      {level === 'hot' && (
        <Icon name="Flame" size={12} color="#FFFFFF" />
      )}
      <Text style={styles.activityBadgeText}>{config.label}</Text>
    </View>
  );
}

function ActivityDot({ level }: { level: ActivityLevel }) {
  const config = ACTIVITY_CONFIG[level];
  return (
    <View style={styles.activityDotRow} testID="activity-dot">
      <View style={[styles.activityDot, { backgroundColor: config.dot }]} />
      <Text style={[styles.activityDotLabel, { color: config.textColor }]}>
        {config.label}
      </Text>
    </View>
  );
}

function StatPills({
  property,
}: {
  property: PropertyMediaData;
}) {
  const pills: Array<{ icon: React.ComponentProps<typeof Icon>['name']; value: string }> = [];

  if (property.yearBuilt) {
    pills.push({ icon: 'Calendar', value: String(property.yearBuilt) });
  }
  if (property.floorAreaM2) {
    pills.push({ icon: 'Ruler', value: `${property.floorAreaM2} m\u00B2` });
  }
  if (property.viewCount && property.viewCount > 0) {
    pills.push({ icon: 'Eye', value: String(property.viewCount) });
  }

  if (pills.length === 0) return null;

  return (
    <View style={styles.statPillsRow} testID="stat-pills">
      {pills.map((pill) => (
        <View key={pill.icon + pill.value} style={styles.statPill}>
          <Icon name={pill.icon} size={13} color="#9C958A" />
          <Text style={styles.statPillText}>{pill.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

export function PropertyMediaCard({
  property,
  variant = 'full',
  onPress,
  testID,
}: PropertyMediaCardProps) {
  const imageHeight = IMAGE_HEIGHTS[variant];
  const activityLevel = property.activityLevel ?? 'cold';
  const displayPrice = getDisplayPrice(property);
  const valuationDisplay = getOfficialValuationDisplayState(property);
  const valuationLabelYear =
    valuationDisplay.state === 'ready'
      ? valuationDisplay.year
      : valuationDisplay.state === 'loading'
        ? (valuationDisplay.expectedYear ?? valuationDisplay.year)
        : property.officialValuationYear;

  const cardShadow = variant === 'compact' ? 'preview' : 'card';

  const content = (
    <Card shadow={cardShadow} testID={testID ?? 'property-media-card'}>
      {/* Image area */}
      <View style={styles.imageWrapper}>
        <PropertyImage property={property} height={imageHeight} variant={variant} />

        {/* Activity badge (full/hero only, overlaid on image) */}
        {variant !== 'compact' && (
          <View style={styles.imageOverlay}>
            <ActivityBadge level={activityLevel} />
          </View>
        )}

        {/* View count overlay (full/hero only) */}
        {variant !== 'compact' && property.viewCount != null && property.viewCount > 0 && (
          <View style={styles.viewCountOverlay}>
            <Icon name="Eye" size={12} color="#FFFFFF" />
            <Text style={styles.viewCountText}>{property.viewCount}</Text>
          </View>
        )}
      </View>

      {/* Content area */}
      <View style={variant === 'compact' ? styles.bodyCompact : styles.bodyFull}>
        {/* Address row */}
        <View style={styles.addressRow}>
          <View style={styles.addressContent}>
            <Text
              style={variant === 'compact' ? styles.addressCompact : styles.addressFull}
              numberOfLines={1}
            >
              {property.address}
            </Text>
            <Text style={styles.city} numberOfLines={1}>
              {property.city}
              {property.postalCode ? `, ${property.postalCode}` : ''}
            </Text>
          </View>

          {/* Activity dot (compact only) */}
          {variant === 'compact' && <ActivityDot level={activityLevel} />}
        </View>

        {/* Stat pills */}
        {variant !== 'compact' && <StatPills property={property} />}

        {/* Price row */}
        {displayPrice && (
          <View style={styles.priceRow}>
            {/* Official valuation on left (full/hero only) */}
            {variant !== 'compact' && valuationDisplay.state !== 'hidden' && property.fmv && (
              <View>
                <Text style={styles.priceLabel}>
                  {formatValuationLabel(
                    property.countryCode,
                    valuationLabelYear,
                  )}
                </Text>
                {valuationDisplay.state === 'loading' ? (
                  <SkeletonText
                    testID="property-media-valuation-value-skeleton"
                    style={styles.secondaryPriceSkeleton}
                  />
                ) : (
                  <Text style={styles.secondaryPrice}>
                    {formatPrice(valuationDisplay.value, property.countryCode as string)}
                  </Text>
                )}
              </View>
            )}

            {/* Primary price */}
            <View style={variant === 'compact' ? undefined : styles.primaryPriceRight}>
              {variant !== 'compact' && (
                <Text style={styles.priceLabel}>{displayPrice.label}</Text>
              )}
              <View style={styles.primaryPriceRow}>
                <Icon name="HouseLine" size={14} color="#F5A623" />
                {displayPrice.state === 'loading' ? (
                  <SkeletonText
                    testID="property-media-display-price-skeleton"
                    style={variant === 'compact' ? styles.priceCompactSkeleton : styles.priceFullSkeleton}
                  />
                ) : (
                  <Text
                    style={variant === 'compact' ? styles.priceCompact : styles.priceFull}
                    testID="display-price"
                  >
                    {formatPrice(displayPrice.price, property.countryCode as string)}
                  </Text>
                )}
              </View>
            </View>
          </View>
        )}
      </View>
    </Card>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        {content}
      </Pressable>
    );
  }

  return content;
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  imageWrapper: {
    position: 'relative',
    overflow: 'hidden',
  },
  placeholderContainer: {
    width: '100%',
    backgroundColor: '#F5F0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#C7BFB3',
    fontSize: 13,
    marginTop: 8,
  },
  imageOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
  },
  activityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  activityBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  viewCountOverlay: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  viewCountText: {
    color: '#FFFFFF',
    fontSize: 12,
  },

  // Body
  bodyCompact: {
    padding: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 2,
  },
  bodyFull: {
    padding: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },

  // Address
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  addressContent: {
    flex: 1,
    marginRight: 8,
  },
  addressCompact: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D2926',
  },
  addressFull: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D2926',
  },
  city: {
    fontSize: 13,
    color: '#9C958A',
    marginTop: 2,
  },

  // Activity dot
  activityDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  activityDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  activityDotLabel: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Stat pills
  statPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F0E8',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  statPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#504A42',
  },

  // Price
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  priceLabel: {
    fontSize: 13,
    color: '#9C958A',
  },
  secondaryPrice: {
    fontSize: 15,
    fontWeight: '500',
    color: '#736C62',
    marginTop: 2,
  },
  secondaryPriceSkeleton: {
    width: 92,
    height: 18,
    marginTop: 4,
  },
  primaryPriceRight: {
    alignItems: 'flex-end',
  },
  primaryPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  priceCompact: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2D2926',
  },
  priceCompactSkeleton: {
    width: 72,
    height: 16,
  },
  priceFull: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D2926',
  },
  priceFullSkeleton: {
    width: 88,
    height: 18,
  },
});
