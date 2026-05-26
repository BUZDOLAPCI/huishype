import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PropertyContent } from '../PropertyContent';
import type { Property, PropertyDetails } from '../../../hooks/useProperties';

const mockUseProperty = jest.fn();
const mockUseListings = jest.fn();
const mockRecordPropertyView = jest.fn();
const mockUsePropertyLike = jest.fn();
const mockUsePropertySave = jest.fn();

type PropertyHeaderProps = {
  property: {
    address: string;
  };
};

type QuickActionsProps = {
  property: {
    isSaved?: boolean;
    isLiked?: boolean;
  };
  onSave?: () => void;
  onLike?: () => void;
  onShare?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
};

type PriceGuessSectionProps = {
  property: {
    id: string;
  };
};

jest.mock('../../../hooks/useProperties', () => {
  return {
    useProperty: (...args: unknown[]) => mockUseProperty(...args),
    resolvePropertyCommentCount: (property: {
      commentCount?: number | null;
      topLevelCommentCount?: number | null;
      replyCount?: number | null;
    }) => {
      if (
        typeof property.topLevelCommentCount === 'number' ||
        typeof property.replyCount === 'number'
      ) {
        return (property.topLevelCommentCount ?? 0) + (property.replyCount ?? 0);
      }

      return property.commentCount ?? 0;
    },
    resolvePropertyActivityLevel: (property: {
      socialScore?: number | null;
      recentSocialScore?: number | null;
      hasActiveListing?: boolean | null;
      activityLevel?: 'hot' | 'warm' | 'cold' | null;
    }) => {
      if ((property.recentSocialScore ?? 0) > 0.5) {
        return 'hot';
      }

      if ((property.socialScore ?? 0) > 0 || property.hasActiveListing) {
        return 'warm';
      }

      return property.activityLevel ?? 'cold';
    },
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

jest.mock('../../../hooks/usePropertyLike', () => ({
  usePropertyLike: (...args: unknown[]) => mockUsePropertyLike(...args),
}));

jest.mock('../../../hooks/usePropertySave', () => ({
  usePropertySave: (...args: unknown[]) => mockUsePropertySave(...args),
}));

jest.mock('../PropertyHeader', () => ({
  PropertyHeader: ({ property }: PropertyHeaderProps) => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>{property.address}</Text>;
  },
}));

jest.mock('../PriceSection', () => ({
  PriceSection: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Price section</Text>;
  },
}));

jest.mock('../QuickActions', () => ({
  QuickActions: ({ property, onSave, onLike, onShare, onComment, onGuess }: QuickActionsProps) => {
    const React = require('react');
    const { Text, Pressable } = require('react-native');
    return (
      <>
        <Text>{property.isSaved ? 'Saved' : 'Save'}</Text>
        <Text>{property.isLiked ? 'Liked' : 'Like'}</Text>
        <Pressable onPress={onSave}>
          <Text>{property.isSaved ? 'Press Saved' : 'Press Save'}</Text>
        </Pressable>
        <Pressable onPress={onLike}>
          <Text>{property.isLiked ? 'Press Liked' : 'Press Like'}</Text>
        </Pressable>
        <Pressable onPress={onComment}>
          <Text>Press Comment</Text>
        </Pressable>
        <Pressable onPress={onGuess}>
          <Text>Press Guess</Text>
        </Pressable>
        <Pressable onPress={onShare}>
          <Text>Press Share</Text>
        </Pressable>
      </>
    );
  },
}));

jest.mock('../PriceGuessSection', () => ({
  PriceGuessSection: ({ property }: PriceGuessSectionProps) => {
    const React = require('react');
    const { Text } = require('react-native');
    const [mountedPropertyId] = React.useState(property.id);
    return (
      <>
        <Text>Price guess section</Text>
        <Text testID="price-guess-section-mounted-property-id">{mountedPropertyId}</Text>
      </>
    );
  },
}));

jest.mock('../CommentsSection', () => ({
  CommentsSection: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Comments section</Text>;
  },
}));

jest.mock('../PropertyDetails', () => ({
  PropertyDetails: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Property details section</Text>;
  },
}));

jest.mock('../ListingLinks', () => ({
  ListingLinks: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Listing links</Text>;
  },
}));

jest.mock('../ListingSubmissionSheet', () => ({
  ListingSubmissionSheet: () => null,
}));

jest.mock('../LoadingSkeleton', () => ({
  LoadingSkeleton: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text testID="property-content-loading">Loading skeleton</Text>;
  },
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const renderWithProviders = (ui: React.ReactElement) => render(ui, { wrapper: TestWrapper });

const summaryProperty: Property = {
  id: 'property-123',
  nationalId: 'BAG-12345',
  countryCode: 'NL',
  address: 'Summarystraat 1',
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

const detailedProperty: PropertyDetails = {
  ...summaryProperty,
  address: 'Detailedstraat 99',
  askingPrice: undefined,
  activityLevel: 'warm',
  commentCount: 2,
  guessCount: 3,
  viewCount: 4,
  uniqueViewers: 2,
  isLiked: false,
  isSaved: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProperty.mockImplementation((id: string | null) => ({
    data: id ? detailedProperty : null,
    isLoading: false,
    error: null,
  }));
  mockUseListings.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  });
  mockUsePropertyLike.mockReturnValue({
    isLiked: false,
    toggleLike: jest.fn(),
  });
  mockUsePropertySave.mockReturnValue({
    isSaved: false,
    toggleSave: jest.fn(),
  });
});

describe('PropertyContent', () => {
  it('uses external like/save state and callbacks instead of internal hooks', () => {
    const onLike = jest.fn();
    const onSave = jest.fn();

    renderWithProviders(
      <PropertyContent
        property={detailedProperty}
        isLiked
        isSaved
        onLike={onLike}
        onSave={onSave}
      />
    );

    expect(mockUseProperty).toHaveBeenCalledWith(null);
    expect(mockUsePropertyLike).not.toHaveBeenCalled();
    expect(mockUsePropertySave).not.toHaveBeenCalled();
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Liked')).toBeTruthy();

    fireEvent.press(screen.getByText('Press Saved'));
    fireEvent.press(screen.getByText('Press Liked'));

    expect(onSave).toHaveBeenCalledWith(detailedProperty.id);
    expect(onLike).toHaveBeenCalledWith(detailedProperty.id);
  });

  it('wires quick action comment and guess buttons to in-panel scroll handlers', () => {
    const onScrollToComments = jest.fn();
    const onScrollToGuess = jest.fn();

    renderWithProviders(
      <PropertyContent
        property={detailedProperty}
        onScrollToComments={onScrollToComments}
        onScrollToGuess={onScrollToGuess}
      />
    );

    fireEvent.press(screen.getByText('Press Comment'));
    fireEvent.press(screen.getByText('Press Guess'));

    expect(onScrollToComments).toHaveBeenCalledTimes(1);
    expect(onScrollToGuess).toHaveBeenCalledTimes(1);
  });

  it('reports section anchors relative to the full scroll content, not just the inner stack', async () => {
    const onGuessSectionLayout = jest.fn();
    const onCommentsSectionLayout = jest.fn();

    renderWithProviders(
      <PropertyContent
        property={detailedProperty}
        onGuessSectionLayout={onGuessSectionLayout}
        onCommentsSectionLayout={onCommentsSectionLayout}
      />
    );

    fireEvent(screen.getByTestId('property-content-guess-section'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 96, width: 320, height: 120 } },
    });
    fireEvent(screen.getByTestId('property-content-comments-section'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 244, width: 320, height: 160 } },
    });
    fireEvent(screen.getByTestId('property-content-section-stack'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 418, width: 320, height: 640 } },
    });

    await waitFor(() => {
      expect(onGuessSectionLayout).toHaveBeenLastCalledWith(514);
      expect(onCommentsSectionLayout).toHaveBeenLastCalledWith(662);
    });
  });

  it('remounts the price guess section when the property changes', () => {
    const firstProperty = {
      ...detailedProperty,
      id: 'property-first',
    };
    const secondProperty = {
      ...detailedProperty,
      id: 'property-second',
    };

    const { rerender } = renderWithProviders(<PropertyContent property={firstProperty} />);

    expect(screen.getByTestId('price-guess-section-mounted-property-id').props.children).toBe(
      firstProperty.id
    );

    rerender(<PropertyContent property={secondProperty} />);

    expect(screen.getByTestId('price-guess-section-mounted-property-id').props.children).toBe(
      secondProperty.id
    );
  });

  it('mounts internal like/save hooks when explicitly requested', () => {
    const toggleLike = jest.fn();
    const toggleSave = jest.fn();
    const onLike = jest.fn();
    const onSave = jest.fn();
    const onAuthRequired = jest.fn();

    mockUsePropertyLike.mockReturnValue({
      isLiked: true,
      toggleLike,
    });
    mockUsePropertySave.mockReturnValue({
      isSaved: true,
      toggleSave,
    });

    renderWithProviders(
      <PropertyContent
        property={detailedProperty}
        manageInteractionsInternally
        onLike={onLike}
        onSave={onSave}
        onAuthRequired={onAuthRequired}
      />
    );

    expect(mockUsePropertyLike).toHaveBeenCalledWith({
      propertyId: detailedProperty.id,
      onAuthRequired,
    });
    expect(mockUsePropertySave).toHaveBeenCalledWith({
      propertyId: detailedProperty.id,
      onAuthRequired,
    });
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Liked')).toBeTruthy();

    fireEvent.press(screen.getByText('Press Saved'));
    fireEvent.press(screen.getByText('Press Liked'));

    expect(toggleSave).toHaveBeenCalledTimes(1);
    expect(toggleLike).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onLike).not.toHaveBeenCalled();
  });

  it('renders the shared loading skeleton when loading', () => {
    renderWithProviders(
      <PropertyContent
        property={detailedProperty}
        isLoading
      />
    );

    expect(screen.getByTestId('property-content-loading')).toBeTruthy();
    expect(screen.queryByText('Price section')).toBeNull();
    expect(mockUsePropertyLike).not.toHaveBeenCalled();
    expect(mockUsePropertySave).not.toHaveBeenCalled();
  });

  it('records a property view only after becoming visible', () => {
    const { rerender } = renderWithProviders(
      <PropertyContent
        property={detailedProperty}
        isVisible={false}
      />
    );

    expect(mockRecordPropertyView).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <PropertyContent
          property={detailedProperty}
          isVisible
        />
      </QueryClientProvider>
    );

    expect(mockRecordPropertyView).toHaveBeenCalledTimes(1);
    expect(mockRecordPropertyView).toHaveBeenCalledWith(detailedProperty.id);
  });

  it('does not record a property view for ghost map nodes', () => {
    renderWithProviders(
      <PropertyContent
        property={{
          ...detailedProperty,
          nodeClass: 'ghost',
        }}
        isVisible
      />
    );

    expect(mockRecordPropertyView).not.toHaveBeenCalled();
  });

  it('fetches details only for summary properties', () => {
    renderWithProviders(<PropertyContent property={summaryProperty} />);

    expect(mockUseProperty).toHaveBeenCalledWith(summaryProperty.id);
    expect(screen.getByText(detailedProperty.address)).toBeTruthy();
  });

  it('skips the detail query when property details are already present', () => {
    renderWithProviders(<PropertyContent property={detailedProperty} />);

    expect(mockUseProperty).toHaveBeenCalledWith(null);
    expect(screen.getByText(detailedProperty.address)).toBeTruthy();
  });
});
