/**
 * PropertyFeedCard — Feed card with property photo, address, price, and stat pills.
 *
 * Uses PropertyMediaCard variant='full' patterns but implements the exact
 * feed card spec from Section 7.5.
 *
 * Design spec: Section 7.5 (Feed Card).
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Icon } from './ui/Icon';
import { MetricPills } from './MetricPills';
import { Card } from './ui/Card';
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';
import { PropertyImageSurface } from './PropertyImageSurface';
import { toPropertyImageSource } from '../utils/property-image';

export interface PropertyFeedCardProps {
  id: string;
  address: string;
  city: string;
  postalCode?: string | null;
  countryCode?: string;
  thumbnailUrl?: string | null;
  aerialImageUrl?: string | null;
  officialValuation?: number | null;
  askingPrice?: number;
  fmvValue?: number;
  activityLevel?: 'hot' | 'warm' | 'cold';
  likeCount?: number;
  commentCount?: number;
  guessCount?: number;
  viewCount?: number;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  onPress?: () => void;
}

function formatPrice(
  value: number | null | undefined,
  countryCode?: string
): string {
  if (value === null || value === undefined) return '-';
  return formatPropertyPrice(value, countryCode as CountryCode);
}

const ACTIVITY_CONFIG = {
  hot: { bg: '#FF6B35', label: 'Hot', iconName: 'Flame' as const },
  warm: { bg: '#F5A623', label: 'Active', iconName: 'Flame' as const },
  cold: { bg: '#C7BFB3', label: '', iconName: undefined },
} as const;

export function PropertyFeedCard({
  address,
  city,
  countryCode,
  thumbnailUrl,
  aerialImageUrl,
  officialValuation,
  askingPrice,
  fmvValue,
  activityLevel = 'cold',
  likeCount = 0,
  commentCount = 0,
  guessCount = 0,
  viewCount = 0,
  onPress,
}: PropertyFeedCardProps) {
  const activityConfig = ACTIVITY_CONFIG[activityLevel];
  const imageSource = toPropertyImageSource({
    thumbnailUrl,
    aerialImageUrl,
    countryCode,
  });

  // Determine the primary display price
  const primaryPrice = fmvValue ?? officialValuation;

  return (
    <Pressable
      onPress={onPress}
      style={styles.pressable}
      accessibilityRole="button"
      accessibilityLabel={`${address}, ${city}${askingPrice ? `, asking ${formatPrice(askingPrice, countryCode)}` : ''}`}
      accessibilityHint="Opens property details"
      testID="property-feed-card"
    >
      <Card shadow="card">
        {/* Image section */}
        <View style={styles.imageWrapper}>
          <PropertyImageSurface
            source={imageSource}
            style={styles.image}
            markerSize={28}
            imageTestID="property-image"
            markerTestID="property-image-marker"
            placeholder={
              <View style={styles.placeholder}>
                <Icon name="HouseLine" size="2xl" color="#C7BFB3" />
                <Text style={styles.placeholderText}>No image available</Text>
              </View>
            }
          />
        </View>

        {/* Content section */}
        <View style={styles.body}>
          {/* Address row with activity badge */}
          <View style={styles.addressRow}>
            <View style={styles.addressContent}>
              <Text
                style={styles.street}
                numberOfLines={1}
                testID="property-address"
              >
                {address}
              </Text>
              <Text style={styles.city} numberOfLines={1}>
                {city}
              </Text>
            </View>

            {/* Activity badge */}
            {activityLevel !== 'cold' && (
              <View
                style={[styles.activityBadge, { backgroundColor: activityConfig.bg }]}
                testID="activity-badge"
              >
                {activityConfig.iconName && (
                  <Icon
                    name={activityConfig.iconName}
                    size={12}
                    color="#FFFFFF"
                  />
                )}
                <Text style={styles.activityBadgeText}>
                  {activityConfig.label}
                </Text>
              </View>
            )}
          </View>

          {/* Price row */}
          <View style={styles.priceRow}>
            <View>
              {askingPrice != null && askingPrice > 0 && (
                <>
                  <Text style={styles.priceLabel}>Asking Price</Text>
                  <Text style={styles.askingPrice}>
                    {formatPrice(askingPrice, countryCode)}
                  </Text>
                </>
              )}
              {!askingPrice && officialValuation != null && officialValuation > 0 && (
                <>
                  <Text style={styles.priceLabel}>
                    {getValuationLabel(countryCode)}
                  </Text>
                  <Text style={styles.askingPrice}>
                    {formatPrice(officialValuation, countryCode)}
                  </Text>
                </>
              )}
            </View>

            {primaryPrice != null && primaryPrice > 0 && (
              <View style={styles.primaryPriceContainer}>
                <View style={styles.primaryPriceRow}>
                  <Icon name="HouseLine" size={14} color="#F5A623" />
                  <Text style={styles.primaryPrice}>
                    {formatPrice(primaryPrice, countryCode)}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Stat pills */}
          <View style={styles.statDivider} />
          <MetricPills
            stats={{
              likeCount,
              commentCount,
              guessCount,
              viewCount,
            }}
            variant="stats"
            showAllStats
            testID="feed-card-stats"
          />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  imageWrapper: {
    position: 'relative',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: 180,
  },
  placeholder: {
    width: '100%',
    height: 180,
    backgroundColor: '#F5F0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#C7BFB3',
    fontSize: 13,
    marginTop: 8,
  },
  body: {
    padding: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  addressContent: {
    flex: 1,
    marginRight: 8,
  },
  street: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D2926', // warm-900
    fontFamily: 'Inter_600SemiBold',
  },
  city: {
    fontSize: 13,
    color: '#736C62', // warm-600 — AA contrast on white (5.0:1)
    marginTop: 2,
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
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  priceLabel: {
    fontSize: 13,
    color: '#736C62', // warm-600 — AA contrast on white
  },
  askingPrice: {
    fontSize: 15,
    fontWeight: '500',
    color: '#736C62', // warm-600
    marginTop: 2,
  },
  primaryPriceContainer: {
    alignItems: 'flex-end',
  },
  primaryPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  primaryPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D2926', // warm-900
  },
  statDivider: {
    height: 1,
    backgroundColor: '#F5F0E8', // warm-200
    marginTop: 4,
  },
});
