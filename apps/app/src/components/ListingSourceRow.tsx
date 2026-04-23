/**
 * ListingSourceRow — Displays a listing source (Funda, Pararius, etc.) with icon, price, and status.
 *
 * Design spec: Section 7.7 (Property Detail — Listings section).
 *
 * Each listing source gets a branded circle icon and an "Active" / "Expired" badge.
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet, Linking } from 'react-native';
import { Icon } from './ui/Icon';
import { formatPropertyPrice, type CountryCode } from '@huishype/shared';
import type { ListingVerificationState, ListingWatchState } from '@huishype/shared';

export interface ListingSourceData {
  /** Source name (e.g., 'funda', 'pararius'). */
  source: string;
  /** Listing URL. */
  url: string;
  /** Price displayed on the listing. */
  price?: number | null;
  /** Whether the listing is currently active. */
  isActive?: boolean;
  /** Listing type (e.g., 'Buy', 'Rent'). */
  type?: string;
  /** Price period for rentals (e.g., '/mo'). */
  pricePeriod?: string;
  /** Canonical listing verification state. */
  verificationState?: ListingVerificationState | null;
  /** Durable mirror watch state for provisional user submissions. */
  watchState?: ListingWatchState | null;
}

export interface ListingSourceRowProps {
  listing: ListingSourceData;
  countryCode?: CountryCode | string;
  /** Variant for layout context. */
  variant?: 'compact' | 'full';
  testID?: string;
}

/**
 * Source-specific branding.
 */
const SOURCE_BRANDING: Record<string, { displayName: string; bgColor: string; iconColor: string }> =
  {
    funda: { displayName: 'Funda', bgColor: '#FFF3C4', iconColor: '#B47712' },
    pararius: { displayName: 'Pararius', bgColor: '#E3F2FD', iconColor: '#1565C0' },
  };

const DEFAULT_BRANDING = { displayName: 'Listing', bgColor: '#F5F0E8', iconColor: '#9C958A' };

function getBranding(source: string) {
  return SOURCE_BRANDING[source.toLowerCase()] ?? DEFAULT_BRANDING;
}

function getVerificationBadge(
  verificationState: ListingVerificationState | null | undefined,
  watchState: ListingWatchState | null | undefined
) {
  if (verificationState === 'validated') {
    return {
      label: 'Validated',
      backgroundColor: '#ECFDF5',
      dotColor: '#16A34A',
      textColor: '#15803D',
    };
  }
  if (verificationState === 'invalid') {
    return {
      label: 'Invalid',
      backgroundColor: '#FEF2F2',
      dotColor: '#EF4444',
      textColor: '#B91C1C',
    };
  }
  if (verificationState === 'validation_blocked' || watchState === 'blocked') {
    return {
      label: 'Blocked',
      backgroundColor: '#F5F0E8',
      dotColor: '#C7BFB3',
      textColor: '#9C958A',
    };
  }
  if (
    verificationState === 'validation_failed' ||
    watchState === 'parser_error' ||
    watchState === 'retryable_error'
  ) {
    return {
      label: 'Check failed',
      backgroundColor: '#FFFBEB',
      dotColor: '#D97706',
      textColor: '#B45309',
    };
  }
  if (
    verificationState === 'provisional' ||
    verificationState === 'validation_pending' ||
    watchState === 'will_enqueue' ||
    watchState === 'pending' ||
    watchState === 'queued' ||
    watchState === 'fetching'
  ) {
    return {
      label: 'Pending check',
      backgroundColor: '#FFFBEB',
      dotColor: '#F59E0B',
      textColor: '#B45309',
    };
  }
  return null;
}

export function ListingSourceRow({
  listing,
  countryCode,
  variant = 'full',
  testID,
}: ListingSourceRowProps) {
  const branding = getBranding(listing.source);
  const verificationBadge = getVerificationBadge(listing.verificationState, listing.watchState);

  const handlePress = () => {
    if (listing.url) {
      Linking.openURL(listing.url);
    }
  };

  const priceText = listing.price
    ? formatPropertyPrice(listing.price, (countryCode as CountryCode) ?? 'NL')
    : null;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      testID={testID ?? 'listing-source-row'}
      accessibilityRole="link"
      accessibilityLabel={`View on ${branding.displayName}`}
    >
      {/* Source icon circle */}
      <View style={[styles.sourceIcon, { backgroundColor: branding.bgColor }]}>
        <Icon name="HouseLine" size="md" color={branding.iconColor} />
      </View>

      {/* Text content */}
      <View style={styles.content}>
        <View style={styles.nameRow}>
          <Text style={styles.sourceName}>{branding.displayName}</Text>
          {listing.isActive !== undefined && (
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: listing.isActive ? '#ECFDF5' : '#F5F0E8' },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: listing.isActive ? '#4CAF50' : '#C7BFB3' },
                ]}
              />
              <Text
                style={[styles.statusText, { color: listing.isActive ? '#15803D' : '#9C958A' }]}
              >
                {listing.isActive ? 'Active' : 'Expired'}
              </Text>
            </View>
          )}
          {verificationBadge && (
            <View
              style={[styles.statusBadge, { backgroundColor: verificationBadge.backgroundColor }]}
            >
              <View style={[styles.statusDot, { backgroundColor: verificationBadge.dotColor }]} />
              <Text style={[styles.statusText, { color: verificationBadge.textColor }]}>
                {verificationBadge.label}
              </Text>
            </View>
          )}
        </View>
        {variant === 'full' && (
          <Text style={styles.priceRow} numberOfLines={1}>
            {priceText && <Text style={styles.price}>{priceText}</Text>}
            {listing.type && (
              <Text style={styles.listingType}>
                {priceText ? ' \u00B7 ' : ''}
                {listing.type}
              </Text>
            )}
            {listing.pricePeriod && <Text style={styles.listingType}>{listing.pricePeriod}</Text>}
          </Text>
        )}
      </View>

      {/* External link icon */}
      <Icon name="ArrowSquareOut" size="md" color="#C7BFB3" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  pressed: {
    backgroundColor: '#FFFBF5',
  },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sourceName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D2926',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  priceRow: {
    fontSize: 13,
    color: '#736C62',
    marginTop: 2,
  },
  price: {
    fontWeight: '600',
    color: '#504A42',
  },
  listingType: {
    color: '#9C958A',
  },
});
