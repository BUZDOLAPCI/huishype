import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MetricPills } from '../MetricPills';
import type { PropertyDetailsData } from './types';
import {
  type ImageSourceType,
  resolvePropertyImageWithType,
  toPropertyImageSource,
} from '../../utils/property-image';
import { PropertyImageSurface } from '../PropertyImageSurface';
import { Card } from '../ui/Card';
import { useT } from '@/src/i18n';
import { ActivityPill, ListingPill, StatusPillRow } from '../PropertyStatusPills';

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
      <Image source={placeholderImage} style={styles.placeholderImage} resizeMode="contain" />
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
  hot: { desc: 'Lots of activity this week' },
  warm: { desc: 'Some recent activity' },
  cold: { desc: 'No recent activity' },
} as const;

interface PropertyHeaderProps {
  property: PropertyDetailsData;
  containerWidth?: number;
  onHalfExpandedBodyPress?: () => void;
  onSummaryCardBottomLayout?: (bottomY: number) => void;
  onHeaderClose?: () => void;
}

function normalizePropertyText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatGoogleMapsAddressPart(
  part: string | null | undefined,
  countryCode: string
): string | undefined {
  const trimmed = normalizePropertyText(part);

  if (!trimmed) {
    return undefined;
  }

  if (countryCode.toUpperCase() !== 'NL') {
    return trimmed;
  }

  return trimmed.replace(
    /\b([1-9]\d{3})\s+([A-Za-z]{2})\b/g,
    (_match: string, digits: string, letters: string) => `${digits}${letters.toUpperCase()}`
  );
}

function getGoogleMapsUrl(property: PropertyDetailsData): string {
  const countryCode = normalizePropertyText(property.countryCode);
  const city = normalizePropertyText(property.city);
  const addressQuery = [
    formatGoogleMapsAddressPart(property.address, countryCode),
    formatGoogleMapsAddressPart(property.postalCode, countryCode),
    city,
    countryCode,
  ]
    .filter(Boolean)
    .join(', ');

  if (addressQuery) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery)}`;
  }

  if (property.geometry?.type === 'Point') {
    const [longitude, latitude] = property.geometry.coordinates;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${latitude},${longitude}`
    )}`;
  }

  return 'https://www.google.com/maps';
}

export function getPropertyAddressTitle(
  property: Pick<PropertyDetailsData, 'address'>
): string {
  const address = normalizePropertyText(property.address);
  const streetAddress = address.split(',', 1)[0]?.trim();
  return streetAddress || address;
}

export function PropertyHeader({
  property,
  containerWidth: _containerWidth,
  onHalfExpandedBodyPress,
  onSummaryCardBottomLayout,
  onHeaderClose,
}: PropertyHeaderProps) {
  const t = useT();
  const activity = ACTIVITY_CONFIG[property.activityLevel];
  const city = normalizePropertyText(property.city);
  const postalCode = normalizePropertyText(property.postalCode);
  const secondaryLocation = [city, postalCode].filter(Boolean).join(', ');
  const hasSecondaryLocation = secondaryLocation.length > 0;
  const googleMapsUrl = getGoogleMapsUrl(property);
  const addressTitle = getPropertyAddressTitle(property);

  const handleOpenGoogleMaps = async () => {
    try {
      await Linking.openURL(googleMapsUrl);
    } catch (error) {
      console.error('Error opening Google Maps:', error);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.carouselContainer}>
        <Pressable
          onPress={onHalfExpandedBodyPress}
          pointerEvents="box-only"
          style={styles.singleImageSlide}
          testID="property-header-carousel"
        >
          <PropertyHeroImage property={property} />
        </Pressable>
        {onHeaderClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.closePanel')}
            onPress={onHeaderClose}
            style={({ pressed }) => [
              styles.headerCloseButton,
              pressed && styles.headerCloseButtonPressed,
            ]}
            testID="property-header-close"
          >
            <Ionicons name="close" size={20} color="#9C958A" />
          </Pressable>
        ) : null}
      </View>

      <View
        onLayout={(event) => {
          const { y, height } = event.nativeEvent.layout;
          onSummaryCardBottomLayout?.(y + height);
        }}
        testID="property-header-summary-card"
      >
        <Card shadow="card" style={styles.summaryCard}>
          <Pressable
            onPress={onHalfExpandedBodyPress}
            pointerEvents="box-only"
            testID="property-header-passive-summary"
          >
            <View style={styles.copyRow}>
              <View style={styles.addressColumn}>
                <Text style={styles.kicker}>Property Detail</Text>
                <Text style={styles.address} numberOfLines={2}>
                  {addressTitle}
                </Text>
                {hasSecondaryLocation && <Text style={styles.location}>{secondaryLocation}</Text>}
              </View>

              <View style={styles.activityColumn}>
                <StatusPillRow style={styles.statusPills} testID="property-header-status-pills">
                  <ActivityPill
                    level={property.activityLevel}
                    size="md"
                    testID="property-header-activity-pill"
                  />
                  <ListingPill
                    marketState={property.marketState}
                    size="md"
                    testID="property-header-listing-pill"
                  />
                </StatusPillRow>
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
          </Pressable>

          <View style={styles.mapLinkRow}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('property.map.openPropertyInGoogleMaps')}
              onPress={handleOpenGoogleMaps}
              style={({ pressed }) => [styles.mapLinkButton, pressed && styles.mapLinkButtonPressed]}
            >
              <Ionicons name="map-outline" size={14} color="#8C8479" />
              <Text style={styles.mapLinkText}>{t('property.map.openInGoogleMaps')}</Text>
              <Ionicons name="open-outline" size={13} color="#B8AFA3" />
            </Pressable>
          </View>
        </Card>
      </View>
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
  headerCloseButton: {
    position: 'absolute',
    top: 12,
    right: 28,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#F5EBDD',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    zIndex: 2,
  },
  headerCloseButtonPressed: {
    backgroundColor: '#F5F0E8',
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
    maxWidth: 210,
  },
  statusPills: {
    justifyContent: 'flex-end',
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
  mapLinkRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  mapLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFCF7',
  },
  mapLinkButtonPressed: {
    backgroundColor: '#FFF7EB',
  },
  mapLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8C8479',
  },
});
