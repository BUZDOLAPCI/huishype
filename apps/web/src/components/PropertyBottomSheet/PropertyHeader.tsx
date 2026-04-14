import { useEffect, useMemo, useState } from 'react';

import { Image, StyleSheet, Text, View } from '../../runtime/dom';
import { Icon } from '../ui/Icon';
import type { PropertyDetailsData } from './types';
import { getPropertyImageCandidates, type ImageSourceType, toPropertyImageSource } from '../../utils/property-image';

const placeholderImage = new URL('../../../assets/images/property-placeholder.png', import.meta.url).href;

interface MetricPillProps {
  icon: 'Calendar' | 'Ruler' | 'Eye';
  value: string;
}

function MetricPill({ icon, value }: MetricPillProps) {
  return (
    <View style={styles.metricPill}>
      <Icon name={icon} size="xs" color="#9C958A" />
      <Text style={styles.metricPillText}>{value}</Text>
    </View>
  );
}

function MetricPillsRow({ property }: { property: PropertyDetailsData }) {
  const pills: Array<MetricPillProps> = [];

  if (property.yearBuilt) {
    pills.push({ icon: 'Calendar', value: String(property.yearBuilt) });
  }

  if (property.floorAreaM2) {
    pills.push({ icon: 'Ruler', value: `${property.floorAreaM2} m²` });
  }

  if (property.viewCount > 0) {
    pills.push({ icon: 'Eye', value: property.viewCount >= 1000 ? `${(property.viewCount / 1000).toFixed(property.viewCount >= 10000 ? 0 : 1)}K` : String(property.viewCount) });
  }

  if (pills.length === 0) {
    return null;
  }

  return (
    <View style={styles.metricRow}>
      {pills.map((pill) => (
        <MetricPill key={`${pill.icon}:${pill.value}`} icon={pill.icon} value={pill.value} />
      ))}
    </View>
  );
}

function PropertyHeroImage({ property }: { property: PropertyDetailsData }) {
  const imageSource = useMemo(() => toPropertyImageSource(property), [property]);
  const candidates = useMemo(() => getPropertyImageCandidates(imageSource), [imageSource]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [resolvedType, setResolvedType] = useState<ImageSourceType>('placeholder');

  useEffect(() => {
    setCandidateIndex(0);
  }, [property.id, imageSource.listingPhotoUrl, imageSource.aerialImageUrl, imageSource.countryCode]);

  const candidate = candidates[candidateIndex] ?? null;

  useEffect(() => {
    setResolvedType(candidate?.type ?? 'placeholder');
  }, [candidate?.type]);

  if (!candidate) {
    return (
      <View style={styles.placeholderCard} testID="property-header-placeholder">
        <Image source={placeholderImage} style={styles.placeholderImage} resizeMode="contain" />
      </View>
    );
  }

  return (
    <View
      style={styles.heroCard}
      testID={resolvedType === 'aerial' ? 'property-header-satellite' : 'property-header-listing'}
    >
      <Image
        source={{ uri: candidate.url }}
        style={styles.heroImage}
        resizeMode="cover"
        onError={() => {
          const nextIndex = candidateIndex + 1;
          if (nextIndex < candidates.length) {
            setCandidateIndex(nextIndex);
          } else {
            setCandidateIndex(candidates.length);
            setResolvedType('placeholder');
          }
        }}
        onLoad={() => setResolvedType(candidate.type)}
        testID="property-header-image"
      />

      {candidate.type === 'aerial' ? (
        <View style={styles.heroMarker} testID="property-header-marker">
          <View style={styles.heroMarkerShadow}>
            <Icon name="MapPin" size={36} weight="fill" color="#FFFFFF" />
          </View>
        </View>
      ) : null}
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

export function PropertyHeader({ property }: PropertyHeaderProps) {
  const activity = ACTIVITY_CONFIG[property.activityLevel];
  const hasSecondaryLocation = Boolean(property.city || property.postalCode);

  return (
    <View style={styles.root}>
      <View style={styles.carouselContainer} testID="property-header-carousel">
        <View style={styles.singleImageSlide}>
          <PropertyHeroImage property={property} />
        </View>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.copyRow}>
          <View style={styles.addressColumn}>
            <Text style={styles.kicker}>Property Detail</Text>
            <Text style={styles.address} numberOfLines={2}>
              {property.address}
            </Text>
            {hasSecondaryLocation ? (
              <Text style={styles.location}>
                {property.city}
                {property.postalCode ? `, ${property.postalCode}` : ''}
              </Text>
            ) : null}
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
          <MetricPillsRow property={property} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  heroCard: {
    position: 'relative',
    width: '100%',
    height: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFF7EB',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroMarker: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  heroMarkerShadow: {
    boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.28)',
  },
  placeholderCard: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    background: 'linear-gradient(180deg, #FFF7EB 0%, #FFF1D8 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderImage: {
    width: '100%',
    height: '100%',
  },
  summaryCard: {
    marginHorizontal: 16,
    marginTop: -28,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFFFF',
    boxShadow: '0px 14px 30px rgba(77, 61, 31, 0.08)',
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
  metricRow: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F0E8',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  metricPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#504A42',
  },
});
