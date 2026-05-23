/**
 * PropertyFeedCard — Feed card with property photo, address, price, and stat pills.
 *
 * Uses PropertyMediaCard variant='full' patterns but implements the exact
 * feed card spec from Section 7.5.
 *
 * Design spec: Section 7.5 (Feed Card).
 */

import React, { memo, useMemo } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Icon } from './ui/Icon';
import { MetricPills } from './MetricPills';
import { Card } from './ui/Card';
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';
import { PropertyImageSurface } from './PropertyImageSurface';
import { toPropertyImageSource } from '../utils/property-image';
import { useT } from '@/src/i18n';
import {
  ActivityPill,
  ListingPill,
  StatusPillRow,
  type ListingMarketState,
} from './PropertyStatusPills';

export interface PropertyFeedCardProps {
  id: string;
  address: string;
  city: string;
  postalCode?: string | null;
  countryCode?: string;
  thumbnailUrl?: string | null;
  aerialImageUrl?: string | null;
  officialValuation?: number | null;
  officialValuationYear?: number | null;
  askingPrice?: number;
  fmvValue?: number;
  activityLevel?: 'hot' | 'warm' | 'cold';
  marketState?: ListingMarketState | null;
  likeCount?: number;
  commentCount?: number;
  guessCount?: number;
  viewCount?: number;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  onPress?: () => void;
}

function formatPrice(value: number | null | undefined, countryCode?: string): string {
  if (value === null || value === undefined) return '-';
  return formatPropertyPrice(value, countryCode as CountryCode);
}

function formatValuationLabel(countryCode?: string, year?: number | null): string {
  const label = getValuationLabel(countryCode);
  return year ? `${label} (${year})` : label;
}

function PropertyFeedCardComponent({
  address,
  city,
  countryCode,
  thumbnailUrl,
  aerialImageUrl,
  officialValuation,
  officialValuationYear,
  askingPrice,
  fmvValue,
  activityLevel = 'cold',
  marketState = null,
  likeCount = 0,
  commentCount = 0,
  guessCount = 0,
  viewCount = 0,
  onPress,
}: PropertyFeedCardProps) {
  const t = useT();
  const imageSource = useMemo(
    () =>
      toPropertyImageSource({
        thumbnailUrl,
        aerialImageUrl,
        countryCode,
      }),
    [aerialImageUrl, countryCode, thumbnailUrl]
  );
  const stats = useMemo(
    () => ({
      likeCount,
      commentCount,
      guessCount,
      viewCount,
    }),
    [commentCount, guessCount, likeCount, viewCount]
  );
  const accessibilityLabel = useMemo(
    () =>
      `${address}, ${city}${askingPrice ? `, asking ${formatPrice(askingPrice, countryCode)}` : ''}`,
    [address, askingPrice, city, countryCode]
  );

  // Determine the primary display price
  const primaryPrice = fmvValue ?? officialValuation;

  return (
    <Pressable
      onPress={onPress}
      style={styles.pressable}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={t('common.openPropertyDetails')}
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
                <Text style={styles.placeholderText}>{t('property.feed.noImage')}</Text>
              </View>
            }
          />
        </View>

        {/* Content section */}
        <View style={styles.body}>
          {/* Address row with status pills */}
          <View style={styles.addressRow}>
            <View style={styles.addressContent}>
              <Text style={styles.street} numberOfLines={1} testID="property-address">
                {address}
              </Text>
              <Text style={styles.city} numberOfLines={1}>
                {city}
              </Text>
            </View>

            <StatusPillRow style={styles.statusPills} testID="feed-card-status-pills">
              <ActivityPill level={activityLevel} hideCold tone="solid" testID="activity-badge" />
              <ListingPill marketState={marketState} />
            </StatusPillRow>
          </View>

          {/* Price row */}
          <View style={styles.priceRow}>
            <View>
              {askingPrice != null && askingPrice > 0 && (
                <>
                  <Text style={styles.priceLabel}>{t('property.price.asking')}</Text>
                  <Text style={styles.askingPrice}>{formatPrice(askingPrice, countryCode)}</Text>
                </>
              )}
              {!askingPrice && officialValuation != null && officialValuation > 0 && (
                <>
                  <Text style={styles.priceLabel}>
                    {formatValuationLabel(countryCode, officialValuationYear)}
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
                  <Text style={styles.primaryPrice}>{formatPrice(primaryPrice, countryCode)}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Stat pills */}
          <View style={styles.statDivider} />
          <MetricPills stats={stats} variant="stats" showAllStats testID="feed-card-stats" />
        </View>
      </Card>
    </Pressable>
  );
}

function arePropertyFeedCardPropsEqual(
  prev: Readonly<PropertyFeedCardProps>,
  next: Readonly<PropertyFeedCardProps>
) {
  return (
    prev.id === next.id &&
    prev.address === next.address &&
    prev.city === next.city &&
    prev.postalCode === next.postalCode &&
    prev.countryCode === next.countryCode &&
    prev.thumbnailUrl === next.thumbnailUrl &&
    prev.aerialImageUrl === next.aerialImageUrl &&
    prev.officialValuation === next.officialValuation &&
    prev.officialValuationYear === next.officialValuationYear &&
    prev.askingPrice === next.askingPrice &&
    prev.fmvValue === next.fmvValue &&
    prev.activityLevel === next.activityLevel &&
    prev.marketState === next.marketState &&
    prev.likeCount === next.likeCount &&
    prev.commentCount === next.commentCount &&
    prev.guessCount === next.guessCount &&
    prev.viewCount === next.viewCount &&
    prev.yearBuilt === next.yearBuilt &&
    prev.floorAreaM2 === next.floorAreaM2
  );
}

export const PropertyFeedCard = memo(PropertyFeedCardComponent, arePropertyFeedCardPropsEqual);

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
  statusPills: {
    justifyContent: 'flex-end',
    maxWidth: 172,
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
