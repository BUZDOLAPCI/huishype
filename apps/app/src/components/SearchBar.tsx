import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, Text, Platform, StyleSheet, InteractionManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAddressSearch } from '@/src/hooks/useAddressResolver';
import { Icon } from './ui/Icon';
import { BlurContainer } from './ui/BlurContainer';
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
  whiteTranslucent: 'rgba(255, 255, 255, 0.86)',
  warm300: '#E8E0D4',
  warm400: '#C7BFB3',
  warm700: '#5A5249',
  warm900: '#2D2926',
  gold400: '#F7C948',
  gold500: '#F5A623',
  dimOverlay: 'rgba(45, 41, 38, 0.18)',
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
  onLocationResolved: (
    coordinates: { lon: number; lat: number },
    address: string,
    resolvedAddress?: ResolvedAddress,
  ) => void;
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
        const postalCode = address.details.zip;
        const houseNumber = address.details.houseNumber;

        if (postalCode && houseNumber) {
          const property = await resolveProperty({
            postalCode,
            houseNumber,
            houseNumberAddition: address.details.houseNumberAddition,
            countryCode: address.details.countryCode,
            street: address.details.street,
            city: address.details.city,
          });

          if (property) {
            onPropertyResolved(property);
          } else {
            // Property not in our DB - fly to geocoder coordinates
            onLocationResolved(
              { lon: address.lon, lat: address.lat },
              address.formattedAddress,
              address,
            );
          }
        } else {
          // Missing postal code or house number - use geocoder coordinates
          onLocationResolved(
            { lon: address.lon, lat: address.lat },
            address.formattedAddress,
            address,
          );
        }
      } catch (error) {
        console.warn('[HuisHype] Search resolve error:', error);
        // Fallback to geocoder coordinates
        onLocationResolved(
          { lon: address.lon, lat: address.lat },
          address.formattedAddress,
          address,
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

  const handleFocusTargetPress = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    // Don't immediately clear focus — let result press handler fire first.
    // The backdrop press handler handles dismissal.
  }, []);

  useEffect(() => {
    if (!isFocused || Platform.OS === 'web') {
      return undefined;
    }

    let frameHandle: number | ReturnType<typeof setTimeout> | null = null;
    const scheduleFocus = () => {
      if (typeof requestAnimationFrame === 'function') {
        frameHandle = requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
        return;
      }

      frameHandle = setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    };

    const focusTask = InteractionManager?.runAfterInteractions
      ? InteractionManager.runAfterInteractions(scheduleFocus)
      : null;

    if (!focusTask) {
      scheduleFocus();
    }

    return () => {
      if (focusTask) {
        focusTask.cancel();
      }

      if (typeof frameHandle === 'number' && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameHandle);
      } else if (frameHandle) {
        clearTimeout(frameHandle);
      }
    };
  }, [isFocused]);

  // Compute the top offset for the search bar.
  // It must sit below the header row: safe area top + header height + gap.
  const topOffset = Platform.OS === 'web'
    ? 54 // Below the web header row
    : insets.top + 46; // Below native header row

  const searchIconColor = isFocused ? COLORS.gold500 : COLORS.warm400;

  // Build the editable input field with focus-dependent styling.
  const inputField = (
    <View
      style={[
        styles.inputContainer,
        isFocused ? styles.inputContainerFocused : styles.inputContainerUnfocused,
        Platform.OS === 'web'
          ? ({
              boxShadow: isFocused
                ? '0 16px 34px rgba(180, 119, 18, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08)'
                : '0 12px 28px rgba(90, 82, 73, 0.12), 0 2px 8px rgba(0, 0, 0, 0.05)',
              backdropFilter: isFocused ? 'none' : 'blur(18px)',
              WebkitBackdropFilter: isFocused ? 'none' : 'blur(18px)',
            } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
          : null,
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
        autoFocus={Platform.OS !== 'web' && isFocused}
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

  const unfocusedNativeField = (
    <View
      style={[
        styles.inputContainer,
        styles.inputContainerUnfocused,
      ]}
      pointerEvents="none"
    >
      <View style={styles.iconWrapper}>
        <Icon name="MagnifyingGlass" size="md" color={COLORS.warm400} />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.input,
          inputValue.length > 0 ? styles.unfocusedValueText : styles.unfocusedPlaceholderText,
        ]}
      >
        {inputValue.length > 0 ? inputValue : 'Search address...'}
      </Text>

      {isResolving ? (
        <Text style={styles.loadingIndicator}>...</Text>
      ) : inputValue.length > 0 ? (
        <View style={styles.clearButtonPlaceholder}>
          <Icon name="X" size="sm" color={COLORS.warm400} />
        </View>
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
          Platform.OS === 'web'
            ? ({
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
              } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
            : null,
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
          <Pressable
            testID="search-bar-focus-target"
            accessibilityRole="button"
            accessibilityLabel="Focus address search"
            accessibilityHint="Activates the address search field"
            onPress={handleFocusTargetPress}
          >
            <BlurContainer
              intensity={60}
              tint="light"
              style={styles.blurInputWrapper}
            >
              {unfocusedNativeField}
            </BlurContainer>
          </Pressable>
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
    left: 14,
    right: 14,
    zIndex: 100,
  },
  blurInputWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  inputContainerUnfocused: {
    backgroundColor: Platform.OS === 'web'
      ? COLORS.whiteTranslucent
      : 'transparent',
    borderWidth: 1,
    borderColor: COLORS.warm300,
    shadowColor: '#6A5A48',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 7,
  },
  inputContainerFocused: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.gold400,
    shadowColor: '#B47712',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 10,
  },
  iconWrapper: {
    // No extra margin — the gap on the parent handles spacing.
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: COLORS.warm900,
    paddingVertical: 0,
  },
  unfocusedPlaceholderText: {
    color: COLORS.warm400,
  },
  unfocusedValueText: {
    color: COLORS.warm700,
  },
  loadingIndicator: {
    fontSize: 14,
    color: COLORS.warm400,
  },
  clearButtonPlaceholder: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
