import React, { useState } from 'react';
import {
  View,
  Image,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDutchAerialSnapshotUrl } from '../lib/pdok/imagery';

export interface AerialImageCardProps {
  /** Latitude in WGS84 (EPSG:4326) */
  lat: number;
  /** Longitude in WGS84 (EPSG:4326) */
  lon: number;
  /** Optional address text to display at bottom */
  address?: string;
  /** Image width in pixels (default 800) */
  width?: number;
  /** Image height in pixels (default 600) */
  height?: number;
  /** Bounding box size in meters (default 45) */
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
  width = 800,
  height = 600,
  boxSizeMeters = 45,
  testID = 'aerial-image-card',
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const imageUrl = getDutchAerialSnapshotUrl(lat, lon, width, height, boxSizeMeters);

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
        <Image
          source={{ uri: imageUrl }}
          style={styles.aerialImage}
          resizeMode="cover"
          onLoadEnd={handleLoadEnd}
          onError={handleError}
          testID={`${testID}-image`}
        />

        {/* Loading indicator */}
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}

        {/* Error state */}
        {error && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorIcon}>📍</Text>
            <Text style={styles.errorText}>Unable to load aerial image</Text>
          </View>
        )}

        {/* Centered marker pin - using Ionicons location icon like woningstats */}
        {!error && (
          <View style={styles.markerContainer} testID={`${testID}-marker`}>
            <Ionicons
              name="location-sharp"
              size={48}
              color="#ffffff"
              style={styles.markerIcon}
            />
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
    backgroundColor: '#1a1a2e',
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: 4 / 3, // 800x600 = 4:3
  },
  aerialImage: {
    width: '100%',
    height: '100%',
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
    color: '#888',
    fontSize: 14,
  },
  markerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  markerIcon: {
    // Offset the icon slightly up so the pin tip points to the center
    marginBottom: 24,
  },
  addressBar: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  addressText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default AerialImageCard;
