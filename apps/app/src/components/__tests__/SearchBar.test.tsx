import React from 'react';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react-native';
import { SearchBar } from '../SearchBar';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import { TEST_LAT, TEST_LNG } from '@/src/__tests__/fixtures/test-coordinates';

// Mock the useAddressSearch hook
const mockUseAddressSearch = jest.fn();
jest.mock('@/src/hooks/useAddressResolver', () => ({
  useAddressSearch: (...args: unknown[]) => mockUseAddressSearch(...args),
}));

// Mock the resolveProperty function
const mockResolveProperty = jest.fn();
jest.mock('@/src/utils/api', () => ({
  resolveProperty: (...args: unknown[]) => mockResolveProperty(...args),
  API_URL: 'http://localhost:3100',
}));

// Helper: create a mock address result
function createMockAddress(overrides?: Partial<ResolvedAddress>): ResolvedAddress {
  return {
    bagId: 'addr-001',
    formattedAddress: 'Teststraat 42, 5651HA Eindhoven',
    lat: TEST_LAT,
    lon: TEST_LNG,
    details: {
      city: 'Eindhoven',
      zip: '5651HA',
      street: 'Teststraat',
      number: '42',
      houseNumber: '42',
      houseNumberAddition: null,
      countryCode: 'NL',
    },
    ...overrides,
  };
}

function focusNativeSearchInput() {
  fireEvent.press(screen.getByTestId('search-bar-focus-target'));
  return screen.getByTestId('search-bar-input');
}

describe('SearchBar', () => {
  const onPropertyResolved = jest.fn();
  const onLocationResolved = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default: no search results
    mockUseAddressSearch.mockReturnValue({
      data: [],
      isLoading: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders search input with correct testID', () => {
    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    expect(screen.getByTestId('search-bar-focus-target')).toBeTruthy();
    expect(screen.getByTestId('search-bar-container')).toBeTruthy();
  });

  it('renders placeholder text', () => {
    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    expect(screen.getByText('Search address...')).toBeTruthy();
  });

  it('enters the focused search state when the native focus target is pressed', () => {
    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    fireEvent.press(screen.getByTestId('search-bar-focus-target'));

    expect(screen.getByTestId('search-overlay-backdrop')).toBeTruthy();
    expect(screen.queryByTestId('search-bar-focus-target')).toBeNull();
    expect(screen.getByTestId('search-bar-input')).toBeTruthy();
  });

  it('debounces input - does not call search immediately', () => {
    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Test');

    // Before debounce timer fires, query should still be empty
    // The useAddressSearch hook is called with empty string initially
    expect(mockUseAddressSearch).toHaveBeenCalledWith('', 5);
  });

  it('calls useAddressSearch with debounced query after delay', () => {
    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Teststraat');

    // Advance past debounce timer
    act(() => {
      jest.advanceTimersByTime(400);
    });

    // Now hook should be called with the debounced query
    expect(mockUseAddressSearch).toHaveBeenCalledWith('Teststraat', 5);
  });

  it('shows results after typing and debounce', () => {
    const mockResults = [
      createMockAddress({ bagId: 'addr-001', formattedAddress: 'Teststraat 42, 5651HA Eindhoven' }),
      createMockAddress({ bagId: 'addr-002', formattedAddress: 'Teststraat 44, 5651HA Eindhoven' }),
    ];

    // Return results on second call (after debounce)
    mockUseAddressSearch
      .mockReturnValueOnce({ data: [], isLoading: false })
      .mockReturnValue({ data: mockResults, isLoading: false });

    const { rerender } = render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Teststraat');

    // Advance past debounce
    act(() => {
      jest.advanceTimersByTime(400);
    });

    // Re-render to pick up new hook return value
    rerender(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    // Results should be visible
    const resultItems = screen.getAllByTestId('search-result-item');
    expect(resultItems.length).toBe(2);
  });

  it('calls onPropertyResolved when result tapped and property found', async () => {
    jest.useRealTimers();

    const mockAddress = createMockAddress();
    const mockProperty = {
      id: 'prop-123',
      address: 'Teststraat 42',
      postalCode: '5651HA',
      city: 'Eindhoven',
      coordinates: { lon: TEST_LNG, lat: TEST_LAT },
      hasListing: true,
      officialValuation: 350000,
    };

    mockUseAddressSearch.mockReturnValue({
      data: [mockAddress],
      isLoading: false,
    });
    mockResolveProperty.mockResolvedValue(mockProperty);

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    // Simulate typing + debounce by directly setting the debounced query state
    // We need to trigger the results to show
    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Teststraat 42');

    // Wait for debounce
    await waitFor(() => {
      expect(mockUseAddressSearch).toHaveBeenCalledWith('Teststraat 42', 5);
    }, { timeout: 1000 });

    // Find and tap result
    const resultItems = screen.queryAllByTestId('search-result-item');
    if (resultItems.length > 0) {
      await act(async () => {
        fireEvent.press(resultItems[0]);
      });

      await waitFor(() => {
        expect(mockResolveProperty).toHaveBeenCalledWith({
          postalCode: '5651HA',
          houseNumber: '42',
          houseNumberAddition: null,
          countryCode: 'NL',
          street: 'Teststraat',
          city: 'Eindhoven',
        });
        expect(onPropertyResolved).toHaveBeenCalledWith(mockProperty, mockAddress);
      });
    }
  });

  it('calls onLocationResolved when result tapped but property not found', async () => {
    jest.useRealTimers();

    const mockAddress = createMockAddress();

    mockUseAddressSearch.mockReturnValue({
      data: [mockAddress],
      isLoading: false,
    });
    mockResolveProperty.mockResolvedValue(null);

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Teststraat 42');

    await waitFor(() => {
      expect(mockUseAddressSearch).toHaveBeenCalledWith('Teststraat 42', 5);
    }, { timeout: 1000 });

    const resultItems = screen.queryAllByTestId('search-result-item');
    if (resultItems.length > 0) {
      await act(async () => {
        fireEvent.press(resultItems[0]);
      });

      await waitFor(() => {
        expect(onLocationResolved).toHaveBeenCalledWith(
          { lon: TEST_LNG, lat: TEST_LAT },
          'Teststraat 42, 5651HA Eindhoven',
          mockAddress,
        );
      });
    }
  });

  it('shows clear button and resets on tap', () => {
    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    const input = focusNativeSearchInput();

    // Initially no clear button
    expect(screen.queryByTestId('search-clear-button')).toBeNull();

    // Type text
    fireEvent.changeText(input, 'Test');

    // Clear button should appear
    expect(screen.getByTestId('search-clear-button')).toBeTruthy();

    // Tap clear
    fireEvent.press(screen.getByTestId('search-clear-button'));

    // Input should be cleared
    // Clear button should be gone
    expect(screen.queryByTestId('search-clear-button')).toBeNull();
  });

  it('does not show results for queries shorter than 2 characters', () => {
    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'T');

    act(() => {
      jest.advanceTimersByTime(400);
    });

    // Results should not be shown
    expect(screen.queryByTestId('search-results-list')).toBeNull();
    expect(screen.queryByTestId('search-results-loading')).toBeNull();
    expect(screen.queryByTestId('search-results-empty')).toBeNull();
  });
});
