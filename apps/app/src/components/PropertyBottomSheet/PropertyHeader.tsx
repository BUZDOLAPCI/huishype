import { useEffect, useState } from 'react';
import {
  Image,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import { MetricPills } from '../MetricPills';
import type { PropertyDetailsData } from './types';
import {
  type ImageSourceType,
  resolvePropertyImageWithType,
  toPropertyImageSource,
} from '../../utils/property-image';
import { PropertyImageSurface } from '../PropertyImageSurface';

// Import the placeholder image as a static asset
const placeholderImage = require('../../../assets/images/property-placeholder.png');

interface PropertyHeroImageProps {
  property: PropertyDetailsData;
}

/**
 * PropertyHeroImage - Displays the unified property hero image with the shared
 * fallback chain: listing thumbnail -> aerial -> placeholder.
 */
function PropertyHeroImage({ property }: PropertyHeroImageProps) {
  const imageSource = toPropertyImageSource(property);
  const initialType = resolvePropertyImageWithType(imageSource).type;
  const [resolvedType, setResolvedType] = useState<ImageSourceType>(initialType);

  useEffect(() => {
    setResolvedType(initialType);
  }, [initialType]);

  const placeholder = (
    <View style={styles.imageContainer} testID="property-header-placeholder">
      <Image
        source={placeholderImage}
        style={styles.placeholderImage}
        resizeMode="contain"
      />
    </View>
  );

  if (resolvedType === 'placeholder') {
    return placeholder;
  }

  return (
    <View
      style={styles.imageContainer}
      testID={resolvedType === 'aerial' ? 'property-header-satellite' : 'property-header-listing'}
    >
      <PropertyImageSurface
        source={imageSource}
        style={styles.aerialImage}
        markerSize={36}
        imageTestID="property-header-image"
        markerTestID="property-header-marker"
        placeholder={placeholder}
        onResolvedSourceChange={setResolvedType}
      />
    </View>
  );
}

const ACTIVITY_CONFIG = {
  hot: { dot: '#FF6B35', label: 'Hot', desc: 'Lots of activity this week', textColor: '#C43E00', bg: '#FFF5F0' },
  warm: { dot: '#F5A623', label: 'Active', desc: 'Some recent activity', textColor: '#B47712', bg: '#FFFBEB' },
  cold: { dot: '#C7BFB3', label: 'Quiet', desc: 'No recent activity', textColor: '#9C958A', bg: '#F5F0E8' },
} as const;

interface PropertyHeaderProps {
  property: PropertyDetailsData;
  containerWidth?: number;
}

export function PropertyHeader({
  property,
  containerWidth: _containerWidth,
}: PropertyHeaderProps) {
  const activity = ACTIVITY_CONFIG[property.activityLevel];

  return (
    <View>
      <View
        style={styles.carouselContainer}
        testID="property-header-carousel"
      >
        <View style={styles.singleImageSlide}>
          <PropertyHeroImage property={property} />
        </View>
      </View>

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
  carouselContainer: {
    width: '100%',
  },
  singleImageSlide: {
    height: 192,
    paddingHorizontal: 16,
  },
});
