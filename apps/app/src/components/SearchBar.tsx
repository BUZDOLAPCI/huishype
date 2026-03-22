import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, Text, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAddressSearch } from '@/src/hooks/useAddressResolver';
import { Icon } from './ui/Icon';
import { BlurContainer } from './ui/BlurContainer';
import { shadows } from '@/src/lib/shadows';
import { resolveProperty, type PropertyResolveResult } from '@/src/utils/api';
import { SearchResults } from './SearchResults';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

/**
 * Design spec (Section 7.2):
 * - Container: 48px height
 * - Input field: 44px height, rounded 12px
 * - Unfocused: translucent #FFFFFFCC, 1px $warm-300 border, blur 15
 * - Focused: solid #FFFFFF, 2px $gold-400 border, gold glow, gold icon
 * - Placeholder: Inter 14/400, $warm-400
 * - Search icon: Phosphor magnifying-glass 18px
 * - Clear button: Phosphor X 16px, $warm-400
 * - No decorative mic icon
 *
 * Section 8.1 (search active state):
 * - Map background dims with #00000040 overlay
 * - Gold border + glow on input field
 */

// Palette constants
const COLORS = {
  white: '#FFFFFF',
  whiteTranslucent: 'rgba(255, 255, 255, 0.80)',
  warm300: '#E8E0D4',
  warm400: '#C7BFB3',
  warm900: '#2D2926',
  gold400: '#F7C948',
  gold500: '#F5A623',
  dimOverlay: 'rgba(0, 0, 0, 0.25)',
} as const;

export interface SearchBarProps {
  /**
   * Called when a search result is tapped AND the property is found
   * in our local database via /properties/resolve.
   */
  onPropertyResolved: (property: PropertyResolveResult) => void;
  /**
   * Called when a search result is tapped but the property is NOT found
   * in our local database. Falls back to geocoder coordinates.
   */
  onLocationResolved: (coordinates: { lon: number; lat: number }, address: string) => void;
}

const DEBOUNCE_MS = 300;

/**
 * Search bar overlay for the map screen.
 * Uses the geocoding backend (Photon) for address autocomplete and
 * the backend /properties/resolve endpoint to map addresses
 * to local properties.
 */
export function SearchBar({ onPropertyResolved, onLocationResolved }: SearchBarProps) {
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const reducedMotion = useReducedMotion();
  // When true, the next inputValue change won't trigger a new search.
  // Used after selecting a result to prevent the dropdown from reopening.
  const suppressDebounce = useRef(false);
  const insets = useSafeAreaInsets();

  // Debounce the search query
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Skip debounce when inputValue was set programmatically (e.g. after result selection)
    if (suppressDebounce.current) {
      suppressDebounce.current = false;
      return;
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

  // Geocoder address search using existing hook
  const { data: results = [], isLoading } = useAddressSearch(debouncedQuery, 5);

  // Handle result tap: resolve to local property
  const handleResultPress = useCallback(
    async (address: ResolvedAddress) => {
      setShowResults(false);
      setIsFocused(false);
      suppressDebounce.current = true;
      setInputValue(address.formattedAddress);
      inputRef.current?.blur();
      setIsResolving(true);

      try {
        // Extract postal code and house number from geocoder result
        const postalCode = address.details.zip;
        const houseNumber = address.details.number;

        if (postalCode && houseNumber) {
          const property = await resolveProperty(postalCode, houseNumber);

          if (property) {
            onPropertyResolved(property);
          } else {
            // Property not in our DB - fly to geocoder coordinates
            onLocationResolved(
              { lon: address.lon, lat: address.lat },
              address.formattedAddress,
            );
          }
        } else {
          // Missing postal code or house number - use geocoder coordinates
          onLocationResolved(
            { lon: address.lon, lat: address.lat },
            address.formattedAddress,
          );
        }
      } catch (error) {
        console.warn('[HuisHype] Search resolve error:', error);
        // Fallback to geocoder coordinates
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
    suppressDebounce.current = true;
    setInputValue('');
    setDebouncedQuery('');
    setShowResults(false);
  }, []);

  // Dismiss overlay on backdrop press
  const handleBackdropPress = useCallback(() => {
    inputRef.current?.blur();
    setIsFocused(false);
    setShowResults(false);
  }, []);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    if (debouncedQuery.length >= 2 && results.length > 0) {
      setShowResults(true);
    }
  }, [debouncedQuery, results]);

  const handleBlur = useCallback(() => {
    // Don't immediately clear focus — let result press handler fire first.
    // The backdrop press handler handles dismissal.
  }, []);

  // Compute the top offset for the search bar.
  // It must sit below the header row: safe area top + header height + gap.
  const topOffset = Platform.OS === 'web'
    ? 52 // Below the web header row
    : insets.top + 48; // Below native header row

  const searchIconColor = isFocused ? COLORS.gold500 : COLORS.warm400;

  // Build the input field with focus-dependent styling.
  const inputField = (
    <View
      style={[
        styles.inputContainer,
        isFocused ? styles.inputContainerFocused : styles.inputContainerUnfocused,
        // On web, use CSS for box-shadow glow when focused.
        Platform.OS === 'web' && isFocused
          ? { boxShadow: '0 0 8px rgba(247,201,72,0.19)' } as any // eslint-disable-line @typescript-eslint/no-explicit-any
          : {},
      ]}
    >
      {/* Search icon */}
      <View style={styles.iconWrapper}>
        <Icon name="MagnifyingGlass" size="md" color={searchIconColor} />
      </View>

      <TextInput
        ref={inputRef}
        testID="search-bar-input"
        accessibilityLabel="Search address"
        accessibilityHint="Type an address to search for properties"
        style={[
          styles.input,
          Platform.OS === 'web' ? { outlineStyle: 'none' as unknown as undefined } : {},
        ]}
        placeholder="Search address..."
        placeholderTextColor={COLORS.warm400}
        value={inputValue}
        onChangeText={setInputValue}
        onFocus={handleFocus}
        onBlur={handleBlur}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />

      {/* Clear / Loading indicator */}
      {isResolving ? (
        <Text style={{ fontSize: 14, color: COLORS.warm400 }}>...</Text>
      ) : inputValue.length > 0 ? (
        <Pressable
          testID="search-clear-button"
          onPress={handleClear}
          hitSlop={12}
          style={{ padding: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          accessibilityLabel="Clear search"
          accessibilityRole="button"
        >
          <Icon name="X" size="sm" color={COLORS.warm400} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <>
      {/* Dim overlay when search is focused */}
      {isFocused && (
        <Pressable
          testID="search-overlay-backdrop"
          onPress={handleBackdropPress}
          accessibilityLabel="Dismiss search"
          accessibilityRole="button"
          style={[
            styles.backdrop,
            reducedMotion && { opacity: 1 },
          ]}
        />
      )}

      <View
        style={[
          styles.container,
          { top: topOffset },
        ]}
        testID="search-bar-container"
      >
        {/* Search Input — uses blur container on native when unfocused */}
        {!isFocused && Platform.OS !== 'web' ? (
          <BlurContainer
            intensity={60}
            tint="light"
            style={styles.blurInputWrapper}
          >
            {inputField}
          </BlurContainer>
        ) : (
          inputField
        )}

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
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.dimOverlay,
    zIndex: 99,
  },
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 100,
  },
  blurInputWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  inputContainerUnfocused: {
    backgroundColor: Platform.OS === 'web'
      ? COLORS.whiteTranslucent
      : 'transparent',
    borderWidth: 1,
    borderColor: COLORS.warm300,
    ...shadows.search,
  },
  inputContainerFocused: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.gold400,
  },
  iconWrapper: {
    // No extra margin — the gap on the parent handles spacing.
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: COLORS.warm900,
    paddingVertical: 0,
  },
});
