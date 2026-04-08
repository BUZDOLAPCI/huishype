import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {
  getPropertyAerialImageUrl,
  PROPERTY_AERIAL_IMAGE_BOX_SIZE_METERS,
  PROPERTY_AERIAL_IMAGE_HEIGHT,
  PROPERTY_AERIAL_IMAGE_WIDTH,
} from '../lib/propertyThumbnail';
import { getDutchAerialSnapshotUrl } from '../lib/pdok/imagery';
import { PropertyImageSurface } from './PropertyImageSurface';

export interface AerialImageCardProps {
  /** Latitude in WGS84 (EPSG:4326) */
  lat: number;
  /** Longitude in WGS84 (EPSG:4326) */
  lon: number;
  /** Optional address text to display at bottom */
  address?: string;
  /** Image width in pixels (default canonical property aerial width) */
  width?: number;
  /** Image height in pixels (default canonical property aerial height) */
  height?: number;
  /** Bounding box size in meters (default canonical property aerial framing) */
  boxSizeMeters?: number;
  /** Test ID for e2e testing */
  testID?: string;
}

/**
 * AerialImageCard - Displays a PDOK aerial image with a centered marker pin
 *
 * This component fetches aerial imagery from the Dutch PDOK WMS service
 * and displays it with a location marker overlay, similar to woningstats.nl
 */
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

  const handleLoadEnd = () => {
    setLoading(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
    console.warn('AerialImageCard: Failed to load aerial image from PDOK');
  };

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.imageContainer}>
        {/* Aerial image from PDOK */}
        {imageUrl ? (
          <PropertyImageSurface
            source={{ aerialImageUrl: imageUrl, countryCode: 'NL' }}
            style={styles.aerialImage}
            markerSize={48}
            onLoadEnd={handleLoadEnd}
            onError={handleError}
            imageTestID={`${testID}-image`}
            markerTestID={`${testID}-marker`}
          />
        ) : null}

        {/* Loading indicator */}
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}

        {/* Error state */}
        {(error || !imageUrl) && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorIcon}>📍</Text>
            <Text style={styles.errorText}>Unable to load aerial image</Text>
          </View>
        )}
      </View>

      {/* Address bar at bottom */}
      {address && (
        <View style={styles.addressBar} testID={`${testID}-address`}>
          <Text style={styles.addressText} numberOfLines={1}>
            {address}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1A1A2E',
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    paddingTop: '75%', // 4:3 without aspectRatio parser issues on Android
  },
  aerialImage: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26, 26, 46, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26, 26, 46, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  addressText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default AerialImageCard;
