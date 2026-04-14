import React, { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  getPropertyAerialImageUrl,
  PROPERTY_AERIAL_IMAGE_BOX_SIZE_METERS,
  PROPERTY_AERIAL_IMAGE_HEIGHT,
  PROPERTY_AERIAL_IMAGE_WIDTH,
} from '../lib/propertyThumbnail';
import { getDutchAerialSnapshotUrl } from '../lib/pdok/imagery';
import { PropertyImageSurface } from './PropertyImageSurface';

export interface AerialImageCardProps {
  lat: number;
  lon: number;
  address?: string;
  width?: number;
  height?: number;
  boxSizeMeters?: number;
  testID?: string;
}

export const AerialImageCard: React.FC<AerialImageCardProps> = ({
  lat,
  lon,
  address,
  width = PROPERTY_AERIAL_IMAGE_WIDTH,
  height = PROPERTY_AERIAL_IMAGE_HEIGHT,
  boxSizeMeters = PROPERTY_AERIAL_IMAGE_BOX_SIZE_METERS,
  testID = 'aerial-image-card',
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const imageUrl =
    width === PROPERTY_AERIAL_IMAGE_WIDTH &&
    height === PROPERTY_AERIAL_IMAGE_HEIGHT &&
    boxSizeMeters === PROPERTY_AERIAL_IMAGE_BOX_SIZE_METERS
      ? getPropertyAerialImageUrl(lat, lon)
      : getDutchAerialSnapshotUrl(lat, lon, width, height, boxSizeMeters);

  return (
    <div style={styles.container} data-testid={testID}>
      <style>{SPINNER_KEYFRAMES}</style>
      <div style={styles.imageContainer}>
        {imageUrl ? (
          <PropertyImageSurface
            source={{ aerialImageUrl: imageUrl, countryCode: 'NL' }}
            style={styles.aerialImage}
            markerSize={48}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
              console.warn('AerialImageCard: Failed to load aerial image from PDOK');
            }}
            imageTestID={`${testID}-image`}
            markerTestID={`${testID}-marker`}
          />
        ) : null}

        {loading && (
          <div style={styles.loadingOverlay}>
            <div style={styles.spinner} />
          </div>
        )}

        {(error || !imageUrl) && (
          <div style={styles.errorOverlay}>
            <div style={styles.errorIcon}>📍</div>
            <div style={styles.errorText}>Unable to load aerial image</div>
          </div>
        )}
      </div>

      {address && (
        <div style={styles.addressBar} data-testid={`${testID}-address`}>
          <div style={styles.addressText}>{address}</div>
        </div>
      )}
    </div>
  );
};

const SPINNER_KEYFRAMES = `
  @keyframes huishype-aerial-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

const styles: Record<string, CSSProperties> = {
  container: {
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1A1A2E',
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    paddingTop: '75%',
  },
  aerialImage: { position: 'absolute', inset: 0 },
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(26, 26, 46, 0.8)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(26, 26, 46, 0.9)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinner: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: '3px solid rgba(255,255,255,0.25)',
    borderTopColor: '#FFFFFF',
    animation: 'huishype-aerial-spin 0.9s linear infinite',
  },
  errorIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  errorText: {
    color: '#888888',
    fontSize: 14,
  },
  addressBar: {
    backgroundColor: '#1A1A2E',
    padding: '10px 16px',
  },
  addressText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 500,
    textAlign: 'center',
  },
};

export default AerialImageCard;
