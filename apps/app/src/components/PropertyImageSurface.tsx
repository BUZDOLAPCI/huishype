import React from 'react';
import {
  Image,
  Platform,
  StyleProp,
  StyleSheet,
  type ImageResizeMode,
  type ImageStyle,
  type ViewStyle,
  View,
} from 'react-native';
import { Icon } from './ui/Icon';
import {
  resolvePropertyImageWithType,
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
}: PropertyImageSurfaceProps) {
  const resolved = resolvePropertyImageWithType(source);

  if (!resolved.url) {
    return null;
  }

  const isAerial = resolved.type === 'aerial';

  return (
    <View style={[styles.container, style]}>
      <Image
        source={{ uri: resolved.url }}
        style={[styles.image, imageStyle]}
        resizeMode={isAerial ? aerialResizeMode : listingResizeMode}
        onLoadEnd={onLoadEnd}
        onError={onError}
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
