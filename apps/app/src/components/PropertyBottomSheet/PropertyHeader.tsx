import { useState } from 'react';
import { Image, ScrollView, Text, View, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';
import { MetricPills } from '../MetricPills';
import type { SectionProps } from './types';
import { getPropertyAerialImageFromGeometry } from '../../lib/propertyThumbnail';
import { resolvePropertyImage } from '../../utils/property-image';
import type { CountryCode } from '@huishype/shared';

// Import the placeholder image as a static asset
const placeholderImage = require('../../../assets/images/property-placeholder.png');

interface SatelliteImageWithPinProps {
  imageUrl: string | null;
}

/**
 * SatelliteImageWithPin - Displays aerial imagery with a centered location pin
 * Uses country-gated thumbnail URL (currently only NL via PDOK)
 */
function SatelliteImageWithPin({ imageUrl }: SatelliteImageWithPinProps) {
  const [error, setError] = useState(false);

  // If no imagery available for this country, or on error, show the styled placeholder
  if (!imageUrl || error) {
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

      {/* Centered marker pin */}
      <View style={styles.markerContainer} testID="property-header-marker">
        <View style={styles.markerShadow}>
          <Icon name="MapPin" size="2xl" weight="fill" color="#FFFFFF" />
        </View>
      </View>
    </View>
  );
}

const ACTIVITY_CONFIG = {
  hot: { dot: '#FF6B35', label: 'Hot', desc: 'Lots of activity this week', textColor: '#C43E00', bg: '#FFF5F0' },
  warm: { dot: '#F5A623', label: 'Active', desc: 'Some recent activity', textColor: '#B47712', bg: '#FFFBEB' },
  cold: { dot: '#C7BFB3', label: 'Quiet', desc: 'No recent activity', textColor: '#9C958A', bg: '#F5F0E8' },
} as const;

export function PropertyHeader({ property }: SectionProps) {
  const hasPhotos = property.photos && property.photos.length > 0;
  const aerialImageUrl = resolvePropertyImage({
    listingPhotoUrl: null,
    aerialImageUrl:
      property.aerialImageUrl ??
      property.thumbnailUrl ??
      getPropertyAerialImageFromGeometry(
        property.imageryGeometry ?? property.geometry,
        property.countryCode as CountryCode,
      ),
    countryCode: property.countryCode,
  });

  const activity = ACTIVITY_CONFIG[property.activityLevel];

  return (
    <View>
      {/* Photo/Satellite Carousel — testID on View wrapper because horizontal
           ScrollView + NativeWind className doesn't propagate testID to Android
           resource-id in Fabric (New Architecture). */}
      <View testID="property-header-carousel">
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        className="h-48"
      >
        {hasPhotos ? (
          // Show actual property photos if available
          property.photos!.map((photo, index) => (
            <View key={index} className="w-screen h-48 px-4">
              <Image
                source={{ uri: photo }}
                className="w-full h-full rounded-xl bg-warm-200"
                resizeMode="cover"
              />
            </View>
          ))
        ) : (
          // Show satellite imagery with pin overlay
          <View className="w-screen h-48 px-4">
            {aerialImageUrl ? (
              <SatelliteImageWithPin imageUrl={aerialImageUrl} />
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
      </View>

      {/* Photo count indicator - only show if multiple photos */}
      {hasPhotos && property.photos!.length > 1 && (
        <View className="absolute top-2 right-6 bg-black/50 px-2 py-1 rounded-full">
          <Text className="text-white text-xs">{property.photos!.length} {property.photos!.length === 1 ? 'photo' : 'photos'}</Text>
        </View>
      )}

      {/* Address and info */}
      <View className="px-4 pt-4">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <Text className="text-xl font-bold text-warm-900" numberOfLines={2}>
              {property.address}
            </Text>
            <Text className="text-base text-warm-500 mt-1">
              {property.city}
              {property.postalCode ? `, ${property.postalCode}` : ''}
            </Text>
          </View>

          {/* Activity indicator */}
          <View className="items-end">
            <View
              style={{ backgroundColor: activity.bg }}
              className="flex-row items-center px-3 py-1.5 rounded-full"
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: activity.dot, marginRight: 6 }} />
              <Text style={{ fontSize: 12, color: activity.textColor }}>{activity.label}</Text>
            </View>
            <Text style={{ fontSize: 10, color: '#C7BFB3', marginTop: 2, marginRight: 4 }}>{activity.desc}</Text>
          </View>
        </View>

        {/* Property metric pills */}
        <View className="mt-3">
          <MetricPills
            info={{
              yearBuilt: property.yearBuilt,
              floorAreaM2: property.floorAreaM2,
              viewCount: property.viewCount,
            }}
            variant="info"
          />
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
    backgroundColor: '#FFFBF5',
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
    boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.4)',
    elevation: 5,
  },
});
