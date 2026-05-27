import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, Text, Platform, StyleSheet, InteractionManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAddressSearch } from '@/src/hooks/useAddressResolver';
import { useLocationSearch } from '@/src/hooks/useLocationSearch';
import { Icon } from './ui/Icon';
import { BlurContainer } from './ui/BlurContainer';
import { resolveProperty, type PropertyResolveResult } from '@/src/utils/api';
import { SearchResults } from './SearchResults';
import type { AddressSearchBias, ResolvedAddress } from '@/src/services/address-resolver';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';
import { useWebDismissibleLayer } from '@/src/providers/WebDismissibleLayerProvider';
import { useT } from '@/src/i18n';
import type { LocationFilterToken, LocationSearchSuggestion } from '@huishype/shared';
import { serializeLocationFilterToken } from '@/src/lib/sharedMapFilters';

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
  onPropertyResolved: (
    property: PropertyResolveResult,
    resolvedAddress?: ResolvedAddress,
  ) => void;
  /**
   * Called when a search result is tapped but the property is NOT found
   * in our local database. Falls back to geocoder coordinates.
   */
  onLocationResolved: (
    coordinates: { lon: number; lat: number },
    address: string,
    resolvedAddress?: ResolvedAddress,
  ) => void;
  /** Incremented by the parent screen when it loses focus to clear transient search UI. */
  transientResetKey?: number;
  /** Settled viewport bias for local-first address autocomplete ranking. */
  searchBias?: AddressSearchBias;
  selectedAreas?: LocationFilterToken[];
  onAreaSelected?: (area: LocationFilterToken) => void;
  onAreaRemoved?: (area: LocationFilterToken) => void;
  onClearAreas?: () => void;
  onCurrentLocationSelected?: () => void | Promise<void>;
}

const DEBOUNCE_MS = 300;

/**
 * Search bar overlay for the map screen.
 * Uses the geocoding backend (Photon) for address autocomplete and
 * the backend /properties/resolve endpoint to map addresses
 * to local properties.
 */
export function SearchBar({
  onPropertyResolved,
  onLocationResolved,
  transientResetKey = 0,
  searchBias,
  selectedAreas = [],
  onAreaSelected,
  onAreaRemoved,
  onClearAreas,
  onCurrentLocationSelected,
}: SearchBarProps) {
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const reducedMotion = useReducedMotion();
  const t = useT();
  const searchOperationIdRef = useRef(0);
  // When true, the next inputValue change won't trigger a new search.
  // Used after selecting a result to prevent the dropdown from reopening.
  const suppressDebounce = useRef(false);
  const insets = useSafeAreaInsets();

  const invalidatePendingSearch = useCallback(() => {
    searchOperationIdRef.current += 1;
    return searchOperationIdRef.current;
  }, []);

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
  const { data: results = [], isLoading } = useAddressSearch(
    debouncedQuery,
    5,
    searchBias ? { searchBias } : undefined,
  );
  const { data: locationSuggestions = [], isLoading: isLoadingLocations } = useLocationSearch(
    debouncedQuery,
    8,
    searchBias ? { searchBias } : undefined,
  );
  const addressResults = results.filter((result) =>
    Boolean(result.details.houseNumber || result.details.street || result.details.zip)
  );

  const selectedAreaKeys = selectedAreas.map((area) => serializeLocationFilterToken(area));

  const toResolvedAddress = useCallback((suggestion: LocationSearchSuggestion): ResolvedAddress => {
    const [lon, lat] = suggestion.coordinates ?? [0, 0];
    return {
      bagId: suggestion.id,
      formattedAddress: suggestion.address || suggestion.label,
      lat,
      lon,
      details: {
        city: suggestion.city || '',
        zip: suggestion.postalCode || '',
        street: suggestion.street || '',
        number: suggestion.houseNumber || '',
        houseNumber: suggestion.houseNumber || null,
        houseNumberAddition: suggestion.houseNumberAddition || null,
        countryCode: suggestion.countryCode || null,
      },
    };
  }, []);

  // Handle result tap: resolve to local property
  const handleResultPress = useCallback(
    async (address: ResolvedAddress) => {
      const operationId = invalidatePendingSearch();
      setShowResults(false);
      setIsFocused(false);
      suppressDebounce.current = true;
      setDebouncedQuery('');
      setInputValue(address.formattedAddress);
      inputRef.current?.blur();
      setIsResolving(true);

      try {
        const postalCode = address.details.zip;
        const houseNumber = address.details.houseNumber;

        if (operationId !== searchOperationIdRef.current) {
          return;
        }

        if (postalCode && houseNumber) {
          const property = await resolveProperty({
            postalCode,
            houseNumber,
            houseNumberAddition: address.details.houseNumberAddition,
            countryCode: address.details.countryCode,
            street: address.details.street,
            city: address.details.city,
          });

          if (operationId !== searchOperationIdRef.current) {
            return;
          }

          if (property) {
            onPropertyResolved(property, address);
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
          if (operationId !== searchOperationIdRef.current) {
            return;
          }
          onLocationResolved(
            { lon: address.lon, lat: address.lat },
            address.formattedAddress,
            address,
          );
        }
      } catch (error) {
        if (operationId !== searchOperationIdRef.current) {
          return;
        }
        console.warn('[HuisHype] Search resolve error:', error);
        // Fallback to geocoder coordinates
        onLocationResolved(
          { lon: address.lon, lat: address.lat },
          address.formattedAddress,
          address,
        );
      } finally {
        if (operationId === searchOperationIdRef.current) {
          setIsResolving(false);
        }
      }
    },
    [invalidatePendingSearch, onPropertyResolved, onLocationResolved],
  );

  const handleLocationSuggestionPress = useCallback(
    (suggestion: LocationSearchSuggestion) => {
      if (suggestion.type === 'property' || suggestion.type === 'address') {
        void handleResultPress(toResolvedAddress(suggestion));
        return;
      }

      const token = suggestion.filterToken;
      if (!token) {
        if (suggestion.coordinates) {
          onLocationResolved(
            { lon: suggestion.coordinates[0], lat: suggestion.coordinates[1] },
            suggestion.label,
          );
        }
        return;
      }

      const key = serializeLocationFilterToken(token);
      if (key && !selectedAreaKeys.includes(key)) {
        onAreaSelected?.(token);
      }
      invalidatePendingSearch();
      suppressDebounce.current = true;
      setInputValue('');
      setDebouncedQuery('');
      setShowResults(false);
      setIsFocused(false);
      inputRef.current?.blur();
    },
    [
      handleResultPress,
      invalidatePendingSearch,
      onAreaSelected,
      onLocationResolved,
      selectedAreaKeys,
      toResolvedAddress,
    ],
  );

  const handleCurrentLocationPress = useCallback(() => {
    void onCurrentLocationSelected?.();
    invalidatePendingSearch();
    setShowResults(false);
    setIsFocused(false);
    inputRef.current?.blur();
  }, [invalidatePendingSearch, onCurrentLocationSelected]);

  // Clear search
  const handleClear = useCallback(() => {
    invalidatePendingSearch();
    suppressDebounce.current = true;
    setInputValue('');
    setDebouncedQuery('');
    setShowResults(false);
    setIsResolving(false);
  }, [invalidatePendingSearch]);

  // Dismiss overlay on backdrop press
  const handleBackdropPress = useCallback(() => {
    invalidatePendingSearch();
    inputRef.current?.blur();
    setIsFocused(false);
    setShowResults(false);
    setIsResolving(false);
  }, [invalidatePendingSearch]);

  useWebDismissibleLayer({
    id: 'map-search',
    active: isFocused || showResults,
    onDismiss: handleBackdropPress,
    enabled: Platform.OS === 'web',
  });

  const clearTransientSearchState = useCallback(() => {
    invalidatePendingSearch();
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    suppressDebounce.current = false;
    setInputValue('');
    setDebouncedQuery('');
    setShowResults(false);
    setIsResolving(false);
    setIsFocused(false);
  }, [invalidatePendingSearch]);

  const lastTransientResetKey = useRef(transientResetKey);
  useEffect(() => {
    if (lastTransientResetKey.current === transientResetKey) {
      return;
    }

    lastTransientResetKey.current = transientResetKey;
    clearTransientSearchState();
  }, [clearTransientSearchState, transientResetKey]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    if (debouncedQuery.length >= 2 && (locationSuggestions.length > 0 || addressResults.length > 0)) {
      setShowResults(true);
    }
  }, [addressResults.length, debouncedQuery, locationSuggestions.length]);

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
  const hasSelectedAreas = selectedAreas.length > 0;
  const selectedAreaChips = hasSelectedAreas ? (
    <View style={styles.chipRow} testID="search-area-chip-row">
      {selectedAreas.map((area) => {
        const key = serializeLocationFilterToken(area) ?? `${area.type}:${area.label}`;
        return (
          <View key={key} style={styles.areaChip} testID="search-area-chip">
            <Icon name="MapPin" size="sm" color={COLORS.gold500} />
            <Text style={styles.areaChipText} numberOfLines={1}>
              {area.label}
            </Text>
            <Pressable
              testID="search-area-chip-remove"
              onPress={() => onAreaRemoved?.(area)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${area.label}`}
            >
              <Icon name="X" size="sm" color={COLORS.warm400} />
            </Pressable>
          </View>
        );
      })}
      {selectedAreas.length > 1 ? (
        <Pressable
          testID="search-area-clear-all"
          onPress={onClearAreas}
          style={styles.clearAreasButton}
          accessibilityRole="button"
        >
          <Text style={styles.clearAreasText}>Clear all</Text>
        </Pressable>
      ) : null}
    </View>
  ) : null;

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
        accessibilityLabel={t('search.label')}
        accessibilityHint={t('search.hint')}
        style={[
          styles.input,
          Platform.OS === 'web' ? { outlineStyle: 'none' as unknown as undefined } : {},
        ]}
        placeholder={t('search.placeholder')}
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
          accessibilityLabel={t('search.clear')}
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
        {inputValue.length > 0 ? inputValue : t('search.placeholder')}
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
          accessibilityLabel={t('search.dismiss')}
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
        {selectedAreaChips}
        {/* Search Input — uses blur container on native when unfocused */}
        {!isFocused && Platform.OS !== 'web' ? (
          <Pressable
            testID="search-bar-focus-target"
            accessibilityRole="button"
            accessibilityLabel={t('search.focusLabel')}
            accessibilityHint={t('search.focusHint')}
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
            results={addressResults}
            locationSuggestions={locationSuggestions}
            isLoading={isLoading || isLoadingLocations}
            query={debouncedQuery}
            showCurrentLocationAction={isFocused && inputValue.length === 0}
            onResultPress={handleResultPress}
            onLocationSuggestionPress={handleLocationSuggestionPress}
            onCurrentLocationPress={handleCurrentLocationPress}
          />
        )}
        {isFocused && inputValue.length === 0 && !showResults ? (
          <SearchResults
            results={[]}
            isLoading={false}
            query=""
            showCurrentLocationAction
            onResultPress={handleResultPress}
            onCurrentLocationPress={handleCurrentLocationPress}
          />
        ) : null}
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  areaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 220,
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 10,
    gap: 6,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.warm300,
  },
  areaChipText: {
    flexShrink: 1,
    color: COLORS.warm900,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  clearAreasButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  clearAreasText: {
    color: COLORS.warm700,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
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
