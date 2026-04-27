import React from 'react';
import {
  Dimensions,
  Image,
  type ImageSourcePropType,
  StyleSheet,
  useWindowDimensions as useRNWindowDimensions,
  View,
  type ViewProps,
} from 'react-native';

const portraitBackground = require('@/assets/images/backgrounds/ui-background-portrait.png') as ImageSourcePropType;
const landscapeBackground = require('@/assets/images/backgrounds/ui-background-landscape.png') as ImageSourcePropType;
const hasImageComponent = typeof Image !== 'undefined';

function getFallbackWindowDimensions() {
  return (Dimensions as typeof Dimensions | undefined)?.get?.('window') ?? {
    width: 375,
    height: 812,
    scale: 1,
    fontScale: 1,
  };
}

const useScreenWindowDimensions = (
  typeof useRNWindowDimensions === 'function'
    ? useRNWindowDimensions
    : getFallbackWindowDimensions
) as typeof useRNWindowDimensions;

interface ScreenBackgroundProps extends ViewProps {
  children: React.ReactNode;
}

export function ScreenBackground({
  children,
  style,
  ...props
}: ScreenBackgroundProps) {
  const { width, height } = useScreenWindowDimensions();
  const isLandscape = width > height;
  const backgroundTestID = isLandscape ? 'screen-background-landscape' : 'screen-background-portrait';

  return (
    <View {...props} style={[styles.root, style]}>
      <View
        pointerEvents="none"
        style={styles.backgroundLayer}
      >
        {hasImageComponent ? (
          <Image
            source={isLandscape ? landscapeBackground : portraitBackground}
            resizeMode="cover"
            style={styles.image}
            testID={backgroundTestID}
          />
        ) : (
          <View style={styles.image} testID={backgroundTestID} />
        )}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFBF5',
    overflow: 'hidden',
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  image: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
