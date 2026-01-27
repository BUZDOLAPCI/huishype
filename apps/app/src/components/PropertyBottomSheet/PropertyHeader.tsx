import { useState } from 'react';
import { Image, ScrollView, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SectionProps } from './types';
import { getDutchAerialSnapshotUrl } from '../../lib/pdok/imagery';

// Import the placeholder image as a static asset
const placeholderImage = require('../../../assets/images/property-placeholder.png');

interface SatelliteImageWithPinProps {
  lat: number;
  lon: number;
}

/**
 * SatelliteImageWithPin - Displays aerial imagery with a centered location pin
 * Similar to the AerialImageCard but optimized for PropertyHeader
 */
function SatelliteImageWithPin({ lat, lon }: SatelliteImageWithPinProps) {
  const [error, setError] = useState(false);

  // Generate the PDOK aerial imagery URL
  const imageUrl = getDutchAerialSnapshotUrl(lat, lon, 800, 600, 45);

  // If error, show the styled placeholder
  if (error) {
    return (
      <View style={styles.imageContainer} testID="property-header-placeholder">
        <Image
          source={placeholderImage}
          style={styles.placeholderImage}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={styles.imageContainer} testID="property-header-satellite">
      {/* Aerial image from PDOK */}
      <Image
        source={{ uri: imageUrl }}
        style={styles.aerialImage}
        resizeMode="cover"
        onError={() => setError(true)}
        testID="property-header-aerial-image"
      />

      {/* Centered marker pin - white pin with shadow for visibility */}
      <View style={styles.markerContainer} testID="property-header-marker">
        <View style={styles.markerShadow}>
          <Ionicons
            name="location-sharp"
            size={48}
            color="#ffffff"
            style={styles.markerIcon}
          />
        </View>
      </View>
    </View>
  );
}

export function PropertyHeader({ property }: SectionProps) {
  const hasPhotos = property.photos && property.photos.length > 0;

  // Extract coordinates from geometry
  const coordinates = property.geometry?.coordinates;
  const hasCoordinates = coordinates && coordinates.length === 2;
  const lon = hasCoordinates ? coordinates[0] : null;
  const lat = hasCoordinates ? coordinates[1] : null;

  const activityColors = {
    hot: 'bg-red-500',
    warm: 'bg-orange-400',
    cold: 'bg-gray-300',
  };

  return (
    <View>
      {/* Photo/Satellite Carousel */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        className="h-48"
        testID="property-header-carousel"
      >
        {hasPhotos ? (
          // Show actual property photos if available
          property.photos!.map((photo, index) => (
            <View key={index} className="w-screen h-48 px-4">
              <Image
                source={{ uri: photo }}
                className="w-full h-full rounded-xl bg-gray-200"
                resizeMode="cover"
              />
            </View>
          ))
        ) : (
          // Show satellite imagery with pin overlay
          <View className="w-screen h-48 px-4">
            {hasCoordinates && lat !== null && lon !== null ? (
              <SatelliteImageWithPin lat={lat} lon={lon} />
            ) : (
              // Fallback to placeholder if no coordinates
              <View style={styles.imageContainer} testID="property-header-no-coords-placeholder">
                <Image
                  source={placeholderImage}
                  style={styles.placeholderImage}
                  resizeMode="contain"
                />
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Photo count indicator - only show if multiple photos */}
      {hasPhotos && property.photos!.length > 1 && (
        <View className="absolute top-2 right-6 bg-black/50 px-2 py-1 rounded-full">
          <Text className="text-white text-xs">{property.photos!.length} photos</Text>
        </View>
      )}

      {/* Address and info */}
      <View className="px-4 pt-4">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <Text className="text-xl font-bold text-gray-900" numberOfLines={2}>
              {property.address}
            </Text>
            <Text className="text-base text-gray-500 mt-1">
              {property.city}
              {property.postalCode ? `, ${property.postalCode}` : ''}
            </Text>
          </View>

          {/* Activity indicator */}
          <View className="flex-row items-center bg-gray-50 px-3 py-1.5 rounded-full">
            <View className={`w-2 h-2 rounded-full ${activityColors[property.activityLevel]} mr-1.5`} />
            <Text className="text-xs text-gray-600 capitalize">{property.activityLevel}</Text>
          </View>
        </View>

        {/* Property badges */}
        <View className="flex-row flex-wrap gap-2 mt-3">
          {property.bouwjaar && (
            <View className="flex-row items-center bg-gray-100 px-3 py-1.5 rounded-full">
              <Ionicons name="calendar-outline" size={14} color="#6B7280" />
              <Text className="text-sm text-gray-600 ml-1">Built {property.bouwjaar}</Text>
            </View>
          )}
          {property.oppervlakte && (
            <View className="flex-row items-center bg-gray-100 px-3 py-1.5 rounded-full">
              <Ionicons name="resize-outline" size={14} color="#6B7280" />
              <Text className="text-sm text-gray-600 ml-1">{property.oppervlakte} m{'\u00B2'}</Text>
            </View>
          )}
          {property.viewCount > 0 && (
            <View className="flex-row items-center bg-gray-100 px-3 py-1.5 rounded-full">
              <Ionicons name="eye-outline" size={14} color="#6B7280" />
              <Text className="text-sm text-gray-600 ml-1">{property.viewCount} views</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  imageContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F9FAFB', // Light gray background
  },
  aerialImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  placeholderImage: {
    width: '100%',
    height: '100%',
  },
  markerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerShadow: {
    // Shadow for better visibility on aerial imagery
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  markerIcon: {
    // Offset the icon slightly up so the pin tip points to the center
    marginBottom: 24,
  },
});
