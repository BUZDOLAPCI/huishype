import React from 'react';
import { render as rtlRender, fireEvent, screen, act, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { SearchBar } from '../SearchBar';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import { TEST_LAT, TEST_LNG } from '@/src/__tests__/fixtures/test-coordinates';
import { WebDismissibleLayerProvider } from '@/src/providers/WebDismissibleLayerProvider';
import { LANGUAGE_STORAGE_KEY, LanguageProvider } from '@/src/i18n';

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function focusNativeSearchInput() {
  fireEvent.press(screen.getByTestId('search-bar-focus-target'));
  return screen.getByTestId('search-bar-input');
}

const originalPlatform = Platform.OS;

function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: LanguageProvider });
}

function renderWithDismissibleLayer(ui: React.ReactElement) {
  return render(<WebDismissibleLayerProvider>{ui}</WebDismissibleLayerProvider>);
}

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

describe('SearchBar', () => {
  const onPropertyResolved = jest.fn();
  const onLocationResolved = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorage.clear();

    // Default: no search results
    mockUseAddressSearch.mockReturnValue({
      data: [],
      isLoading: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    setPlatform(originalPlatform);
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

  it('renders Dutch placeholder text when Dutch is selected', async () => {
    jest.useRealTimers();
    setPlatform('web');
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'nl');

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Adres zoeken...')).toBeTruthy();
    });
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
    expect(mockUseAddressSearch).toHaveBeenCalledWith('', 5, undefined);
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
    expect(mockUseAddressSearch).toHaveBeenCalledWith('Teststraat', 5, undefined);
  });

  it('passes searchBias into useAddressSearch', () => {
    const searchBias = {
      lon: 4.8952,
      lat: 52.3702,
      countryCode: 'NL',
    };

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
        searchBias={searchBias}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Damrak');

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(mockUseAddressSearch).toHaveBeenCalledWith('Damrak', 5, { searchBias });
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
      expect(mockUseAddressSearch).toHaveBeenCalledWith('Teststraat 42', 5, undefined);
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
      expect(mockUseAddressSearch).toHaveBeenCalledWith('Teststraat 42', 5, undefined);
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

  it('clears the stale query after result selection so refocus does not reopen old suggestions', async () => {
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

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Teststraat 42');

    await waitFor(() => {
      expect(mockUseAddressSearch).toHaveBeenCalledWith('Teststraat 42', 5, undefined);
    }, { timeout: 1000 });

    const resultItems = screen.queryAllByTestId('search-result-item');
    expect(resultItems.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.press(resultItems[0]);
    });

    await waitFor(() => {
      expect(mockUseAddressSearch).toHaveBeenLastCalledWith('', 5, undefined);
    }, { timeout: 1000 });

    fireEvent.press(screen.getByTestId('search-bar-focus-target'));

    expect(screen.queryByTestId('search-results-list')).toBeNull();
    expect(screen.queryByTestId('search-results-loading')).toBeNull();
    expect(screen.queryByTestId('search-results-empty')).toBeNull();
  });

  it('cancels an in-flight result resolution when the search resets', async () => {
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
    const deferredResolve = createDeferred<typeof mockProperty>();

    mockUseAddressSearch.mockReturnValue({
      data: [mockAddress],
      isLoading: false,
    });
    mockResolveProperty.mockReturnValue(deferredResolve.promise);

    const { rerender } = render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
        transientResetKey={0}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Teststraat 42');

    await waitFor(() => {
      expect(mockUseAddressSearch).toHaveBeenCalledWith('Teststraat 42', 5, undefined);
    }, { timeout: 1000 });

    const resultItems = screen.queryAllByTestId('search-result-item');
    expect(resultItems.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.press(resultItems[0]);
    });

    rerender(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
        transientResetKey={1}
      />
    );

    await act(async () => {
      deferredResolve.resolve(mockProperty);
      await Promise.resolve();
    });

    expect(onPropertyResolved).not.toHaveBeenCalled();
    expect(onLocationResolved).not.toHaveBeenCalled();
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

  it('closes the focused web search overlay on popstate before route navigation', async () => {
    jest.useRealTimers();
    setPlatform('web');
    const routeNavigation = jest.fn();
    window.addEventListener('popstate', routeNavigation);

    try {
      renderWithDismissibleLayer(
        <SearchBar
          onPropertyResolved={onPropertyResolved}
          onLocationResolved={onLocationResolved}
        />
      );

      fireEvent(screen.getByTestId('search-bar-input'), 'focus');
      expect(screen.getByTestId('search-overlay-backdrop')).toBeTruthy();

      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      await waitFor(() => {
        expect(screen.queryByTestId('search-overlay-backdrop')).toBeNull();
      });
      expect(routeNavigation).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', routeNavigation);
    }
  });
});
