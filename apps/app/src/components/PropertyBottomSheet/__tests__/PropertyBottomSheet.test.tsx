import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PropertyBottomSheet } from '../PropertyBottomSheet.native';
import type { PropertyBottomSheetRef } from '../index';
import type { Property, PropertyDetails } from '../../../hooks/useProperties';

type BottomSheetHandle = {
  expand: jest.Mock;
  collapse: jest.Mock;
  close: jest.Mock;
  snapToIndex: jest.Mock;
};

type BottomSheetMockProps = React.PropsWithChildren<{
  index?: number;
  onChange?: (index: number) => void;
}>;

type BottomSheetScrollViewProps = React.PropsWithChildren<{
  testID?: string;
}>;

type BottomSheetScrollViewHandle = {
  scrollTo: jest.Mock;
};

const mockUseProperty = jest.fn();
const mockUseListings = jest.fn();
const mockRecordPropertyView = jest.fn();
const mockBottomSheetHandle: BottomSheetHandle = {
  expand: jest.fn(),
  collapse: jest.fn(),
  close: jest.fn(),
  snapToIndex: jest.fn(),
};
const mockBottomSheetScrollTo = jest.fn();
let mockBottomSheetOnChange: ((index: number) => void) | undefined;

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
  const React = require('react') as typeof import('react');

  const MockBottomSheet = React.forwardRef(
    ({ children, index, onChange }: BottomSheetMockProps, ref: React.ForwardedRef<BottomSheetHandle>) => {
      React.useImperativeHandle(ref, () => mockBottomSheetHandle);
      mockBottomSheetOnChange = onChange;

      // Only render if index >= 0 or explicitly set
      if ((index ?? -1) < 0) return null;

      return <View testID="bottom-sheet">{children}</View>;
    }
  );

  return {
    __esModule: true,
    default: MockBottomSheet,
    BottomSheetScrollView: React.forwardRef<
      BottomSheetScrollViewHandle,
      BottomSheetScrollViewProps
    >(({ children }, ref: React.ForwardedRef<BottomSheetScrollViewHandle>) => {
      React.useImperativeHandle(ref, () => ({
        scrollTo: mockBottomSheetScrollTo,
      }));

      return <ScrollView testID="bottom-sheet-scroll">{children}</ScrollView>;
      },
    ),
    BottomSheetBackdrop: () => null,
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    default: {
      View,
      Text,
    },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    cancelAnimation: jest.fn(),
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    runOnJS: (fn: unknown) => fn,
    interpolate: () => 1,
    interpolateColor: (_value: unknown, _inputRange: unknown, outputRange: unknown[]) =>
      outputRange[0],
    Extrapolation: { CLAMP: 'clamp' },
    Easing: {
      bezier: () => (value: unknown) => value,
      cubic: (value: unknown) => value,
      ease: (value: unknown) => value,
      inOut: (easing: unknown) => easing,
      out: (easing: unknown) => easing,
    },
  };
});

// Mock Linking
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Linking = {
    openURL: jest.fn(),
    canOpenURL: jest.fn().mockResolvedValue(true),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getInitialURL: jest.fn().mockResolvedValue(null),
  };
  return RN;
});

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
  useDeleteComment: () => ({
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
  mockBottomSheetHandle.expand.mockReset();
  mockBottomSheetHandle.collapse.mockReset();
  mockBottomSheetHandle.close.mockReset();
  mockBottomSheetHandle.snapToIndex.mockReset();
  mockBottomSheetScrollTo.mockReset();
  mockBottomSheetOnChange = undefined;
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

  it('opens from the preview card at the top of the sheet content', () => {
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((callback: TimerHandler) => {
        if (typeof callback === 'function') {
          callback();
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);
    const ref = React.createRef<PropertyBottomSheetRef>();

    renderWithProviders(
      <PropertyBottomSheet
        ref={ref}
        property={mockProperty}
        isPreviewCardVisible
      />
    );

    expect(ref.current).toBeTruthy();

    ref.current?.openFromPreview();

    expect(mockBottomSheetHandle.snapToIndex).toHaveBeenCalledWith(1);
    expect(mockBottomSheetScrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    setTimeoutSpy.mockRestore();
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

  it('expands from half-open when a passive body area is pressed', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    expect(mockBottomSheetOnChange).toEqual(expect.any(Function));
    mockBottomSheetOnChange?.(1);

    fireEvent.press(screen.getByTestId('property-header-carousel'));

    expect(mockBottomSheetHandle.snapToIndex).toHaveBeenCalledWith(2);
  });

  it('keeps interactive controls on their own handler in half-open state', () => {
    const onSave = jest.fn();
    renderWithProviders(
      <PropertyBottomSheet property={mockProperty} isPreviewCardVisible onSave={onSave} />
    );

    mockBottomSheetOnChange?.(1);
    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith('test-property-123');
    expect(mockBottomSheetHandle.snapToIndex).not.toHaveBeenCalledWith(2);
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
    expect(screen.getByText('Drag Slider to Adjust Guess')).toBeTruthy();
  });

  it('renders the initial price guess button prompt in the price guess section', () => {
    renderWithProviders(
      <PropertyBottomSheet property={mockProperty} isPreviewCardVisible />
    );

    expect(screen.getByText('Drag Slider to Adjust Guess')).toBeTruthy();
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
  it('renders price snapshot cards without the removed comparison bar', () => {
    renderWithProviders(<PropertyBottomSheet property={mockProperty} isPreviewCardVisible />);

    expect(screen.getByText('Price Snapshot')).toBeTruthy();
    expect(screen.getByText('WOZ Value')).toBeTruthy();
    expect(screen.queryByText('Price comparison')).toBeNull();
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
    const ref = React.createRef<PropertyBottomSheetRef>();
    renderWithProviders(<PropertyBottomSheet ref={ref} property={mockProperty} />);

    // These methods should be available on the ref
    expect(ref.current?.expand).toBeDefined();
    expect(ref.current?.collapse).toBeDefined();
    expect(ref.current?.close).toBeDefined();
    expect(ref.current?.snapToIndex).toBeDefined();
  });
});
