import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAddressSearch } from '@/src/hooks/useAddressResolver';
import { resolveProperty, type PropertyResolveResult } from '@/src/utils/api';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';
import { SearchResults } from './SearchResults';
import { Icon } from './ui/Icon';
import { shadows } from '@/src/lib/shadows';

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
  onPropertyResolved: (
    property: PropertyResolveResult,
    resolvedAddress?: ResolvedAddress,
  ) => void;
  onLocationResolved: (
    coordinates: { lon: number; lat: number },
    address: string,
    resolvedAddress?: ResolvedAddress,
  ) => void;
  transientResetKey?: number;
}

const DEBOUNCE_MS = 300;

export function SearchBar({
  onPropertyResolved,
  onLocationResolved,
  transientResetKey = 0,
}: SearchBarProps) {
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const searchOperationIdRef = useRef(0);
  const suppressDebounce = useRef(false);
  const lastTransientResetKey = useRef(transientResetKey);

  const invalidatePendingSearch = useCallback(() => {
    searchOperationIdRef.current += 1;
    return searchOperationIdRef.current;
  }, []);

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

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

  const { data: results = [], isLoading } = useAddressSearch(debouncedQuery, 5);

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
            onLocationResolved({ lon: address.lon, lat: address.lat }, address.formattedAddress, address);
          }
        } else {
          onLocationResolved({ lon: address.lon, lat: address.lat }, address.formattedAddress, address);
        }
      } catch (error) {
        if (operationId !== searchOperationIdRef.current) {
          return;
        }
        console.warn('[HuisHype] Search resolve error:', error);
        onLocationResolved({ lon: address.lon, lat: address.lat }, address.formattedAddress, address);
      } finally {
        if (operationId === searchOperationIdRef.current) {
          setIsResolving(false);
        }
      }
    },
    [invalidatePendingSearch, onLocationResolved, onPropertyResolved],
  );

  const handleClear = useCallback(() => {
    invalidatePendingSearch();
    suppressDebounce.current = true;
    setInputValue('');
    setDebouncedQuery('');
    setShowResults(false);
    setIsResolving(false);
    inputRef.current?.focus();
  }, [invalidatePendingSearch]);

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

  useEffect(() => {
    if (lastTransientResetKey.current === transientResetKey) {
      return;
    }

    lastTransientResetKey.current = transientResetKey;
    clearTransientSearchState();
  }, [clearTransientSearchState, transientResetKey]);

  return (
    <>
      {isFocused ? (
        <button
          type="button"
          data-testid="search-overlay-backdrop"
          onClick={() => {
            invalidatePendingSearch();
            inputRef.current?.blur();
            setIsFocused(false);
            setShowResults(false);
            setIsResolving(false);
          }}
          aria-label="Dismiss search"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 99,
            border: 'none',
            backgroundColor: COLORS.dimOverlay,
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            opacity: reducedMotion ? 1 : undefined,
          }}
        />
      ) : null}

      <div
        data-testid="search-bar-container"
        style={{
          position: 'absolute',
          top: 54,
          left: 14,
          right: 14,
          zIndex: 100,
        }}
      >
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 16px',
            borderRadius: 16,
            border: isFocused ? `2px solid ${COLORS.gold400}` : `1px solid ${COLORS.warm300}`,
            backgroundColor: isFocused ? COLORS.white : COLORS.whiteTranslucent,
            backdropFilter: isFocused ? 'none' : 'blur(18px)',
            WebkitBackdropFilter: isFocused ? 'none' : 'blur(18px)',
            ...(isFocused
              ? { boxShadow: '0 16px 34px rgba(180, 119, 18, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08)' }
              : shadows.search),
          }}
        >
          <span style={{ display: 'inline-flex' }}>
            <Icon name="MagnifyingGlass" size="md" color={isFocused ? COLORS.gold500 : COLORS.warm400} />
          </span>

          <input
            ref={inputRef}
            data-testid="search-bar-input"
            aria-label="Search address"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onFocus={() => {
              setIsFocused(true);
              if (debouncedQuery.length >= 2 && results.length > 0) {
                setShowResults(true);
              }
            }}
            onBlur={() => {
              window.setTimeout(() => {
                if (document.activeElement !== inputRef.current) {
                  setIsFocused(false);
                }
              }, 0);
            }}
            placeholder="Search address..."
            autoCorrect="off"
            autoCapitalize="off"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: COLORS.warm900,
              fontSize: 15,
              fontFamily: 'Inter_400Regular, Inter, sans-serif',
            }}
          />

          {isResolving ? (
            <span style={{ fontSize: 14, color: COLORS.warm400 }}>...</span>
          ) : inputValue.length > 0 ? (
            <button
              type="button"
              data-testid="search-clear-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleClear}
              aria-label="Clear search"
              style={{
                minWidth: 44,
                minHeight: 44,
                border: 'none',
                background: 'transparent',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="X" size="sm" color={COLORS.warm400} />
            </button>
          ) : null}
        </div>

        {showResults ? (
          <SearchResults
            results={results}
            isLoading={isLoading}
            query={debouncedQuery}
            onResultPress={handleResultPress}
          />
        ) : null}
      </div>
    </>
  );
}
