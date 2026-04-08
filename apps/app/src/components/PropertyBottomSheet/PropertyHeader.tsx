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
import { Card } from '../ui/Card';

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
  const hasSecondaryLocation = Boolean(property.city || property.postalCode);

  return (
    <View style={styles.root}>
      <View style={styles.carouselContainer} testID="property-header-carousel">
        <View style={styles.singleImageSlide}>
          <PropertyHeroImage property={property} />
        </View>
      </View>

      <Card shadow="card" style={styles.summaryCard}>
        <View style={styles.copyRow}>
          <View style={styles.addressColumn}>
            <Text style={styles.kicker}>Property Detail</Text>
            <Text style={styles.address} numberOfLines={2}>
              {property.address}
            </Text>
            {hasSecondaryLocation && (
              <Text style={styles.location}>
                {property.city}
                {property.postalCode ? `, ${property.postalCode}` : ''}
              </Text>
            )}
          </View>

          <View style={styles.activityColumn}>
            <View style={[styles.activityBadge, { backgroundColor: activity.bg }]}>
              <View style={[styles.activityDot, { backgroundColor: activity.dot }]} />
              <Text style={[styles.activityLabel, { color: activity.textColor }]}>
                {activity.label}
              </Text>
            </View>
            <Text style={styles.activityDescription}>{activity.desc}</Text>
          </View>
        </View>

        <View style={styles.metricWrap}>
          <MetricPills
            info={{
              yearBuilt: property.yearBuilt,
              floorAreaM2: property.floorAreaM2,
              viewCount: property.viewCount,
            }}
            variant="info"
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  imageContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFF7EB',
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
  root: {
    paddingTop: 16,
  },
  carouselContainer: {
    width: '100%',
  },
  singleImageSlide: {
    height: 238,
    paddingHorizontal: 16,
  },
  summaryCard: {
    marginHorizontal: 16,
    marginTop: -28,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: '#F5EBDD',
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  addressColumn: {
    flex: 1,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#CFA257',
    marginBottom: 8,
  },
  address: {
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '700',
    color: '#2D2926',
  },
  location: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 21,
    color: '#8C8479',
  },
  activityColumn: {
    alignItems: 'flex-end',
    maxWidth: 116,
  },
  activityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 7,
  },
  activityLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  activityDescription: {
    marginTop: 6,
    textAlign: 'right',
    fontSize: 11,
    lineHeight: 14,
    color: '#C7BFB3',
  },
  metricWrap: {
    marginTop: 16,
  },
});
