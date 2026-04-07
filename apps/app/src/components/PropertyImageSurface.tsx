import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Platform,
  type ImageProps,
  type ImageSourcePropType,
  StyleProp,
  StyleSheet,
  type ImageResizeMode,
  type ImageStyle,
  type ViewStyle,
  View,
} from 'react-native';
import { Icon } from './ui/Icon';
import {
  getPropertyImageCandidates,
  type ImageSourceType,
  type PropertyImageSource,
} from '../utils/property-image';

export interface PropertyImageSurfaceProps {
  source: PropertyImageSource;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  listingResizeMode?: ImageResizeMode;
  aerialResizeMode?: ImageResizeMode;
  markerSize?: number;
  imageTestID?: string;
  markerTestID?: string;
  onLoadEnd?: () => void;
  onError?: () => void;
  placeholder?: React.ReactNode;
  onResolvedSourceChange?: (type: ImageSourceType) => void;
}

export function PropertyImageSurface({
  source,
  style,
  imageStyle,
  listingResizeMode = 'cover',
  aerialResizeMode = 'cover',
  markerSize = 36,
  imageTestID,
  markerTestID,
  onLoadEnd,
  onError,
  placeholder,
  onResolvedSourceChange,
}: PropertyImageSurfaceProps) {
  const {
    listingPhotoUrl,
    aerialImageUrl,
    countryCode,
  } = source;
  const candidateKey = `${listingPhotoUrl ?? ''}|${aerialImageUrl ?? ''}|${countryCode ?? ''}`;
  const candidates = useMemo(
    () => getPropertyImageCandidates(source),
    [source],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateKey]);

  const resolved = candidates[candidateIndex] ?? null;

  useEffect(() => {
    onResolvedSourceChange?.(resolved?.type ?? 'placeholder');
  }, [onResolvedSourceChange, resolved?.type]);

  if (!resolved?.url) {
    return placeholder ? <>{placeholder}</> : null;
  }

  const isAerial = resolved.type === 'aerial';
  const handleError: NonNullable<ImageProps['onError']> = () => {
    const nextCandidateIndex = candidateIndex + 1;

    if (nextCandidateIndex < candidates.length) {
      setCandidateIndex(nextCandidateIndex);
      return;
    }

    setCandidateIndex(candidates.length);
    onError?.();
  };

  return (
    <View style={[styles.container, style]}>
      <Image
        source={{ uri: resolved.url } as ImageSourcePropType}
        style={[styles.image, imageStyle]}
        resizeMode={isAerial ? aerialResizeMode : listingResizeMode}
        onLoadEnd={onLoadEnd}
        onError={handleError}
        testID={imageTestID}
      />

      {isAerial && (
        <View
          style={[styles.markerContainer, styles.markerPointerEvents]}
          testID={markerTestID}
        >
          <View style={styles.markerShadow}>
            <View
              style={[
                styles.markerOffset,
                { marginBottom: Math.round(markerSize * 0.16) },
              ]}
            >
              <Icon
                name="MapPin"
                size={markerSize}
                weight="fill"
                color="#FFFFFF"
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFBF5',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  markerContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerPointerEvents: {
    pointerEvents: 'none',
  },
  markerShadow: Platform.select({
    web: {
      boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.28)',
    },
    default: {
      shadowColor: '#000000',
      shadowOpacity: 0.28,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 5,
    },
  }) as ViewStyle,
  markerOffset: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PropertyImageSurface;
