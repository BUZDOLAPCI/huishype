/**
 * PropertyMediaCard — Reusable media-and-metrics card for property-centric surfaces.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { Icon } from './ui/Icon';
import { Card } from './ui/Card';
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';
import { toPropertyImageSource } from '../utils/property-image';
import { PropertyImageSurface } from './PropertyImageSurface';

export type PropertyMediaVariant = 'compact' | 'full' | 'hero';
export type ActivityLevel = 'hot' | 'warm' | 'cold';

export interface PropertyMediaData {
  id: string;
  address: string;
  city: string;
  postalCode?: string | null;
  countryCode?: CountryCode | string;
  listingPhotoUrl?: string | null;
  aerialImageUrl?: string | null;
  officialValuation?: number | null;
  askingPrice?: number | null;
  fmv?: number | null;
  activityLevel?: ActivityLevel;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  viewCount?: number;
}

export interface PropertyMediaCardProps {
  property: PropertyMediaData;
  variant?: PropertyMediaVariant;
  onPress?: () => void;
  testID?: string;
}

const IMAGE_HEIGHTS: Record<PropertyMediaVariant, number> = { compact: 100, full: 180, hero: 240 };
const ACTIVITY_CONFIG: Record<ActivityLevel, { dot: string; label: string; bgColor: string; textColor: string }> = {
  hot: { dot: '#FF6B35', label: 'Hot', bgColor: '#FFF5F0', textColor: '#C43E00' },
  warm: { dot: '#F5A623', label: 'Active', bgColor: '#FFFBEB', textColor: '#B47712' },
  cold: { dot: '#C7BFB3', label: 'Quiet', bgColor: '#F5F0E8', textColor: '#9C958A' },
};

function formatPrice(value: number | null | undefined, countryCode?: string): string {
  if (value === null || value === undefined) return '';
  return formatPropertyPrice(value, (countryCode as CountryCode) ?? 'NL');
}

function getDisplayPrice(property: PropertyMediaData): { price: number; label: string } | null {
  if (property.fmv) return { price: property.fmv, label: 'Crowd Estimate' };
  if (property.askingPrice) return { price: property.askingPrice, label: 'Asking Price' };
  if (property.officialValuation) {
    return { price: property.officialValuation, label: getValuationLabel(property.countryCode) };
  }
  return null;
}

function PropertyImage({ property, height, variant }: { property: PropertyMediaData; height: number; variant: PropertyMediaVariant }) {
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
        <div style={{ ...styles.placeholderContainer, height }} data-testid="property-media-placeholder">
          <Icon name="HouseLine" size={variant === 'compact' ? 'xl' : '2xl'} color="#C7BFB3" />
          {variant !== 'compact' && <div style={styles.placeholderText}>No image available</div>}
        </div>
      )}
    />
  );
}

function ActivityBadge({ level }: { level: ActivityLevel }) {
  if (level === 'cold') return null;
  const config = ACTIVITY_CONFIG[level];
  return (
    <div style={{ ...styles.activityBadge, backgroundColor: config.bgColor }} data-testid="activity-badge">
      {level === 'hot' && <Icon name="Flame" size={12} color="#FFFFFF" />}
      <span style={styles.activityBadgeText}>{config.label}</span>
    </div>
  );
}

function ActivityDot({ level }: { level: ActivityLevel }) {
  const config = ACTIVITY_CONFIG[level];
  return (
    <div style={styles.activityDotRow} data-testid="activity-dot">
      <div style={{ ...styles.activityDot, backgroundColor: config.dot }} />
      <span style={{ ...styles.activityDotLabel, color: config.textColor }}>{config.label}</span>
    </div>
  );
}

function StatPills({ property }: { property: PropertyMediaData }) {
  const pills: Array<{ icon: React.ComponentProps<typeof Icon>['name']; value: string }> = [];
  if (property.yearBuilt) pills.push({ icon: 'Calendar', value: String(property.yearBuilt) });
  if (property.floorAreaM2) pills.push({ icon: 'Ruler', value: `${property.floorAreaM2} m²` });
  if (property.viewCount && property.viewCount > 0) pills.push({ icon: 'Eye', value: String(property.viewCount) });
  if (pills.length === 0) return null;

  return (
    <div style={styles.statPillsRow} data-testid="stat-pills">
      {pills.map((pill) => (
        <div key={pill.icon + pill.value} style={styles.statPill}>
          <Icon name={pill.icon} size={13} color="#9C958A" />
          <span style={styles.statPillText}>{pill.value}</span>
        </div>
      ))}
    </div>
  );
}

export function PropertyMediaCard({ property, variant = 'full', onPress, testID }: PropertyMediaCardProps) {
  const imageHeight = IMAGE_HEIGHTS[variant];
  const activityLevel = property.activityLevel ?? 'cold';
  const displayPrice = getDisplayPrice(property);
  const content = (
    <Card shadow={variant === 'compact' ? 'preview' : 'card'} testID={testID ?? 'property-media-card'}>
      <div style={styles.imageWrapper}>
        <PropertyImage property={property} height={imageHeight} variant={variant} />
        {variant !== 'compact' && <div style={styles.imageOverlay}><ActivityBadge level={activityLevel} /></div>}
        {variant !== 'compact' && property.viewCount != null && property.viewCount > 0 && (
          <div style={styles.viewCountOverlay}>
            <Icon name="Eye" size={12} color="#FFFFFF" />
            <span style={styles.viewCountText}>{property.viewCount}</span>
          </div>
        )}
      </div>

      <div style={variant === 'compact' ? styles.bodyCompact : styles.bodyFull}>
        <div style={styles.addressRow}>
          <div style={styles.addressContent}>
            <div style={variant === 'compact' ? styles.addressCompact : styles.addressFull} title={property.address}>
              {property.address}
            </div>
            <div style={styles.city}>{property.city}{property.postalCode ? `, ${property.postalCode}` : ''}</div>
          </div>
          {variant === 'compact' && <ActivityDot level={activityLevel} />}
        </div>

        {variant !== 'compact' && <StatPills property={property} />}

        {displayPrice && (
          <div style={styles.priceRow}>
            {variant !== 'compact' && property.officialValuation && property.fmv && (
              <div>
                <div style={styles.priceLabel}>{getValuationLabel(property.countryCode)}</div>
                <div style={styles.secondaryPrice}>{formatPrice(property.officialValuation, property.countryCode as string)}</div>
              </div>
            )}
            <div style={variant === 'compact' ? undefined : styles.primaryPriceRight}>
              {variant !== 'compact' && <div style={styles.priceLabel}>{displayPrice.label}</div>}
              <div style={styles.primaryPriceRow}>
                <Icon name="HouseLine" size={14} color="#F5A623" />
                <div style={variant === 'compact' ? styles.priceCompact : styles.priceFull} data-testid="display-price">
                  {formatPrice(displayPrice.price, property.countryCode as string)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );

  if (onPress) {
    return (
      <button type="button" onClick={onPress} style={styles.pressable} aria-label="Property media card">
        {content}
      </button>
    );
  }

  return content;
}

const styles: Record<string, CSSProperties> = {
  imageWrapper: { position: 'relative', overflow: 'hidden' },
  placeholderContainer: { width: '100%', backgroundColor: '#F5F0E8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 },
  placeholderText: { color: '#C7BFB3', fontSize: 13, marginTop: 8 },
  imageOverlay: { position: 'absolute', top: 12, left: 12 },
  activityBadge: { display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 8, gap: 4 },
  activityBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: 600 },
  viewCountOverlay: { position: 'absolute', right: 12, bottom: 12, backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 6, gap: 4 },
  viewCountText: { color: '#FFFFFF', fontSize: 12 },
  bodyCompact: { padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 2 },
  bodyFull: { padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 },
  addressRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  addressContent: { flex: 1, marginRight: 8, minWidth: 0 },
  addressCompact: { fontSize: 15, fontWeight: 600, color: '#2D2926', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  addressFull: { fontSize: 16, fontWeight: 600, color: '#2D2926', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  city: { fontSize: 13, color: '#9C958A', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  activityDotRow: { display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 2 },
  activityDot: { width: 7, height: 7, borderRadius: 999 },
  activityDotLabel: { fontSize: 11, fontWeight: 500 },
  statPillsRow: { display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  statPill: { display: 'inline-flex', alignItems: 'center', backgroundColor: '#F5F0E8', borderRadius: 100, padding: '4px 10px', gap: 4 },
  statPillText: { fontSize: 12, fontWeight: 500, color: '#504A42' },
  priceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4, gap: 12 },
  priceLabel: { fontSize: 13, color: '#9C958A' },
  secondaryPrice: { fontSize: 15, fontWeight: 500, color: '#736C62', marginTop: 2 },
  primaryPriceRight: { alignItems: 'flex-end', display: 'flex' },
  primaryPriceRow: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 },
  priceCompact: { fontSize: 15, fontWeight: 700, color: '#2D2926' },
  priceFull: { fontSize: 16, fontWeight: 700, color: '#2D2926' },
  pressable: { padding: 0, border: 'none', background: 'transparent', width: '100%', textAlign: 'inherit', cursor: 'pointer' },
};
