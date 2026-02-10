import React from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  type ListRenderItemInfo,
} from 'react-native';
import type { ResolvedAddress } from '@/src/services/address-resolver';

export interface SearchResultsProps {
  results: ResolvedAddress[];
  isLoading: boolean;
  query: string;
  onResultPress: (address: ResolvedAddress) => void;
}

/**
 * Dropdown list of PDOK address search results.
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
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          marginTop: 4,
          paddingVertical: 16,
          alignItems: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 5,
        }}
        testID="search-results-loading"
      >
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text style={{ color: '#6B7280', marginTop: 8, fontSize: 14 }}>
          Searching...
        </Text>
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          marginTop: 4,
          paddingVertical: 16,
          paddingHorizontal: 16,
          alignItems: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 5,
        }}
        testID="search-results-empty"
      >
        <Text style={{ color: '#6B7280', fontSize: 14 }}>
          No addresses found
        </Text>
      </View>
    );
  }

  const renderItem = ({ item, index }: ListRenderItemInfo<ResolvedAddress>) => (
    <Pressable
      testID="search-result-item"
      onPress={() => onResultPress(item)}
      style={({ pressed }) => ({
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: pressed ? '#F3F4F6' : '#FFFFFF',
        borderBottomWidth: index < results.length - 1 ? 1 : 0,
        borderBottomColor: '#F3F4F6',
      })}
    >
      <Text
        style={{ fontSize: 14, color: '#111827' }}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {item.formattedAddress}
      </Text>
      <Text
        style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {item.details.zip} {item.details.city}
      </Text>
    </Pressable>
  );

  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        marginTop: 4,
        maxHeight: 300,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 5,
      }}
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
