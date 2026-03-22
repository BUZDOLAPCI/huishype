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
import { Icon } from './ui/Icon';
import { shadows } from '@/src/lib/shadows';

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

export interface SearchResultsProps {
  results: ResolvedAddress[];
  isLoading: boolean;
  query: string;
  onResultPress: (address: ResolvedAddress) => void;
}

/**
 * Dropdown list of geocoder address search results.
 * Shown below the search input when the user types.
 */
export function SearchResults({
  results,
  isLoading,
  query,
  onResultPress,
}: SearchResultsProps) {
  // Don't render anything if query is too short
  if (query.length < 2) return null;

  if (isLoading) {
    return (
      <View
        style={[styles.dropdownContainer, shadows.dropdown]}
        className="shadow-dropdown"
        testID="search-results-loading"
      >
        <ActivityIndicator size="small" color={COLORS.gold500} />
        <Text style={styles.statusText}>
          Searching...
        </Text>
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View
        style={[styles.dropdownContainer, shadows.dropdown]}
        className="shadow-dropdown"
        testID="search-results-empty"
      >
        <Text style={styles.statusText}>
          No addresses found
        </Text>
      </View>
    );
  }

  const renderItem = ({ item, index }: ListRenderItemInfo<ResolvedAddress>) => (
    <Pressable
      testID="search-result-item"
      onPress={() => onResultPress(item)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ([
        styles.resultRow,
        {
          backgroundColor: pressed
            ? COLORS.warm200
            : (Platform.OS === 'web' && hovered)
              ? COLORS.warm100
              : COLORS.white,
          borderBottomWidth: index < results.length - 1 ? 1 : 0,
          borderBottomColor: COLORS.warm200,
        },
        Platform.OS === 'web' ? { cursor: 'pointer' as unknown as undefined } : {},
      ])}
    >
      <View style={styles.pinIconWrapper}>
        <Icon name="MapPin" size={20} weight="fill" color={COLORS.gold500} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={styles.addressText}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {item.formattedAddress}
        </Text>
        <Text
          style={styles.cityText}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {item.details.city}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View
      style={[styles.resultListContainer, shadows.dropdown]}
      className="shadow-dropdown"
      testID="search-results-list"
    >
      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={(item) => item.bagId}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={results.length > 4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dropdownContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginTop: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statusText: {
    color: COLORS.warm500,
    marginTop: 8,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  resultListContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 340,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
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
