import React from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import type { LocationSearchSuggestion } from '@huishype/shared';
import { useT } from '@/src/i18n';
import { Icon } from './ui/Icon';
/**
 * Design spec (Section 7.3):
 * - Width: 370px or screen - 32px on narrow screens (handled by parent)
 * - Corner radius: 12px
 * - Fill: #FFFFFF
 * - Shadow (primary): blur 16, color #B4771220, offset (0, 4)
 * - Shadow (secondary): blur 4, color #00000008, offset (0, 1)
 * - Result row:
 *   - Gap: 12px between icon and text
 *   - Padding: [14, 16]
 *   - Pin icon: Phosphor map-pin, 20px, $gold-500 (#F5A623)
 *   - Address text: DM Sans 14/500, $warm-900 (#2D2926)
 *   - City text: DM Sans 12/400, $warm-500 (#9C958A)
 *   - Divider: 1px, $warm-200 (#F5F0E8)
 */

const COLORS = {
  white: '#FFFFFF',
  warm100: '#FFF8F0',
  warm200: '#F5F0E8',
  warm500: '#9C958A',
  warm900: '#2D2926',
  gold500: '#F5A623',
} as const;

function getLocationTypeLabelKey(type: LocationSearchSuggestion['type']) {
  switch (type) {
    case 'property':
      return 'search.locationType.property';
    case 'address':
      return 'search.locationType.address';
    case 'street':
      return 'search.locationType.street';
    case 'postcode':
      return 'search.locationType.postcode';
    case 'city':
      return 'search.locationType.city';
    case 'region':
      return 'search.locationType.region';
    case 'country':
      return 'search.locationType.country';
  }
}

export interface SearchResultsProps {
  results: ResolvedAddress[];
  locationSuggestions?: LocationSearchSuggestion[];
  isLoading: boolean;
  query: string;
  showCurrentLocationAction?: boolean;
  highlightedIndex?: number | null;
  onResultPress: (address: ResolvedAddress) => void;
  onLocationSuggestionPress?: (suggestion: LocationSearchSuggestion) => void;
  onCurrentLocationPress?: () => void;
}

/**
 * Dropdown list of geocoder address search results.
 * Shown below the search input when the user types.
 */
export function SearchResults({
  results,
  locationSuggestions,
  isLoading,
  query,
  showCurrentLocationAction = false,
  highlightedIndex = null,
  onResultPress,
  onLocationSuggestionPress,
  onCurrentLocationPress,
}: SearchResultsProps) {
  const t = useT();
  const typedSuggestions = locationSuggestions ?? [];
  const hasTypedSuggestions = typedSuggestions.length > 0;
  const hasAddressResults = results.length > 0;
  const formatLocationSuggestionSubtitle = (item: LocationSearchSuggestion): string =>
    [t(getLocationTypeLabelKey(item.type)), item.subtitle].filter(Boolean).join(' - ');

  // Don't render anything if query is too short
  if (query.length < 2 && !showCurrentLocationAction) return null;

  if (isLoading && !hasTypedSuggestions && !hasAddressResults) {
    return (
      <View
        style={[
          styles.dropdownContainer,
          Platform.OS === 'web'
            ? ({
                boxShadow: '0 18px 34px rgba(90, 82, 73, 0.14), 0 4px 12px rgba(0, 0, 0, 0.06)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
              } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
            : null,
        ]}
        testID="search-results-loading"
      >
        <ActivityIndicator size="small" color={COLORS.gold500} />
        <Text style={styles.statusText}>{t('search.loading')}</Text>
      </View>
    );
  }

  if (showCurrentLocationAction && query.length < 2) {
    return (
      <View style={styles.resultListContainer} testID="search-results-list">
        <Pressable
          testID="search-current-location"
          onPress={onCurrentLocationPress}
          style={styles.resultRow}
          accessibilityRole="button"
        >
          <View style={styles.pinIconWrapper}>
            <Icon name="Crosshair" size={20} color={COLORS.gold500} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.addressText} numberOfLines={1}>
              {t('search.currentLocation')}
            </Text>
          </View>
        </Pressable>
      </View>
    );
  }

  if (!hasTypedSuggestions && !hasAddressResults) {
    return (
      <View
        style={[
          styles.dropdownContainer,
          Platform.OS === 'web'
            ? ({
                boxShadow: '0 18px 34px rgba(90, 82, 73, 0.14), 0 4px 12px rgba(0, 0, 0, 0.06)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
              } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
            : null,
        ]}
        testID="search-results-empty"
      >
        <Text style={styles.statusText}>{t('search.empty')}</Text>
      </View>
    );
  }

  const renderItem = ({ item, index }: ListRenderItemInfo<ResolvedAddress>) => {
    const isHighlighted = highlightedIndex === index;
    return (
      <Pressable
        testID="search-result-item"
        onPress={() => onResultPress(item)}
        accessibilityState={isHighlighted ? { selected: true } : undefined}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.resultRow,
          {
            backgroundColor: pressed
              ? COLORS.warm200
              : isHighlighted || (Platform.OS === 'web' && hovered)
                ? COLORS.warm100
                : COLORS.white,
            borderBottomWidth: index < results.length - 1 ? 1 : 0,
            borderBottomColor: COLORS.warm200,
          },
          Platform.OS === 'web' ? { cursor: 'pointer' as unknown as undefined } : {},
        ]}
      >
        <View style={styles.pinIconWrapper}>
          <Icon name="MapPin" size={20} weight="fill" color={COLORS.gold500} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="tail">
            {item.formattedAddress}
          </Text>
          <Text style={styles.cityText} numberOfLines={1} ellipsizeMode="tail">
            {item.details.city}
          </Text>
        </View>
      </Pressable>
    );
  };

  const renderLocationItem = ({ item, index }: ListRenderItemInfo<LocationSearchSuggestion>) => {
    const isHighlighted = highlightedIndex === index;
    return (
      <Pressable
        testID="search-result-item"
        onPress={() => onLocationSuggestionPress?.(item)}
        accessibilityState={isHighlighted ? { selected: true } : undefined}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.resultRow,
          {
            backgroundColor: pressed
              ? COLORS.warm200
              : isHighlighted || (Platform.OS === 'web' && hovered)
                ? COLORS.warm100
                : COLORS.white,
            borderBottomWidth: index < typedSuggestions.length - 1 ? 1 : 0,
            borderBottomColor: COLORS.warm200,
          },
          Platform.OS === 'web' ? { cursor: 'pointer' as unknown as undefined } : {},
        ]}
      >
        <View style={styles.pinIconWrapper}>
          <Icon
            name={
              item.type === 'property' || item.type === 'address' ? 'MapPin' : 'MagnifyingGlass'
            }
            size={20}
            weight={item.type === 'property' || item.type === 'address' ? 'fill' : 'regular'}
            color={COLORS.gold500}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="tail">
            {item.label}
          </Text>
          <Text style={styles.cityText} numberOfLines={1} ellipsizeMode="tail">
            {formatLocationSuggestionSubtitle(item)}
          </Text>
        </View>
      </Pressable>
    );
  };

  if (hasTypedSuggestions) {
    return (
      <View
        style={[
          styles.resultListContainer,
          Platform.OS === 'web'
            ? ({
                boxShadow: '0 20px 36px rgba(90, 82, 73, 0.16), 0 4px 12px rgba(0, 0, 0, 0.05)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
              } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
            : null,
        ]}
        testID="search-results-list"
      >
        <FlatList
          data={typedSuggestions}
          renderItem={renderLocationItem}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={typedSuggestions.length > 4}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.resultListContainer,
        Platform.OS === 'web'
          ? ({
              boxShadow: '0 20px 36px rgba(90, 82, 73, 0.16), 0 4px 12px rgba(0, 0, 0, 0.05)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
          : null,
      ]}
      testID="search-results-list"
    >
      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={(item, index) => `${item.bagId}-${index}`}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={results.length > 4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dropdownContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderRadius: 16,
    marginTop: 10,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: COLORS.warm200,
    alignItems: 'center',
    shadowColor: '#6A5A48',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 8,
  },
  statusText: {
    color: COLORS.warm500,
    marginTop: 8,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  resultListContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderRadius: 16,
    marginTop: 10,
    maxHeight: 344,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.warm200,
    shadowColor: '#6A5A48',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 8,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 16,
    gap: 12,
  },
  pinIconWrapper: {
    flexShrink: 0,
  },
  addressText: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: COLORS.warm900,
  },
  cityText: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: COLORS.warm500,
    marginTop: 2,
  },
});
