import { StyleSheet, Text, View } from 'react-native';

import type { PropertyContentData } from './types';
import { getPropertyAddressTitle, getPropertySecondaryLocation } from './PropertyHeader';

interface CompactPropertyHeaderProps {
  property: PropertyContentData;
}

export function CompactPropertyHeader({ property }: CompactPropertyHeaderProps) {
  const title = getPropertyAddressTitle(property);
  const secondaryLocation = getPropertySecondaryLocation(property);

  if (!title) {
    return null;
  }

  return (
    <View style={styles.root} testID="property-compact-header">
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {secondaryLocation ? (
        <Text style={styles.secondaryLocation} numberOfLines={1}>
          {secondaryLocation}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  title: {
    color: '#2D2926',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  secondaryLocation: {
    color: '#8C8479',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 15,
  },
});
