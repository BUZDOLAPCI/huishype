import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PropertyBottomSheet } from '../PropertyBottomSheet.native';
import type { Property, PropertyDetails } from '../../../hooks/useProperties';

const mockUseProperty = jest.fn();
const mockUseListings = jest.fn();
const mockRecordPropertyView = jest.fn();

// Create a test query client
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

// Wrapper component with providers
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Custom render with providers
const renderWithProviders = (ui: React.ReactElement) => {
  return render(ui, { wrapper: TestWrapper });
};

// Mock @gorhom/bottom-sheet
jest.mock('@gorhom/bottom-sheet', () => {
  const { View, ScrollView } = require('react-native');
  const React = require('react');

  const MockBottomSheet = React.forwardRef(
    ({ children, onChange, index }: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        expand: jest.fn(),
        collapse: jest.fn(),
        close: jest.fn(),
        snapToIndex: jest.fn(),
      }));

      // Only render if index >= 0 or explicitly set
      if (index < 0) return null;

      return <View testID="bottom-sheet">{children}</View>;
    }
  );

  return {
    __esModule: true,
    default: MockBottomSheet,
    BottomSheetScrollView: ({ children }: any) => (
      <ScrollView testID="bottom-sheet-scroll">{children}</ScrollView>
    ),
    BottomSheetBackdrop: () => null,
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View,
    },
    useSharedValue: (value: any) => ({ value }),
    useAnimatedStyle: (fn: any) => fn(),
    withSpring: (value: any) => value,
    withTiming: (value: any) => value,
    interpolate: () => 1,
    Extrapolation: { CLAMP: 'clamp' },
    Easing: { inOut: () => {}, ease: {} },
  };
});

// Mock Linking
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn(),
  canOpenURL: jest.fn().mockResolvedValue(true),
}));

// Mock Share
jest.mock('react-native/Libraries/Share/Share', () => ({
  share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
}));

// Mock the AuthProvider
jest.mock('../../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: false,
    user: null,
    accessToken: null,
    authError: null,
  }),
}));

// Mock the comments hooks
jest.mock('../../../hooks/useComments', () => ({
  useComments: () => ({
    data: { pages: [] },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useSubmitComment: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useLikeComment: () => ({
    mutate: jest.fn(),
  }),
}));

// Mock the property like/save hooks (used internally by PropertyContent)
jest.mock('../../../hooks/usePropertyLike', () => ({
  usePropertyLike: () => ({
    isLiked: false,
    toggleLike: jest.fn(),
  }),
}));

jest.mock('../../../hooks/usePropertySave', () => ({
  usePropertySave: () => ({
    isSaved: false,
    toggleSave: jest.fn(),
  }),
}));

jest.mock('../../../hooks/useProperties', () => {
  const actual = jest.requireActual('../../../hooks/useProperties');
  return {
    ...actual,
    useProperty: (...args: unknown[]) => mockUseProperty(...args),
  };
});

jest.mock('../../../hooks/useListings', () => ({
  useListings: (...args: unknown[]) => mockUseListings(...args),
}));

jest.mock('../../../hooks/usePropertyView', () => ({
  usePropertyView: () => ({
    recordPropertyView: mockRecordPropertyView,
  }),
}));

jest.mock('../LoadingSkeleton', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    LoadingSkeleton: () => <Text testID="property-loading-skeleton">Loading skeleton</Text>,
  };
});

// Mock the price guess hooks
jest.mock('../../../hooks/usePriceGuess', () => ({
  useFetchPriceGuess: () => ({
    data: null,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useSubmitGuess: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const mockProperty: Property = {
  id: 'test-property-123',
  nationalId: 'BAG-12345',
  countryCode: 'NL',
  address: 'Teststraat 42',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  geometry: {
    type: 'Point',
    coordinates: [5.4697, 51.4416],
  },
  yearBuilt: 1985,
  floorAreaM2: 120,
  status: 'active',
  officialValuation: 350000,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockPropertyDetails: PropertyDetails = {
  ...mockProperty,
  askingPrice: undefined,
  activityLevel: 'cold',
  commentCount: 0,
  guessCount: 0,
  viewCount: 0,
  uniqueViewers: 0,
  isLiked: false,
  isSaved: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProperty.mockImplementation((id: string | null) => ({
    data: id === mockProperty.id ? mockPropertyDetails : null,
    isLoading: false,
    error: null,
  }));
  mockUseListings.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  });
});

describe('PropertyBottomSheet', () => {
  it('renders nothing when property is null', () => {
    const { queryByTestId } = renderWithProviders(
      <PropertyBottomSheet property={null} />
    );

    // Bottom sheet should not render when property is null (index -1)
    expect(queryByTestId('bottom-sheet')).toBeNull();
  });

  it('renders property address when property is provided', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    expect(screen.getByText('Teststraat 42')).toBeTruthy();
  });

  it('renders property city and postal code', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    expect(screen.getByText('Eindhoven, 5600 AA')).toBeTruthy();
  });

  it('renders building year badge', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    // MetricPills shows year as plain number (may appear in both header and details)
    expect(screen.getAllByText('1985').length).toBeGreaterThan(0);
  });

  it('renders surface area badge', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    // Multiple instances may appear (in header and details), use getAllByText
    expect(screen.getAllByText(/120 m/).length).toBeGreaterThan(0);
  });

  it('renders quick action buttons', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Share')).toBeTruthy();
    expect(screen.getByText('Like')).toBeTruthy();
  });

  it('calls onSave when Save button is pressed', () => {
    const onSave = jest.fn();
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible onSave={onSave} />);

    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith('test-property-123');
  });

  it('calls onLike when Like button is pressed', () => {
    const onLike = jest.fn();
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible onLike={onLike} />);

    fireEvent.press(screen.getByText('Like'));

    expect(onLike).toHaveBeenCalledWith('test-property-123');
  });

  it('renders price guess section', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    expect(screen.getByText('Guess the Price')).toBeTruthy();
    expect(screen.getByText('Submit Guess')).toBeTruthy();
  });

  it('renders Submit Guess button in price guess section', () => {
    renderWithProviders(
      <PropertyBottomSheet property={mockProperty} isPreviewCardVisible />
    );

    // The Submit Guess button should be visible in the PriceGuessSlider
    expect(screen.getByText('Submit Guess')).toBeTruthy();
  });

  it('renders comments section', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    // 'Comments' should appear in the section header
    expect(screen.getAllByText('Comments').length).toBeGreaterThan(0);
    // With no comments, should show empty state
    expect(screen.getByText('No comments yet')).toBeTruthy();
  });

  it('renders property details section', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    expect(screen.getByText('Property Details')).toBeTruthy();
    // Technical IDs like BAG ID are hidden per reference expectation 0026
    expect(screen.getByText('Year Built')).toBeTruthy();
  });

  it('shows loading skeleton when isLoading is true', () => {
    renderWithProviders(
      <PropertyBottomSheet
        property={mockProperty}
        isLoading
        isPreviewCardVisible
      />
    );

    expect(screen.getByTestId('property-loading-skeleton')).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('handles property without optional fields', () => {
    const minimalProperty: Property = {
      id: 'minimal-123',
      nationalId: null,
      countryCode: 'NL',
      address: 'Minimal Address',
      city: 'Amsterdam',
      postalCode: null,
      geometry: null,
      yearBuilt: null,
      floorAreaM2: null,
      status: 'active',
      officialValuation: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    renderWithProviders(<PropertyBottomSheet property={minimalProperty} isPreviewCardVisible />);

    expect(screen.getByText('Minimal Address')).toBeTruthy();
    expect(screen.getByText('Amsterdam')).toBeTruthy();
    // Should not crash when optional fields are missing
  });
});

describe('PropertyBottomSheet sections', () => {
  it('renders PriceSection with WOZ value', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    expect(screen.getByText('WOZ Value')).toBeTruthy();
  });

  it('renders activity level indicator', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    // Default activity level is 'cold', displayed as 'Quiet'
    expect(screen.getByText('Quiet')).toBeTruthy();
  });

  it('shows CTA text when counts are zero in PropertyDetails', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    // With zero counts, CTAs are shown instead of count labels
    expect(screen.getByText('Be the first to guess')).toBeTruthy();
    expect(screen.getByText('Start the conversation')).toBeTruthy();
  });
});

describe('PropertyBottomSheet ref methods', () => {
  it('exposes expand, collapse, close, and snapToIndex methods via ref', () => {
    const ref = React.createRef<any>();
    renderWithProviders(<PropertyBottomSheet ref={ref} property={mockProperty} />);

    // These methods should be available on the ref
    expect(ref.current?.expand).toBeDefined();
    expect(ref.current?.collapse).toBeDefined();
    expect(ref.current?.close).toBeDefined();
    expect(ref.current?.snapToIndex).toBeDefined();
  });
});
