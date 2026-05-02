import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addressKeys, useAddressSearch } from '../useAddressResolver';
import { searchAddresses } from '@/src/services/address-resolver';

jest.mock('@/src/services/address-resolver', () => ({
  searchAddresses: jest.fn(),
}));

const mockSearchAddresses = searchAddresses as jest.Mock;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useAddressSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchAddresses.mockResolvedValue([]);
  });

  it('includes bias fields in the query key', () => {
    expect(addressKeys.search('dam', 5, {
      lon: 4.8952,
      lat: 52.3702,
      countryCode: 'NL',
    })).toEqual([
      'addresses',
      'search',
      'dam',
      5,
      4.8952,
      52.3702,
      'NL',
    ]);
  });

  it('refetches and forwards options when the search bias changes', async () => {
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);

    const { rerender } = renderHook(
      ({ lon }: { lon: number }) =>
        useAddressSearch('dam', 5, {
          searchBias: {
            lon,
            lat: 52.3702,
            countryCode: 'NL',
          },
        }),
      {
        wrapper,
        initialProps: { lon: 4.8952 },
      },
    );

    await waitFor(() => {
      expect(mockSearchAddresses).toHaveBeenCalledWith('dam', 5, {
        lon: 4.8952,
        lat: 52.3702,
        countryCode: 'NL',
      });
    });

    rerender({ lon: 5.1214 });

    await waitFor(() => {
      expect(mockSearchAddresses).toHaveBeenCalledWith('dam', 5, {
        lon: 5.1214,
        lat: 52.3702,
        countryCode: 'NL',
      });
    });
    expect(mockSearchAddresses).toHaveBeenCalledTimes(2);
  });
});
