import type { CSSProperties } from 'react';
import { formatPropertyPrice, type CountryCode } from '@huishype/shared';

interface PropertyCardProps {
  address: string;
  city: string;
  imageUrl?: string;
  fmv?: number;
  askingPrice?: number;
  activityLevel?: 'hot' | 'warm' | 'cold';
  countryCode?: CountryCode;
}

export function PropertyCard({
  address,
  city,
  imageUrl,
  fmv,
  askingPrice,
  activityLevel = 'cold',
  countryCode,
}: PropertyCardProps) {
  const activityColors = {
    hot: '#EF4444',
    warm: '#FB923C',
    cold: '#E8E0D4',
  } as const;

  return (
    <div style={styles.card}>
      {imageUrl ? (
        <img src={imageUrl} alt="" style={styles.image} />
      ) : (
        <div style={styles.placeholder}>
          <span style={styles.placeholderText}>No image available</span>
        </div>
      )}
      <div style={styles.body}>
        <div style={styles.headerRow}>
          <span style={styles.address} title={address}>
            {address}
          </span>
          <span
            style={{
              ...styles.activityDot,
              backgroundColor: activityColors[activityLevel],
            }}
          />
        </div>
        <div style={styles.city}>{city}</div>
        <div style={styles.priceRow}>
          {fmv !== undefined && (
            <div>
              <div style={styles.priceLabel}>Crowd FMV</div>
              <div style={styles.price}>{formatPropertyPrice(fmv, countryCode)}</div>
            </div>
          )}
          {askingPrice !== undefined && (
            <div>
              <div style={styles.priceLabel}>Asking Price</div>
              <div style={styles.price}>{formatPropertyPrice(askingPrice, countryCode)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    margin: 8,
    boxShadow: '0 12px 28px rgba(180, 119, 18, 0.12), 0 3px 10px rgba(0, 0, 0, 0.05)',
  },
  image: {
    width: '100%',
    height: 160,
    objectFit: 'cover',
    display: 'block',
  },
  placeholder: {
    width: '100%',
    height: 160,
    backgroundColor: '#F5F0E8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#C7BFB3',
  },
  body: {
    padding: 16,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  address: {
    fontSize: 18,
    fontWeight: 600,
    color: '#2D2926',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  activityDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    flexShrink: 0,
  },
  city: {
    fontSize: 14,
    color: '#9C958A',
    marginBottom: 12,
  },
  priceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  priceLabel: {
    fontSize: 12,
    color: '#C7BFB3',
  },
  price: {
    fontSize: 15,
    fontWeight: 700,
    color: '#504A42',
  },
};
