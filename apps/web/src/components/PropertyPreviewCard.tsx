/**
 * PropertyPreviewCard — Presentational single-property content for map preview cards.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { Icon } from './ui/Icon';
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';
import { toPropertyImageSource } from '../utils/property-image';
import { PropertyImageSurface } from './PropertyImageSurface';

const COLORS = {
  white: '#FFFFFF',
  warm200: '#F5F0E8',
  warm400: '#C7BFB3',
  warm500: '#9C958A',
  warm600: '#736C62',
  warm700: '#504A42',
  warm900: '#2D2926',
  gold500: '#F5A623',
  gold600: '#DE911D',
  hotRed500: '#FF6B35',
  infoBlue500: '#42A5F5',
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
  listingPhotoUrl?: string | null;
  aerialImageUrl?: string | null;
  likeCount?: number;
  commentCount?: number;
  guessCount?: number;
}

type NativeHitTargetRegistration = {
  ref?: ((node: any) => void) | undefined;
  onLayout?: (() => void) | undefined;
};

export interface PropertyPreviewCardProps {
  property: PropertyPreviewData;
  isLiked?: boolean;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
  onPress?: () => void;
  onClose?: () => void;
  showCloseButton?: boolean;
  showArrow?: boolean;
  nativeHitTargets?: {
    close?: NativeHitTargetRegistration;
    like?: NativeHitTargetRegistration;
    comment?: NativeHitTargetRegistration;
    guess?: NativeHitTargetRegistration;
  };
}

function formatPrice(value: number | null | undefined, countryCode?: string): string | null {
  if (value === null || value === undefined) return null;
  return formatPropertyPrice(value, countryCode as CountryCode);
}

function getDisplayPrice(property: PropertyPreviewData): { price: number; label: string } | null {
  if (property.fmv != null) return { price: property.fmv, label: 'Crowd FMV' };
  if (property.askingPrice != null) return { price: property.askingPrice, label: 'Asking Price' };
  if (property.officialValuation != null) {
    return { price: property.officialValuation, label: getValuationLabel(property.countryCode) };
  }
  return null;
}

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
}: PropertyPreviewCardProps) {
  const activityLevel = property.activityLevel ?? 'cold';
  const activity = ACTIVITY_CONFIG[activityLevel];
  const displayPrice = getDisplayPrice(property);
  const formattedPrice = formatPrice(displayPrice?.price, property.countryCode);
  const imageSource = toPropertyImageSource({
    listingPhotoUrl: property.listingPhotoUrl,
    thumbnailUrl: property.thumbnailUrl,
    aerialImageUrl: property.aerialImageUrl,
    countryCode: property.countryCode,
  });

  const card = (
    <div
      data-testid="property-preview-card"
      style={styles.card}
      role="button"
      tabIndex={0}
      onClick={onPress}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPress?.();
        }
      }}
    >
      <div style={styles.imageWrapper}>
        <PropertyImageSurface
          source={imageSource}
          style={styles.image}
          markerSize={24}
          imageTestID="property-thumbnail-image"
          markerTestID="property-thumbnail-marker"
          placeholder={
            <div style={styles.placeholder} data-testid="property-thumbnail-placeholder">
              <Icon name="HouseLine" size="xl" color={COLORS.warm400} />
            </div>
          }
        />

        {showCloseButton && onClose && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            style={styles.closeButton}
            data-testid="property-preview-close-button"
            aria-label="Close preview"
          >
            <Icon name="X" size={14} color={COLORS.warm700} />
          </button>
        )}
      </div>

      <div style={styles.body}>
        <div style={styles.addressRow}>
          <div style={styles.address} title={property.address}>{property.address}</div>
          <div style={{ ...styles.activityBadge, backgroundColor: activity.bg }}>
            <div style={{ ...styles.activityDot, backgroundColor: activity.dot }} />
            <span style={{ ...styles.activityLabel, color: activity.textColor }}>{activity.label}</span>
          </div>
        </div>

        <div style={styles.city} title={property.city}>
          {property.city}{property.postalCode ? `, ${property.postalCode}` : ''}
        </div>

        <div style={styles.statPillsRow}>
          {property.likeCount != null && property.likeCount > 0 && (
            <div style={styles.statMetric} data-testid="property-preview-like-count">
              <Icon name="Heart" size={14} color={COLORS.gold500} weight={isLiked ? 'fill' : 'regular'} />
              <span style={{ ...styles.statMetricText, color: COLORS.gold600 }}>{formatCompactCount(property.likeCount)}</span>
            </div>
          )}

          {property.commentCount != null && property.commentCount > 0 && (
            <>
              {property.likeCount != null && property.likeCount > 0 && <div style={styles.statDivider} />}
              <div style={styles.statMetric} data-testid="property-preview-comment-count">
                <Icon name="ChatCircle" size={14} color={COLORS.infoBlue500} />
                <span style={{ ...styles.statMetricText, color: '#1E88E5' }}>{formatCompactCount(property.commentCount)}</span>
              </div>
            </>
          )}

          {formattedPrice && (
            <div style={styles.priceGroup}>
              <div style={styles.priceLabel}>{displayPrice?.label}</div>
              <div style={styles.priceValueRow}>
                <Icon name="HouseLine" size={14} color={COLORS.gold500} />
                <span style={styles.priceText}>{formattedPrice}</span>
              </div>
            </div>
          )}
        </div>

        <div style={styles.actionsContainer}>
          <button type="button" onClick={(event) => { event.stopPropagation(); onLike?.(); }} style={styles.actionButton} data-testid="group-preview-like-button" aria-label={isLiked ? 'Liked' : 'Like'}>
            <Icon name="Heart" size={18} weight={isLiked ? 'fill' : 'regular'} color={isLiked ? COLORS.hotRed500 : COLORS.heartPink} />
            <span style={{ ...styles.actionLabel, color: isLiked ? COLORS.hotRed500 : COLORS.heartPink }}>{isLiked ? 'Liked' : 'Like'}</span>
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onComment?.(); }} style={styles.actionButton} data-testid="group-preview-comment-button" aria-label="Comment">
            <Icon name="ChatCircle" size={18} color={COLORS.commentGreen} />
            <span style={{ ...styles.actionLabel, color: COLORS.commentGreen }}>Comment</span>
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onGuess?.(); }} style={styles.actionButton} data-testid="group-preview-guess-button" aria-label="Guess">
            <Icon name="Tag" size={18} color={COLORS.guessOlive} />
            <span style={{ ...styles.actionLabel, color: COLORS.guessOlive }}>Guess</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (showArrow) {
    return (
      <div style={styles.wrapperWithArrow} data-testid="property-preview-wrapper">
        {card}
        <div style={styles.arrow} data-testid="property-preview-arrow" />
      </div>
    );
  }

  return card;
}

function formatCompactCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

const styles: Record<string, CSSProperties> = {
  card: { backgroundColor: COLORS.white, borderRadius: CARD_RADIUS, overflow: 'hidden', width: '100%' },
  imageWrapper: { position: 'relative', width: '100%', height: IMAGE_HEIGHT, overflow: 'hidden' },
  image: { width: '100%', height: IMAGE_HEIGHT },
  placeholder: { width: '100%', height: IMAGE_HEIGHT, backgroundColor: COLORS.warm200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  closeButton: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.92)', border: `1px solid ${COLORS.warm200}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  body: { padding: '12px 14px 4px', display: 'flex', flexDirection: 'column', gap: 4 },
  addressRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  address: { flex: 1, fontSize: 16, lineHeight: '20px', fontWeight: 700, color: COLORS.warm900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  activityBadge: { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '4px 8px', gap: 4, marginTop: 1 },
  activityDot: { width: 8, height: 8, borderRadius: 999 },
  activityLabel: { fontSize: 11, fontWeight: 600 },
  city: { fontSize: 13.5, lineHeight: '18px', color: COLORS.warm600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statPillsRow: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, minHeight: 22, flexWrap: 'wrap' },
  statMetric: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  statMetricText: { fontSize: 13, fontWeight: 600 },
  statDivider: { width: 1, height: 14, backgroundColor: COLORS.warm200 },
  priceGroup: { display: 'flex', alignItems: 'flex-end', marginLeft: 'auto' },
  priceLabel: { fontSize: 11.5, lineHeight: '14px', fontWeight: 700, color: COLORS.warm500, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  priceValueRow: { display: 'flex', alignItems: 'center', gap: 4 },
  priceText: { fontSize: 15.5, fontWeight: 800, color: COLORS.warm900 },
  actionsContainer: { display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${COLORS.warm200}`, padding: '9px 8px 10px', marginTop: 4 },
  actionButton: { display: 'inline-flex', alignItems: 'center', minHeight: 44, minWidth: 44, padding: '0 8px', gap: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit' },
  actionLabel: { fontSize: 13, fontWeight: 600 },
  wrapperWithArrow: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, width: '100%' },
  arrow: { width: 0, height: 0, borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderTop: '10px solid #FFFFFF', filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.09))' },
};
