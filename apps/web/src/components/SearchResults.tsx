import React from 'react';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import { Icon } from './ui/Icon';
import { shadows } from '@/src/lib/shadows';

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

export function SearchResults({
  results,
  isLoading,
  query,
  onResultPress,
}: SearchResultsProps) {
  if (query.length < 2) {
    return null;
  }

  if (isLoading) {
    return (
      <div
        data-testid="search-results-loading"
        style={{ ...dropdownShellStyle, padding: '18px 16px', display: 'grid', placeItems: 'center', gap: 8 }}
      >
        <span style={{ color: COLORS.warm500, fontSize: 14 }}>Searching...</span>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div
        data-testid="search-results-empty"
        style={{ ...dropdownShellStyle, padding: '18px 16px', display: 'grid', placeItems: 'center' }}
      >
        <span style={{ color: COLORS.warm500, fontSize: 14 }}>No addresses found</span>
      </div>
    );
  }

  return (
    <div
      data-testid="search-results-list"
      style={{
        ...dropdownShellStyle,
        maxHeight: 344,
        overflowY: results.length > 4 ? 'auto' : 'hidden',
      }}
    >
      {results.map((item, index) => (
        <button
          key={`${item.bagId}-${index}`}
          type="button"
          data-testid="search-result-item"
          onClick={() => onResultPress(item)}
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            gap: 12,
            padding: '15px 16px',
            border: 'none',
            borderBottom: index < results.length - 1 ? `1px solid ${COLORS.warm200}` : 'none',
            backgroundColor: COLORS.white,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>
            <Icon name="MapPin" size={20} weight="fill" color={COLORS.gold500} />
          </span>
          <span style={{ display: 'grid', minWidth: 0 }}>
            <span
              style={{
                fontSize: 14,
                fontFamily: 'DMSans_500Medium, "DM Sans", sans-serif',
                color: COLORS.warm900,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.formattedAddress}
            </span>
            <span
              style={{
                marginTop: 2,
                fontSize: 12,
                fontFamily: 'DMSans_400Regular, "DM Sans", sans-serif',
                color: COLORS.warm500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.details.city}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

const dropdownShellStyle = {
  marginTop: 10,
  borderRadius: 16,
  border: `1px solid ${COLORS.warm200}`,
  backgroundColor: 'rgba(255, 255, 255, 0.98)',
  overflow: 'hidden',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  ...shadows.dropdown,
} as const;
