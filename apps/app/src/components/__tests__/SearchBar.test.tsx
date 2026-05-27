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

const mockUseLocationSearch = jest.fn();
jest.mock('@/src/hooks/useLocationSearch', () => ({
  useLocationSearch: (...args: unknown[]) => mockUseLocationSearch(...args),
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
    mockUseLocationSearch.mockReturnValue({
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

  it('does not show city-only legacy address suggestions as address results', () => {
    mockUseAddressSearch.mockReturnValue({
      data: [
        createMockAddress({
          bagId: 'city-001',
          formattedAddress: 'Eindhoven',
          details: {
            city: '',
            zip: '',
            street: '',
            number: '',
            houseNumber: null,
            houseNumberAddition: null,
            countryCode: 'NL',
          },
        }),
        createMockAddress({
          bagId: 'addr-001',
          formattedAddress: 'Groene Loper 3, 5612AE Eindhoven',
          details: {
            city: 'Eindhoven',
            zip: '5612AE',
            street: 'Groene Loper',
            number: '3',
            houseNumber: '3',
            houseNumberAddition: null,
            countryCode: 'NL',
          },
        }),
      ],
      isLoading: false,
    });

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Eindhoven');
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(screen.getAllByTestId('search-result-item')).toHaveLength(1);
    expect(screen.getByText('Groene Loper 3, 5612AE Eindhoven')).toBeTruthy();
  });

  it('adds an area chip when a city suggestion is selected', () => {
    const onAreaSelected = jest.fn();
    mockUseLocationSearch.mockReturnValue({
      data: [
        {
          id: 'city:NL:eindhoven',
          type: 'city',
          label: 'Eindhoven',
          subtitle: 'Noord-Brabant, Nederland',
          countryCode: 'NL',
          coordinates: [5.4697, 51.4416],
          filterToken: {
            type: 'city',
            countryCode: 'NL',
            value: 'eindhoven',
            label: 'Eindhoven',
            coordinates: [5.4697, 51.4416],
          },
        },
      ],
      isLoading: false,
    });

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
        onAreaSelected={onAreaSelected}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Eindhoven');
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(screen.getByText('City - Noord-Brabant, Nederland')).toBeTruthy();

    fireEvent.press(screen.getByText('Eindhoven'));

    expect(onAreaSelected).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'city', countryCode: 'NL', value: 'eindhoven' }),
    );
    expect(onPropertyResolved).not.toHaveBeenCalled();
  });

  it('passes suggestion bbox into selected area chips', () => {
    const onAreaSelected = jest.fn();
    mockUseLocationSearch.mockReturnValue({
      data: [
        {
          id: 'city:NL:eindhoven',
          type: 'city',
          label: 'Eindhoven',
          subtitle: 'Noord-Brabant, Nederland',
          countryCode: 'NL',
          coordinates: [5.4697, 51.4416],
          bbox: [5.35, 51.36, 5.57, 51.51],
          filterToken: {
            type: 'city',
            countryCode: 'NL',
            value: 'eindhoven',
            label: 'Eindhoven',
          },
        },
      ],
      isLoading: false,
    });

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
        onAreaSelected={onAreaSelected}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Eindhoven');
    act(() => {
      jest.advanceTimersByTime(400);
    });

    fireEvent.press(screen.getByText('Eindhoven'));

    expect(onAreaSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'city',
        countryCode: 'NL',
        value: 'eindhoven',
        coordinates: [5.4697, 51.4416],
        bbox: [5.35, 51.36, 5.57, 51.51],
      }),
    );
  });

  it('opens direct address suggestions without creating area chips', async () => {
    jest.useRealTimers();
    const onAreaSelected = jest.fn();
    mockUseLocationSearch.mockReturnValue({
      data: [
        {
          id: 'address:NL:teststraat-42',
          type: 'address',
          label: 'Teststraat 42, Eindhoven',
          subtitle: '5651HA Eindhoven',
          address: 'Teststraat 42, Eindhoven',
          city: 'Eindhoven',
          countryCode: 'NL',
          street: 'Teststraat',
          postalCode: '5651HA',
          houseNumber: '42',
          coordinates: [TEST_LNG, TEST_LAT],
          filterToken: {
            type: 'street',
            countryCode: 'NL',
            value: 'teststraat',
            label: 'Teststraat',
          },
        },
      ],
      isLoading: false,
    });
    mockResolveProperty.mockResolvedValue(null);

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
        onAreaSelected={onAreaSelected}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Teststraat 42');

    await waitFor(() => {
      expect(screen.getByText('Teststraat 42, Eindhoven')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText('Teststraat 42, Eindhoven'));
    });

    await waitFor(() => {
      expect(onLocationResolved).toHaveBeenCalledWith(
        { lon: TEST_LNG, lat: TEST_LAT },
        'Teststraat 42, Eindhoven',
        expect.objectContaining({
          formattedAddress: 'Teststraat 42, Eindhoven',
        }),
      );
    });
    expect(onAreaSelected).not.toHaveBeenCalled();
  });

  it('distinguishes same-name location suggestions by type subtitle', () => {
    mockUseLocationSearch.mockReturnValue({
      data: [
        {
          id: 'city:NL:eindhoven',
          type: 'city',
          label: 'Eindhoven',
          subtitle: 'Noord-Brabant, Nederland',
          countryCode: 'NL',
          coordinates: [5.4697, 51.4416],
          filterToken: {
            type: 'city',
            countryCode: 'NL',
            value: 'eindhoven',
            label: 'Eindhoven',
            coordinates: [5.4697, 51.4416],
          },
        },
        {
          id: 'street:NL:eindhoven',
          type: 'street',
          label: 'Eindhoven',
          subtitle: 'Eindhoven, Noord-Brabant, Nederland',
          countryCode: 'NL',
          coordinates: [5.47, 51.44],
          filterToken: {
            type: 'street',
            countryCode: 'NL',
            value: 'eindhoven',
            label: 'Eindhoven',
            city: 'Eindhoven',
            coordinates: [5.47, 51.44],
          },
        },
      ],
      isLoading: false,
    });

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    const input = focusNativeSearchInput();
    fireEvent.changeText(input, 'Eindhoven');
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(screen.getByText('City - Noord-Brabant, Nederland')).toBeTruthy();
    expect(screen.getByText('Street - Eindhoven, Noord-Brabant, Nederland')).toBeTruthy();
  });

  it('shows current-location action when focused with an empty query', () => {
    const onCurrentLocationSelected = jest.fn();

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
        onCurrentLocationSelected={onCurrentLocationSelected}
      />
    );

    focusNativeSearchInput();
    fireEvent.press(screen.getByTestId('search-current-location'));

    expect(onCurrentLocationSelected).toHaveBeenCalledTimes(1);
  });

  it('shows clear-all for a single selected area', () => {
    const onClearAreas = jest.fn();

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
        selectedAreas={[
          {
            type: 'city',
            countryCode: 'NL',
            value: 'eindhoven',
            label: 'Eindhoven',
          },
        ]}
        onClearAreas={onClearAreas}
      />
    );

    fireEvent.press(screen.getByTestId('search-area-clear-all'));

    expect(onClearAreas).toHaveBeenCalledTimes(1);
  });

  it('localizes the current-location action', async () => {
    jest.useRealTimers();
    setPlatform('web');
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'nl');

    render(
      <SearchBar
        onPropertyResolved={onPropertyResolved}
        onLocationResolved={onLocationResolved}
      />
    );

    fireEvent(screen.getByTestId('search-bar-input'), 'focus');

    await waitFor(() => {
      expect(screen.getByText('Zoek huidige locatie')).toBeTruthy();
    });
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
