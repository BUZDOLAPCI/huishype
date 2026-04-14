/**
 * ListingSourceRow — Displays a listing source (Funda, Pararius, etc.) with icon, price, and status.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { Icon } from './ui/Icon';
import { formatPropertyPrice, type CountryCode } from '@huishype/shared';

export interface ListingSourceData {
  source: string;
  url: string;
  price?: number | null;
  isActive?: boolean;
  type?: string;
  pricePeriod?: string;
}

export interface ListingSourceRowProps {
  listing: ListingSourceData;
  countryCode?: CountryCode | string;
  variant?: 'compact' | 'full';
  testID?: string;
}

const SOURCE_BRANDING: Record<string, { displayName: string; bgColor: string; iconColor: string }> = {
  funda: { displayName: 'Funda', bgColor: '#FFF3C4', iconColor: '#B47712' },
  pararius: { displayName: 'Pararius', bgColor: '#E3F2FD', iconColor: '#1565C0' },
};
const DEFAULT_BRANDING = { displayName: 'Listing', bgColor: '#F5F0E8', iconColor: '#9C958A' };

function getBranding(source: string) {
  return SOURCE_BRANDING[source.toLowerCase()] ?? DEFAULT_BRANDING;
}

export function ListingSourceRow({
  listing,
  countryCode,
  variant = 'full',
  testID,
}: ListingSourceRowProps) {
  const branding = getBranding(listing.source);
  const priceText = listing.price ? formatPropertyPrice(listing.price, (countryCode as CountryCode) ?? 'NL') : null;

  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noreferrer noopener"
      style={styles.container}
      data-testid={testID ?? 'listing-source-row'}
      aria-label={`View on ${branding.displayName}`}
    >
      <div style={{ ...styles.sourceIcon, backgroundColor: branding.bgColor }}>
        <Icon name="HouseLine" size="md" color={branding.iconColor} />
      </div>

      <div style={styles.content}>
        <div style={styles.nameRow}>
          <span style={styles.sourceName}>{branding.displayName}</span>
          {listing.isActive !== undefined && (
            <div style={{ ...styles.statusBadge, backgroundColor: listing.isActive ? '#ECFDF5' : '#F5F0E8' }}>
              <div style={{ ...styles.statusDot, backgroundColor: listing.isActive ? '#4CAF50' : '#C7BFB3' }} />
              <span style={{ ...styles.statusText, color: listing.isActive ? '#15803D' : '#9C958A' }}>
                {listing.isActive ? 'Active' : 'Expired'}
              </span>
            </div>
          )}
        </div>

        {variant === 'full' && (
          <div style={styles.priceRow}>
            {priceText && <span style={styles.price}>{priceText}</span>}
            {listing.type && <span style={styles.listingType}>{priceText ? ' · ' : ''}{listing.type}</span>}
            {listing.pricePeriod && <span style={styles.listingType}>{listing.pricePeriod}</span>}
          </div>
        )}
      </div>

      <Icon name="ArrowSquareOut" size="md" color="#C7BFB3" />
    </a>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    textDecoration: 'none',
    color: 'inherit',
  },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  content: { flex: 1, minWidth: 0 },
  nameRow: { display: 'flex', alignItems: 'center', gap: 8 },
  sourceName: { fontSize: 15, fontWeight: 600, color: '#2D2926' },
  statusBadge: { display: 'inline-flex', alignItems: 'center', borderRadius: 10, padding: '3px 8px', gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: 500 },
  priceRow: { display: 'flex', gap: 4, fontSize: 13, color: '#736C62', marginTop: 2, minWidth: 0, overflow: 'hidden' },
  price: { fontWeight: 600, color: '#504A42' },
  listingType: { color: '#9C958A' },
};
