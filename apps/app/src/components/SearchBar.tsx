import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, Text, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAddressSearch } from '@/src/hooks/useAddressResolver';
import { resolveProperty, type PropertyResolveResult } from '@/src/utils/api';
import { SearchResults } from './SearchResults';
import type { ResolvedAddress } from '@/src/services/address-resolver';

export interface SearchBarProps {
  /**
   * Called when a search result is tapped AND the property is found
   * in our local database via /properties/resolve.
   */
  onPropertyResolved: (property: PropertyResolveResult) => void;
  /**
   * Called when a search result is tapped but the property is NOT found
   * in our local database. Falls back to PDOK coordinates.
   */
  onLocationResolved: (coordinates: { lon: number; lat: number }, address: string) => void;
}

const DEBOUNCE_MS = 300;

/**
 * Search bar overlay for the map screen.
 * Uses PDOK Locatieserver for address autocomplete and
 * the backend /properties/resolve endpoint to map addresses
 * to local properties.
 */
export function SearchBar({ onPropertyResolved, onLocationResolved }: SearchBarProps) {
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the search query
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (inputValue.length >= 2) {
      debounceTimer.current = setTimeout(() => {
        setDebouncedQuery(inputValue);
        setShowResults(true);
      }, DEBOUNCE_MS);
    } else {
      setDebouncedQuery('');
      setShowResults(false);
    }

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [inputValue]);

  // PDOK address search using existing hook
  const { data: results = [], isLoading } = useAddressSearch(debouncedQuery, 5);

  // Handle result tap: resolve to local property
  const handleResultPress = useCallback(
    async (address: ResolvedAddress) => {
      setShowResults(false);
      setInputValue(address.formattedAddress);
      setIsResolving(true);

      try {
        // Extract postal code and house number from PDOK result
        const postalCode = address.details.zip;
        const houseNumber = address.details.number;

        if (postalCode && houseNumber) {
          const property = await resolveProperty(postalCode, houseNumber);

          if (property) {
            onPropertyResolved(property);
          } else {
            // Property not in our DB - fly to PDOK coordinates
            onLocationResolved(
              { lon: address.lon, lat: address.lat },
              address.formattedAddress,
            );
          }
        } else {
          // Missing postal code or house number - use PDOK coordinates
          onLocationResolved(
            { lon: address.lon, lat: address.lat },
            address.formattedAddress,
          );
        }
      } catch (error) {
        console.warn('[HuisHype] Search resolve error:', error);
        // Fallback to PDOK coordinates
        onLocationResolved(
          { lon: address.lon, lat: address.lat },
          address.formattedAddress,
        );
      } finally {
        setIsResolving(false);
      }
    },
    [onPropertyResolved, onLocationResolved],
  );

  // Clear search
  const handleClear = useCallback(() => {
    setInputValue('');
    setDebouncedQuery('');
    setShowResults(false);
  }, []);

  return (
    <View
      style={{
        position: 'absolute',
        top: Platform.OS === 'web' ? 16 : 56,
        left: 60,
        right: 16,
        zIndex: 100,
      }}
      testID="search-bar-container"
    >
      {/* Search Input */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          paddingHorizontal: 12,
          height: 44,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 5,
        }}
      >
        {/* Search icon */}
        <Ionicons name="search" size={18} color="#9CA3AF" style={{ marginRight: 8 }} />

        <TextInput
          testID="search-bar-input"
          style={{
            flex: 1,
            fontSize: 14,
            color: '#111827',
            paddingVertical: 0,
            ...(Platform.OS === 'web' ? { outlineStyle: 'none' as unknown as undefined } : {}),
          }}
          placeholder="Search address..."
          placeholderTextColor="#9CA3AF"
          value={inputValue}
          onChangeText={setInputValue}
          onFocus={() => {
            if (debouncedQuery.length >= 2 && results.length > 0) {
              setShowResults(true);
            }
          }}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />

        {/* Clear / Loading indicator */}
        {isResolving ? (
          <Text style={{ fontSize: 14, color: '#9CA3AF' }}>...</Text>
        ) : inputValue.length > 0 ? (
          <Pressable
            testID="search-clear-button"
            onPress={handleClear}
            hitSlop={8}
            style={{ padding: 4 }}
          >
            <Ionicons name="close" size={18} color="#9CA3AF" />
          </Pressable>
        ) : null}
      </View>

      {/* Search Results Dropdown */}
      {showResults && (
        <SearchResults
          results={results}
          isLoading={isLoading}
          query={debouncedQuery}
          onResultPress={handleResultPress}
        />
      )}
    </View>
  );
}
