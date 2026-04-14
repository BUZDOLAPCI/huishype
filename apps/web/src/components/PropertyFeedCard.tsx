/**
 * PropertyFeedCard — Feed card with property photo, address, price, and stat pills.
 */

import React from 'react';
import type { CSSProperties } from 'react';
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

function formatPrice(value: number | null | undefined, countryCode?: string): string {
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
  const imageSource = toPropertyImageSource({ thumbnailUrl, aerialImageUrl, countryCode });
  const primaryPrice = fmvValue ?? officialValuation;

  return (
    <button type="button" onClick={onPress} style={styles.pressable} data-testid="property-feed-card">
      <Card shadow="card">
        <div style={styles.imageWrapper}>
          <PropertyImageSurface
            source={imageSource}
            style={styles.image}
            markerSize={28}
            imageTestID="property-image"
            markerTestID="property-image-marker"
            placeholder={
              <div style={styles.placeholder}>
                <Icon name="HouseLine" size="2xl" color="#C7BFB3" />
                <span style={styles.placeholderText}>No image available</span>
              </div>
            }
          />
        </div>

        <div style={styles.body}>
          <div style={styles.addressRow}>
            <div style={styles.addressContent}>
              <div style={styles.street} data-testid="property-address" title={address}>
                {address}
              </div>
              <div style={styles.city}>{city}</div>
            </div>
            {activityLevel !== 'cold' && (
              <div style={{ ...styles.activityBadge, backgroundColor: activityConfig.bg }} data-testid="activity-badge">
                {activityConfig.iconName && <Icon name={activityConfig.iconName} size={12} color="#FFFFFF" />}
                <span style={styles.activityBadgeText}>{activityConfig.label}</span>
              </div>
            )}
          </div>

          <div style={styles.priceRow}>
            <div>
              {askingPrice != null && askingPrice > 0 && (
                <>
                  <div style={styles.priceLabel}>Asking Price</div>
                  <div style={styles.askingPrice}>{formatPrice(askingPrice, countryCode)}</div>
                </>
              )}
              {(!askingPrice && officialValuation != null && officialValuation > 0) && (
                <>
                  <div style={styles.priceLabel}>{getValuationLabel(countryCode)}</div>
                  <div style={styles.askingPrice}>{formatPrice(officialValuation, countryCode)}</div>
                </>
              )}
            </div>
            {primaryPrice != null && primaryPrice > 0 && (
              <div style={styles.primaryPriceContainer}>
                <div style={styles.primaryPriceRow}>
                  <Icon name="HouseLine" size={14} color="#F5A623" />
                  <span style={styles.primaryPrice}>{formatPrice(primaryPrice, countryCode)}</span>
                </div>
              </div>
            )}
          </div>

          <div style={styles.statDivider} />
          <MetricPills
            stats={{ likeCount, commentCount, guessCount, viewCount }}
            variant="stats"
            showAllStats
            testID="feed-card-stats"
          />
        </div>
      </Card>
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  pressable: {
    margin: '0 16px 16px',
    padding: 0,
    border: 'none',
    background: 'transparent',
    width: 'calc(100% - 32px)',
    textAlign: 'inherit',
    cursor: 'pointer',
  },
  imageWrapper: { position: 'relative', overflow: 'hidden' },
  image: { width: '100%', height: 180 },
  placeholder: {
    width: '100%',
    height: 180,
    backgroundColor: '#F5F0E8',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  placeholderText: { color: '#C7BFB3', fontSize: 13 },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  addressRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  addressContent: { flex: 1, minWidth: 0 },
  street: {
    fontSize: 16,
    fontWeight: 600,
    color: '#2D2926',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  city: { fontSize: 13, color: '#736C62', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  activityBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 8,
    padding: '4px 8px',
    gap: 4,
    flexShrink: 0,
  },
  activityBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: 600 },
  priceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  priceLabel: { fontSize: 12, color: '#9C958A' },
  askingPrice: { fontSize: 16, fontWeight: 700, color: '#504A42' },
  primaryPriceContainer: { textAlign: 'right' },
  primaryPriceRow: { display: 'flex', alignItems: 'center', gap: 4 },
  primaryPrice: { fontSize: 16, fontWeight: 700, color: '#504A42' },
  statDivider: { height: 1, backgroundColor: '#F5F0E8' },
};
