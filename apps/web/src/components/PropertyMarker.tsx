import React from 'react';
import type { CSSProperties } from 'react';

interface PropertyMarkerProps {
  price?: number;
  isActive?: boolean;
  activityLevel?: 'hot' | 'warm' | 'cold';
  onPress?: () => void;
}

export function PropertyMarker({
  price,
  isActive = false,
  activityLevel = 'cold',
  onPress,
}: PropertyMarkerProps) {
  const activityStyles = {
    hot: { backgroundColor: '#EF4444', borderColor: '#DC2626' },
    warm: { backgroundColor: '#FB923C', borderColor: '#F97316' },
    cold: { backgroundColor: '#C7BFB3', borderColor: '#9C958A' },
  } as const;

  return (
    <button type="button" onClick={onPress} style={{ ...styles.button, ...(isActive ? styles.active : styles.inactive) }}>
      <div
        style={{
          ...styles.marker,
          ...activityStyles[activityLevel],
          ...(price !== undefined ? styles.markerWithPrice : styles.markerDot),
        }}
      >
        {price !== undefined && <span style={styles.price}>€{(price / 1000).toFixed(0)}k</span>}
      </div>
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  button: {
    border: 'none',
    background: 'transparent',
    padding: 0,
    cursor: 'pointer',
  },
  active: { transform: 'scale(1.1)', filter: 'drop-shadow(0 10px 16px rgba(0, 0, 0, 0.16))' },
  inactive: { transform: 'scale(1)' },
  marker: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderStyle: 'solid',
    borderWidth: 2,
    color: '#FFFFFF',
  },
  markerWithPrice: { padding: '4px 8px' },
  markerDot: { width: 16, height: 16 },
  price: { color: '#FFFFFF', fontSize: 12, fontWeight: 700 },
};
